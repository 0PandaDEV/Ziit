ALTER TABLE "Heartbeats" ADD COLUMN IF NOT EXISTS seconds REAL NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recompute_heartbeat_seconds(
  p_user_id TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
) RETURNS BIGINT AS $$
  WITH bounds AS (
    SELECT
      COALESCE((SELECT MAX("timestamp") FROM "Heartbeats" WHERE "userId" = p_user_id AND "timestamp" < p_from), p_from) AS lo,
      COALESCE((SELECT MIN("timestamp") FROM "Heartbeats" WHERE "userId" = p_user_id AND "timestamp" > p_to), p_to) AS hi
  ),
  ordered AS (
    SELECT
      h.id,
      h."timestamp",
      b.hi,
      CASE
        WHEN LEAD(h."timestamp") OVER w - h."timestamp" <= tracking_timeout()
          THEN EXTRACT(EPOCH FROM (LEAD(h."timestamp") OVER w - h."timestamp"))::REAL
        ELSE 0
      END AS next_seconds
    FROM "Heartbeats" h, bounds b
    WHERE h."userId" = p_user_id AND h."timestamp" >= b.lo AND h."timestamp" <= b.hi
    WINDOW w AS (ORDER BY h."timestamp", h.id)
  ),
  changed AS (
    UPDATE "Heartbeats" h SET seconds = o.next_seconds
    FROM ordered o
    WHERE h.id = o.id AND h."timestamp" = o."timestamp" AND h.seconds IS DISTINCT FROM o.next_seconds
      AND (o."timestamp" < o.hi OR o.hi = p_to)
    RETURNING 1
  )
  SELECT COUNT(*) FROM changed
$$ LANGUAGE sql VOLATILE;

SELECT delete_job(job_id) FROM timescaledb_information.jobs WHERE proc_name = 'refresh_admin_dashboard_stats';
DROP MATERIALIZED VIEW IF EXISTS admin_dashboard_stats_mv CASCADE;
DROP FUNCTION IF EXISTS get_admin_dashboard_stats() CASCADE;
DROP PROCEDURE IF EXISTS refresh_admin_dashboard_stats(INT, JSONB);

DROP MATERIALIZED VIEW IF EXISTS heartbeats_daily CASCADE;

CREATE MATERIALIZED VIEW heartbeats_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', "timestamp") AS bucket,
  "userId",
  editor,
  language,
  os,
  COUNT(*) AS heartbeat_count,
  SUM(seconds::DOUBLE PRECISION) AS seconds
FROM "Heartbeats"
GROUP BY 1, "userId", editor, language, os
WITH NO DATA;

CREATE INDEX heartbeats_daily_user_bucket_idx ON heartbeats_daily ("userId", bucket DESC);

CREATE MATERIALIZED VIEW heartbeat_stats_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', "timestamp") AS bucket,
  "userId",
  project,
  language,
  editor,
  os,
  file,
  branch,
  SUM(seconds::DOUBLE PRECISION) AS seconds
FROM "Heartbeats"
GROUP BY 1, "userId", project, language, editor, os, file, branch
WITH NO DATA;

CREATE INDEX heartbeat_stats_daily_user_bucket_idx ON heartbeat_stats_daily ("userId", bucket DESC);

CREATE OR REPLACE FUNCTION daily_summaries(
  p_user_id TEXT,
  p_start DATE,
  p_end DATE
) RETURNS TABLE (day DATE, summary JSONB) AS $$
  WITH rows AS (
    SELECT
      (bucket AT TIME ZONE 'UTC')::DATE AS day,
      project, language, editor, os, file, branch, seconds
    FROM heartbeat_stats_daily
    WHERE "userId" = p_user_id
      AND bucket >= p_start::TIMESTAMP AT TIME ZONE 'UTC'
      AND bucket < (p_end + 1)::TIMESTAMP AT TIME ZONE 'UTC'
  ),
  grouped AS (
    SELECT
      day, project, language, editor, os, file, branch,
      GROUPING(project, language, editor, os, file, branch) AS g,
      SUM(seconds) AS seconds
    FROM rows
    GROUP BY GROUPING SETS ((day), (day, project), (day, language), (day, editor), (day, os), (day, file), (day, branch))
  )
  SELECT
    g.day,
    jsonb_build_object(
      'date', TO_CHAR(g.day, 'YYYY-MM-DD'),
      'totalSeconds', ROUND(COALESCE(MAX(g.seconds) FILTER (WHERE g.g = 63), 0))::INT,
      'projects', COALESCE(jsonb_object_agg(g.project, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 31 AND g.project IS NOT NULL), '{}'::JSONB),
      'languages', COALESCE(jsonb_object_agg(g.language, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 47 AND g.language IS NOT NULL), '{}'::JSONB),
      'editors', COALESCE(jsonb_object_agg(g.editor, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 55 AND g.editor IS NOT NULL), '{}'::JSONB),
      'os', COALESCE(jsonb_object_agg(g.os, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 59 AND g.os IS NOT NULL), '{}'::JSONB),
      'files', COALESCE(jsonb_object_agg(g.file, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 61 AND g.file IS NOT NULL), '{}'::JSONB),
      'branches', COALESCE(jsonb_object_agg(g.branch, ROUND(g.seconds)::INT) FILTER (WHERE g.g = 62 AND g.branch IS NOT NULL), '{}'::JSONB),
      'hourlyData', (SELECT jsonb_agg(jsonb_build_object('seconds', 0)) FROM generate_series(0, 23))
    )
  FROM grouped g
  GROUP BY g.day
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION live_day_summary(
  p_user_id TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_offset_seconds INT
) RETURNS JSONB AS $$
  WITH hs AS (
    SELECT "timestamp", project, language, editor, os, file, branch, seconds
    FROM "Heartbeats"
    WHERE "userId" = p_user_id AND "timestamp" >= p_start AND "timestamp" < p_end
  ),
  hourly AS (
    SELECT
      EXTRACT(HOUR FROM (hs."timestamp" AT TIME ZONE 'UTC') + make_interval(secs => p_offset_seconds))::INT AS hour_num,
      LEAST(ROUND(SUM(hs.seconds))::INT, 3600) AS seconds
    FROM hs
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'date', TO_CHAR((p_start AT TIME ZONE 'UTC') + make_interval(secs => p_offset_seconds), 'YYYY-MM-DD'),
    'totalSeconds', ROUND(COALESCE((SELECT SUM(seconds) FROM hs), 0))::INT,
    'projects', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT project AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE project IS NOT NULL GROUP BY project) q), '{}'::JSONB),
    'languages', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT language AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE language IS NOT NULL GROUP BY language) q), '{}'::JSONB),
    'editors', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT editor AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE editor IS NOT NULL GROUP BY editor) q), '{}'::JSONB),
    'os', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT os AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE os IS NOT NULL GROUP BY os) q), '{}'::JSONB),
    'files', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT file AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE file IS NOT NULL GROUP BY file) q), '{}'::JSONB),
    'branches', COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT branch AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE branch IS NOT NULL GROUP BY branch) q), '{}'::JSONB),
    'hourlyData', (
      SELECT jsonb_agg(jsonb_build_object('seconds', COALESCE(h.seconds, 0)) ORDER BY n.hour)
      FROM generate_series(0, 23) n(hour)
      LEFT JOIN hourly h ON h.hour_num = n.hour
    )
  )
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_stats(
  p_user_id TEXT,
  p_time_range TEXT,
  p_offset_seconds INT DEFAULT 0,
  p_project_filter TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  r RECORD;
  v_today_start TIMESTAMPTZ;
  v_yesterday_start TIMESTAMPTZ;
  v_summaries JSONB;
  v_project_seconds BIGINT;
BEGIN
  PERFORM 1 FROM "User" WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO r FROM resolve_time_range(p_time_range, p_offset_seconds);
  v_today_start := r.today_start;
  v_yesterday_start := r.today_start - INTERVAL '24 hours';

  IF r.is_single_day THEN
    v_summaries := jsonb_build_array(
      live_day_summary(p_user_id, r.start_ts, r.end_ts + INTERVAL '1 millisecond', p_offset_seconds)
    );
  ELSE
    SELECT COALESCE(jsonb_agg(d.obj ORDER BY d.date_str), '[]'::JSONB)
    INTO v_summaries
    FROM (
      SELECT TO_CHAR(s.day, 'YYYY-MM-DD') AS date_str, s.summary AS obj
      FROM daily_summaries(p_user_id, r.start_day, LEAST(r.end_day, r.yesterday_day - 1)) s
      UNION ALL
      SELECT l.obj ->> 'date', l.obj
      FROM (
        SELECT live_day_summary(p_user_id, v_yesterday_start, v_today_start, p_offset_seconds) AS obj
        WHERE r.yesterday_day >= r.start_day AND r.yesterday_day <= r.end_day
      ) l
      WHERE (l.obj ->> 'totalSeconds')::INT > 0
      UNION ALL
      SELECT l.obj ->> 'date', l.obj
      FROM (
        SELECT live_day_summary(p_user_id, v_today_start, v_today_start + INTERVAL '24 hours', p_offset_seconds) AS obj
        WHERE r.yesterday_day + 1 >= r.start_day AND r.yesterday_day + 1 <= r.end_day
      ) l
      WHERE (l.obj ->> 'totalSeconds')::INT > 0
    ) d;
  END IF;

  IF p_project_filter IS NULL THEN
    v_project_seconds := NULL;
  ELSIF LOWER(p_project_filter) = 'all' THEN
    SELECT COALESCE(SUM((e ->> 'totalSeconds')::BIGINT), 0)
    INTO v_project_seconds
    FROM jsonb_array_elements(v_summaries) e;
  ELSE
    SELECT COALESCE(SUM(kv.value::BIGINT), 0)
    INTO v_project_seconds
    FROM jsonb_array_elements(v_summaries) e,
      LATERAL jsonb_each_text(e -> 'projects') kv
    WHERE LOWER(kv.key) = LOWER(p_project_filter);
  END IF;

  RETURN jsonb_build_object(
    'summaries', v_summaries,
    'offsetSeconds', p_offset_seconds,
    'projectSeconds', v_project_seconds,
    'projectFilter', p_project_filter
  )::JSON;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_user_time_range_total(
  p_user_id TEXT,
  p_time_range TEXT,
  p_offset_seconds INT DEFAULT 0
) RETURNS TABLE (
  total_minutes INT,
  total_hours NUMERIC,
  start_date DATE,
  end_date DATE
) AS $$
DECLARE
  r RECORD;
  v_today_start TIMESTAMPTZ;
  v_yesterday_start TIMESTAMPTZ;
  v_seconds NUMERIC := 0;
  v_last_day DATE;
BEGIN
  PERFORM 1 FROM "User" WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO r FROM resolve_time_range(p_time_range, p_offset_seconds);
  v_today_start := r.today_start;
  v_yesterday_start := r.today_start - INTERVAL '24 hours';
  v_last_day := LEAST(r.end_day, r.yesterday_day - 1);

  IF v_last_day >= r.start_day THEN
    SELECT COALESCE(SUM(d.seconds), 0)
    INTO v_seconds
    FROM heartbeats_daily d
    WHERE d."userId" = p_user_id
      AND d.bucket >= r.start_day::TIMESTAMP AT TIME ZONE 'UTC'
      AND d.bucket < (v_last_day + 1)::TIMESTAMP AT TIME ZONE 'UTC';
  END IF;

  IF r.yesterday_day >= r.start_day AND r.yesterday_day <= r.end_day THEN
    v_seconds := v_seconds + COALESCE((
      SELECT SUM(h.seconds)
      FROM "Heartbeats" h
      WHERE h."userId" = p_user_id AND h."timestamp" >= v_yesterday_start AND h."timestamp" < v_today_start
    ), 0);
  END IF;

  IF r.yesterday_day + 1 >= r.start_day AND r.yesterday_day + 1 <= r.end_day THEN
    v_seconds := v_seconds + COALESCE((
      SELECT SUM(h.seconds)
      FROM "Heartbeats" h
      WHERE h."userId" = p_user_id AND h."timestamp" >= v_today_start AND h."timestamp" < v_today_start + INTERVAL '24 hours'
    ), 0);
  END IF;

  RETURN QUERY SELECT
    ROUND(v_seconds / 60.0)::INT,
    ROUND(v_seconds / 3600.0, 2),
    r.start_day,
    r.end_day;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_leaderboard_stats()
RETURNS TABLE (
  user_id TEXT,
  total_minutes INT,
  top_editor TEXT,
  top_os TEXT,
  top_language TEXT
) AS $$
  WITH ranked AS (
    SELECT d."userId" AS uid, SUM(d.seconds) AS seconds
    FROM heartbeats_daily d
    JOIN "User" u ON u.id = d."userId" AND u."leaderboardEnabled" = true
    GROUP BY d."userId"
    HAVING SUM(d.seconds) > 0
    ORDER BY SUM(d.seconds) DESC
    LIMIT 100
  ),
  categories AS (
    SELECT d."userId" AS uid, 'editor'::TEXT AS kind, d.editor AS name, SUM(d.seconds) AS seconds
    FROM heartbeats_daily d WHERE d."userId" IN (SELECT uid FROM ranked) AND d.editor IS NOT NULL AND d.editor <> ''
    GROUP BY d."userId", d.editor
    UNION ALL
    SELECT d."userId", 'language', d.language, SUM(d.seconds)
    FROM heartbeats_daily d WHERE d."userId" IN (SELECT uid FROM ranked) AND d.language IS NOT NULL AND d.language <> ''
    GROUP BY d."userId", d.language
    UNION ALL
    SELECT d."userId", 'os', d.os, SUM(d.seconds)
    FROM heartbeats_daily d WHERE d."userId" IN (SELECT uid FROM ranked) AND d.os IS NOT NULL AND d.os <> ''
    GROUP BY d."userId", d.os
  ),
  top_category AS (
    SELECT DISTINCT ON (c.uid, c.kind) c.uid, c.kind, c.name
    FROM categories c
    ORDER BY c.uid, c.kind, c.seconds DESC, c.name
  )
  SELECT
    r.uid::TEXT,
    ROUND(r.seconds / 60.0)::INT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'editor')::TEXT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'os')::TEXT,
    (SELECT tc.name FROM top_category tc WHERE tc.uid = r.uid AND tc.kind = 'language')::TEXT
  FROM ranked r
  ORDER BY r.seconds DESC
$$ LANGUAGE sql STABLE;

DROP FUNCTION IF EXISTS compute_day_summary(TEXT, DATE);
DROP FUNCTION IF EXISTS heartbeat_seconds(TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP TABLE IF EXISTS "SummaryRebuild";
DROP TABLE IF EXISTS "Summaries" CASCADE;
ALTER TABLE "Heartbeats" DROP COLUMN IF EXISTS "summariesId";
