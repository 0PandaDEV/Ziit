CREATE MATERIALIZED VIEW IF NOT EXISTS heartbeats_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', "timestamp") AS bucket,
  "userId",
  editor,
  language,
  os,
  COUNT(*) AS heartbeat_count
FROM "Heartbeats"
GROUP BY 1, "userId", editor, language, os
WITH NO DATA;

CREATE INDEX IF NOT EXISTS heartbeats_daily_user_bucket_idx
  ON heartbeats_daily ("userId", bucket DESC);

CREATE OR REPLACE FUNCTION get_leaderboard_stats()
RETURNS TABLE (
  user_id TEXT,
  total_minutes INT,
  top_editor TEXT,
  top_os TEXT,
  top_language TEXT
) AS $$
DECLARE
  v_today_start TIMESTAMPTZ := time_bucket(INTERVAL '1 day', NOW());
  v_yesterday_start TIMESTAMPTZ := time_bucket(INTERVAL '1 day', NOW()) - INTERVAL '1 day';
  v_live_end TIMESTAMPTZ := time_bucket(INTERVAL '1 day', NOW()) + INTERVAL '1 day';
  v_summary_cutoff DATE := ((time_bucket(INTERVAL '1 day', NOW()) - INTERVAL '1 day') AT TIME ZONE 'UTC')::DATE;
BEGIN
  RETURN QUERY
  WITH enabled_users AS (
    SELECT u.id, u."keystrokeTimeout" * 60 AS timeout_seconds
    FROM "User" u
    WHERE u."leaderboardEnabled" = true
  ),
  live AS (
    SELECT
      x."userId" AS uid,
      x.editor,
      x.language,
      x.os,
      CASE
        WHEN x.prev_ts IS NULL THEN 30
        WHEN EXTRACT(EPOCH FROM (x."timestamp" - x.prev_ts)) > eu.timeout_seconds THEN 30
        ELSE LEAST(EXTRACT(EPOCH FROM (x."timestamp" - x.prev_ts)), eu.timeout_seconds)
      END AS seconds
    FROM (
      SELECT
        h."userId",
        h."timestamp",
        h.editor,
        h.language,
        h.os,
        LAG(h."timestamp") OVER (
          PARTITION BY h."userId", time_bucket(INTERVAL '1 day', h."timestamp")
          ORDER BY h."timestamp"
        ) AS prev_ts
      FROM "Heartbeats" h
      WHERE h."timestamp" >= v_yesterday_start
        AND h."timestamp" < v_live_end
        AND h."userId" IN (SELECT id FROM enabled_users)
    ) x
    JOIN enabled_users eu ON eu.id = x."userId"
  ),
  totals AS (
    SELECT t.uid, SUM(t.seconds) AS seconds
    FROM (
      SELECT s."userId" AS uid, s."totalMinutes"::NUMERIC * 60 AS seconds
      FROM "Summaries" s
      WHERE s."userId" IN (SELECT id FROM enabled_users)
        AND s.date < v_summary_cutoff
      UNION ALL
      SELECT l.uid, l.seconds::NUMERIC FROM live l
    ) t
    GROUP BY t.uid
  ),
  ranked AS (
    SELECT t.uid, t.seconds
    FROM totals t
    WHERE t.seconds >= 30
    ORDER BY t.seconds DESC
    LIMIT 100
  ),
  categories AS (
    SELECT s."userId" AS uid, 'editor'::TEXT AS kind, kv.key AS name, kv.value::NUMERIC AS seconds
    FROM "Summaries" s
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.editors::JSONB, '{}'::JSONB)) kv
    WHERE s."userId" IN (SELECT uid FROM ranked) AND s.date < v_summary_cutoff
    UNION ALL
    SELECT s."userId", 'language', kv.key, kv.value::NUMERIC
    FROM "Summaries" s
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.languages::JSONB, '{}'::JSONB)) kv
    WHERE s."userId" IN (SELECT uid FROM ranked) AND s.date < v_summary_cutoff
    UNION ALL
    SELECT s."userId", 'os', kv.key, kv.value::NUMERIC
    FROM "Summaries" s
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.os::JSONB, '{}'::JSONB)) kv
    WHERE s."userId" IN (SELECT uid FROM ranked) AND s.date < v_summary_cutoff
    UNION ALL
    SELECT l.uid, 'editor', l.editor, l.seconds::NUMERIC
    FROM live l WHERE l.uid IN (SELECT uid FROM ranked) AND l.editor IS NOT NULL
    UNION ALL
    SELECT l.uid, 'language', l.language, l.seconds::NUMERIC
    FROM live l WHERE l.uid IN (SELECT uid FROM ranked) AND l.language IS NOT NULL
    UNION ALL
    SELECT l.uid, 'os', l.os, l.seconds::NUMERIC
    FROM live l WHERE l.uid IN (SELECT uid FROM ranked) AND l.os IS NOT NULL
  ),
  top_category AS (
    SELECT DISTINCT ON (c.uid, c.kind) c.uid, c.kind, c.name
    FROM (
      SELECT uid, kind, name, SUM(seconds) AS seconds
      FROM categories
      WHERE name <> ''
      GROUP BY uid, kind, name
    ) c
    ORDER BY c.uid, c.kind, c.seconds DESC, c.name
  )
  SELECT
    r.uid::TEXT,
    ROUND(r.seconds / 60.0)::INT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'editor')::TEXT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'os')::TEXT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'language')::TEXT
  FROM ranked r
  ORDER BY r.seconds DESC;
END;
$$ LANGUAGE plpgsql STABLE;

DROP MATERIALIZED VIEW IF EXISTS admin_dashboard_stats_mv CASCADE;

CREATE MATERIALIZED VIEW admin_dashboard_stats_mv AS
SELECT
  u.id,
  u.email,
  u."githubUsername" as github_username,
  u."createdAt" as created_at,
  u.lastlogin as last_login,
  COALESCE(h.heartbeats_count, 0)::BIGINT as heartbeats_count,
  COALESCE(s.summaries_count, 0) as summaries_count,
  COALESCE(s.total_minutes, 0) as total_minutes
FROM "User" u
LEFT JOIN (
  SELECT "userId", SUM(heartbeat_count)::BIGINT as heartbeats_count
  FROM heartbeats_daily
  GROUP BY "userId"
) h ON u.id = h."userId"
LEFT JOIN (
  SELECT "userId", COUNT(*) as summaries_count, SUM("totalMinutes") as total_minutes
  FROM "Summaries"
  GROUP BY "userId"
) s ON u.id = s."userId"
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS admin_dashboard_stats_mv_id_idx
  ON admin_dashboard_stats_mv(id);
CREATE INDEX IF NOT EXISTS admin_dashboard_stats_mv_created_at_idx
  ON admin_dashboard_stats_mv(created_at DESC);

CREATE OR REPLACE PROCEDURE refresh_admin_dashboard_stats(job_id int, config jsonb)
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE matviewname = 'admin_dashboard_stats_mv' AND ispopulated
  ) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY admin_dashboard_stats_mv;
  ELSE
    REFRESH MATERIALIZED VIEW admin_dashboard_stats_mv;
  END IF;
END;
$$;
