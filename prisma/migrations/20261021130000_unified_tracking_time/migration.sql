CREATE OR REPLACE FUNCTION tracking_timeout()
RETURNS INTERVAL AS $$
  SELECT INTERVAL '5 minutes'
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION heartbeat_seconds(
  p_user_id TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
) RETURNS TABLE (
  "timestamp" TIMESTAMPTZ,
  project TEXT,
  language TEXT,
  editor TEXT,
  os TEXT,
  file TEXT,
  branch TEXT,
  seconds NUMERIC
) AS $$
  SELECT
    x."timestamp",
    x.project,
    x.language,
    x.editor,
    x.os,
    x.file,
    x.branch,
    CASE
      WHEN x.next_ts IS NOT NULL AND x.next_ts - x."timestamp" <= tracking_timeout()
        THEN EXTRACT(EPOCH FROM (x.next_ts - x."timestamp"))
      ELSE 0
    END AS seconds
  FROM (
    SELECT
      h."timestamp",
      h.project,
      h.language,
      h.editor,
      h.os,
      h.file,
      h.branch,
      LEAD(h."timestamp") OVER (ORDER BY h."timestamp") AS next_ts
    FROM "Heartbeats" h
    WHERE h."userId" = p_user_id
      AND h."timestamp" >= p_start
      AND h."timestamp" < p_end
  ) x
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION compute_day_summary(p_user_id TEXT, p_day DATE)
RETURNS TABLE (
  heartbeat_count BIGINT,
  total_minutes INT,
  projects JSONB,
  languages JSONB,
  editors JSONB,
  os JSONB,
  files JSONB,
  branches JSONB
) AS $$
  WITH hs AS (
    SELECT *
    FROM heartbeat_seconds(
      p_user_id,
      p_day::TIMESTAMP AT TIME ZONE 'UTC',
      (p_day + 1)::TIMESTAMP AT TIME ZONE 'UTC'
    )
  )
  SELECT
    (SELECT COUNT(*) FROM hs),
    ROUND(COALESCE((SELECT SUM(seconds) FROM hs), 0) / 60.0)::INT,
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT project AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE project IS NOT NULL GROUP BY project) q), '{}'::JSONB),
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT language AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE language IS NOT NULL GROUP BY language) q), '{}'::JSONB),
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT editor AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE editor IS NOT NULL GROUP BY editor) q), '{}'::JSONB),
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT os AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE os IS NOT NULL GROUP BY os) q), '{}'::JSONB),
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT file AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE file IS NOT NULL GROUP BY file) q), '{}'::JSONB),
    COALESCE((SELECT jsonb_object_agg(k, s) FROM (SELECT branch AS k, ROUND(SUM(seconds))::INT AS s FROM hs WHERE branch IS NOT NULL GROUP BY branch) q), '{}'::JSONB)
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION live_day_summary(
  p_user_id TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_offset_seconds INT
) RETURNS JSONB AS $$
  WITH hs AS (
    SELECT * FROM heartbeat_seconds(p_user_id, p_start, p_end)
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

CREATE OR REPLACE FUNCTION resolve_time_range(
  p_time_range TEXT,
  p_offset_seconds INT DEFAULT 0
) RETURNS TABLE (
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ,
  start_day DATE,
  end_day DATE,
  is_single_day BOOLEAN,
  today_start TIMESTAMPTZ,
  yesterday_day DATE
) AS $$
DECLARE
  v_offset INTERVAL := make_interval(secs => p_offset_seconds);
  v_local_now TIMESTAMP := (NOW() AT TIME ZONE 'UTC') + make_interval(secs => p_offset_seconds);
  v_today TIMESTAMP := date_trunc('day', (NOW() AT TIME ZONE 'UTC') + make_interval(secs => p_offset_seconds));
  v_start TIMESTAMP;
  v_end TIMESTAMP;
  v_single BOOLEAN := FALSE;
  v_end_now BOOLEAN := FALSE;
BEGIN
  v_end := v_today + INTERVAL '1 day' - INTERVAL '1 millisecond';

  CASE p_time_range
    WHEN 'TODAY' THEN
      v_start := v_today;
      v_single := TRUE;
      v_end_now := TRUE;
    WHEN 'YESTERDAY' THEN
      v_start := v_today - INTERVAL '1 day';
      v_end := v_today - INTERVAL '1 millisecond';
      v_single := TRUE;
    WHEN 'WEEK' THEN
      v_start := v_today - INTERVAL '6 days';
    WHEN 'MONTH' THEN
      v_start := v_today - INTERVAL '29 days';
    WHEN 'MONTH_TO_DATE' THEN
      v_start := date_trunc('month', v_local_now);
    WHEN 'LAST_MONTH' THEN
      v_start := date_trunc('month', v_local_now - INTERVAL '1 month');
      v_end := date_trunc('month', v_local_now) - INTERVAL '1 millisecond';
    WHEN 'LAST_90_DAYS' THEN
      v_start := v_today - INTERVAL '89 days';
    WHEN 'YEAR_TO_DATE' THEN
      v_start := date_trunc('year', v_local_now);
    WHEN 'LAST_12_MONTHS' THEN
      v_start := v_today - INTERVAL '1 year';
    WHEN 'ALL_TIME' THEN
      v_start := '1970-01-01'::TIMESTAMP;
    ELSE
      v_start := v_today;
      v_single := TRUE;
  END CASE;

  RETURN QUERY SELECT
    (v_start - v_offset) AT TIME ZONE 'UTC',
    CASE WHEN v_end_now THEN NOW() ELSE (v_end - v_offset) AT TIME ZONE 'UTC' END,
    v_start::DATE,
    v_end::DATE,
    v_single,
    (v_today - v_offset) AT TIME ZONE 'UTC',
    (v_today - INTERVAL '1 day')::DATE;
END;
$$ LANGUAGE plpgsql STABLE;

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
      SELECT
        TO_CHAR(s.date, 'YYYY-MM-DD') AS date_str,
        jsonb_build_object(
          'date', TO_CHAR(s.date, 'YYYY-MM-DD'),
          'totalSeconds', s."totalMinutes" * 60,
          'projects', COALESCE(s.projects::JSONB, '{}'::JSONB),
          'languages', COALESCE(s.languages::JSONB, '{}'::JSONB),
          'editors', COALESCE(s.editors::JSONB, '{}'::JSONB),
          'os', COALESCE(s.os::JSONB, '{}'::JSONB),
          'files', COALESCE(s.files::JSONB, '{}'::JSONB),
          'branches', COALESCE(s.branches::JSONB, '{}'::JSONB),
          'hourlyData', (SELECT jsonb_agg(jsonb_build_object('seconds', 0)) FROM generate_series(0, 23))
        ) AS obj
      FROM "Summaries" s
      WHERE s."userId" = p_user_id
        AND s.date >= r.start_day
        AND s.date <= r.end_day
        AND s.date < r.yesterday_day
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
BEGIN
  PERFORM 1 FROM "User" WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO r FROM resolve_time_range(p_time_range, p_offset_seconds);
  v_today_start := r.today_start;
  v_yesterday_start := r.today_start - INTERVAL '24 hours';

  SELECT COALESCE(SUM(s."totalMinutes"), 0) * 60
  INTO v_seconds
  FROM "Summaries" s
  WHERE s."userId" = p_user_id
    AND s.date >= r.start_day
    AND s.date <= r.end_day
    AND s.date < r.yesterday_day;

  IF r.yesterday_day >= r.start_day AND r.yesterday_day <= r.end_day THEN
    v_seconds := v_seconds + COALESCE((
      SELECT SUM(hs.seconds)
      FROM heartbeat_seconds(p_user_id, v_yesterday_start, v_today_start) hs
    ), 0);
  END IF;

  IF r.yesterday_day + 1 >= r.start_day AND r.yesterday_day + 1 <= r.end_day THEN
    v_seconds := v_seconds + COALESCE((
      SELECT SUM(hs.seconds)
      FROM heartbeat_seconds(p_user_id, v_today_start, v_today_start + INTERVAL '24 hours') hs
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
DECLARE
  v_today_start TIMESTAMPTZ := time_bucket(INTERVAL '1 day', NOW());
  v_yesterday_start TIMESTAMPTZ := time_bucket(INTERVAL '1 day', NOW()) - INTERVAL '24 hours';
  v_summary_cutoff DATE := ((time_bucket(INTERVAL '1 day', NOW()) - INTERVAL '24 hours') AT TIME ZONE 'UTC')::DATE;
BEGIN
  RETURN QUERY
  WITH enabled_users AS (
    SELECT u.id
    FROM "User" u
    WHERE u."leaderboardEnabled" = true
  ),
  live AS (
    SELECT eu.id AS uid, hs.editor, hs.language, hs.os, hs.seconds
    FROM enabled_users eu
    CROSS JOIN (VALUES (v_yesterday_start), (v_today_start)) d(day_start)
    CROSS JOIN LATERAL heartbeat_seconds(
      eu.id,
      d.day_start,
      d.day_start + INTERVAL '24 hours'
    ) hs
  ),
  totals AS (
    SELECT t.uid, SUM(t.seconds) AS seconds
    FROM (
      SELECT s."userId" AS uid, s."totalMinutes"::NUMERIC * 60 AS seconds
      FROM "Summaries" s
      WHERE s."userId" IN (SELECT id FROM enabled_users)
        AND s.date < v_summary_cutoff
      UNION ALL
      SELECT l.uid, l.seconds FROM live l
    ) t
    GROUP BY t.uid
  ),
  ranked AS (
    SELECT t.uid, t.seconds
    FROM totals t
    WHERE t.seconds > 0
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
    SELECT l.uid, 'editor', l.editor, l.seconds
    FROM live l WHERE l.uid IN (SELECT uid FROM ranked) AND l.editor IS NOT NULL
    UNION ALL
    SELECT l.uid, 'language', l.language, l.seconds
    FROM live l WHERE l.uid IN (SELECT uid FROM ranked) AND l.language IS NOT NULL
    UNION ALL
    SELECT l.uid, 'os', l.os, l.seconds
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

DELETE FROM "Summaries" s
USING (
  SELECT id, date, ROW_NUMBER() OVER (
    PARTITION BY "userId", date ORDER BY "createdAt" DESC, id DESC
  ) AS rn
  FROM "Summaries"
) d
WHERE s.id = d.id AND s.date = d.date AND d.rn > 1;

CREATE UNIQUE INDEX "Summaries_userId_date_key" ON "Summaries"("userId", date);

CREATE TABLE "SummaryRebuild" (
  "userId" TEXT NOT NULL,
  CONSTRAINT "SummaryRebuild_pkey" PRIMARY KEY ("userId")
);

INSERT INTO "SummaryRebuild" ("userId") SELECT id FROM "User";

ALTER TABLE "User" DROP COLUMN "keystrokeTimeout";
