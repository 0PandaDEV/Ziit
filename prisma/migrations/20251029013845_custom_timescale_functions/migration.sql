-- Leaderboard aggragation function
CREATE OR REPLACE FUNCTION get_leaderboard_stats()
RETURNS TABLE (
  user_id TEXT,
  total_minutes INT,
  top_editor TEXT,
  top_os TEXT,
  top_language TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH enabled_users AS (
    SELECT u.id, u."keystrokeTimeout"
    FROM "User" u
    WHERE u."leaderboardEnabled" = true
  ),
  summary_totals AS (
    SELECT
      s."userId",
      SUM(s."totalMinutes") as total_mins
    FROM "Summaries" s
    JOIN enabled_users u ON s."userId" = u.id
    GROUP BY s."userId"
  ),
  heartbeat_stats AS (
    SELECT
      h."userId",
      h.editor,
      h.os,
      h.language,
      COUNT(*) as usage_count
    FROM "Heartbeats" h
    JOIN enabled_users u ON h."userId" = u.id
    WHERE h."userId" IN (SELECT "userId" FROM summary_totals)
    GROUP BY h."userId", h.editor, h.os, h.language
  ),
  user_final AS (
    SELECT
      st."userId" as uid,
      st.total_mins,
      (SELECT hs.editor FROM heartbeat_stats hs 
       WHERE hs."userId" = st."userId" AND hs.editor IS NOT NULL
       ORDER BY hs.usage_count DESC LIMIT 1) as ed,
      (SELECT hs.os FROM heartbeat_stats hs 
       WHERE hs."userId" = st."userId" AND hs.os IS NOT NULL
       ORDER BY hs.usage_count DESC LIMIT 1) as operating_system,
      (SELECT hs.language FROM heartbeat_stats hs 
       WHERE hs."userId" = st."userId" AND hs.language IS NOT NULL
       ORDER BY hs.usage_count DESC LIMIT 1) as lang
    FROM summary_totals st
    WHERE st.total_mins > 0
  )
  SELECT
    uid::TEXT,
    ROUND(total_mins)::INT,
    ed::TEXT,
    operating_system::TEXT,
    lang::TEXT
  FROM user_final
  ORDER BY total_mins DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql STABLE;


-- Specific user specific time aggragation function 
CREATE OR REPLACE FUNCTION get_user_stats(
  p_user_id TEXT,
  p_time_range TEXT,
  p_offset_seconds INT DEFAULT 0,
  p_project_filter TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_keystroke_timeout INT;
  v_start_date TIMESTAMP;
  v_end_date TIMESTAMP;
  v_is_single_day BOOLEAN := FALSE;
  v_now TIMESTAMP;
  v_today_start TIMESTAMP;
  v_today_end TIMESTAMP;
  v_result JSON;
BEGIN
  SELECT "keystrokeTimeout" INTO v_keystroke_timeout
  FROM "User"
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  v_now := NOW() - (p_offset_seconds || ' seconds')::INTERVAL;
  v_today_start := DATE_TRUNC('day', v_now) + (p_offset_seconds || ' seconds')::INTERVAL;
  v_today_end := v_today_start + INTERVAL '1 day' - INTERVAL '1 millisecond';
  
  CASE p_time_range
    WHEN 'TODAY' THEN
      v_start_date := v_today_start;
      v_end_date := NOW();
      v_is_single_day := TRUE;
      
    WHEN 'YESTERDAY' THEN
      v_start_date := v_today_start - INTERVAL '1 day';
      v_end_date := v_today_end - INTERVAL '1 day';
      v_is_single_day := TRUE;
      
    WHEN 'WEEK' THEN
      v_start_date := v_today_start - INTERVAL '6 days';
      v_end_date := v_today_end;
      
    WHEN 'MONTH' THEN
      v_start_date := v_today_start - INTERVAL '29 days';
      v_end_date := v_today_end;
      
    WHEN 'MONTH_TO_DATE' THEN
      v_start_date := DATE_TRUNC('month', v_now) + (p_offset_seconds || ' seconds')::INTERVAL;
      v_end_date := v_today_end;
      
    WHEN 'LAST_MONTH' THEN
      v_start_date := DATE_TRUNC('month', v_now - INTERVAL '1 month') + (p_offset_seconds || ' seconds')::INTERVAL;
      v_end_date := (DATE_TRUNC('month', v_now) - INTERVAL '1 millisecond') + (p_offset_seconds || ' seconds')::INTERVAL;
      
    WHEN 'LAST_90_DAYS' THEN
      v_start_date := v_today_start - INTERVAL '89 days';
      v_end_date := v_today_end;
      
    WHEN 'YEAR_TO_DATE' THEN
      v_start_date := DATE_TRUNC('year', v_now) + (p_offset_seconds || ' seconds')::INTERVAL;
      v_end_date := v_today_end;
      
    WHEN 'LAST_12_MONTHS' THEN
      v_start_date := v_today_start - INTERVAL '1 year';
      v_end_date := v_today_end;
      
    WHEN 'ALL_TIME' THEN
      v_start_date := '1970-01-01'::TIMESTAMP;
      v_end_date := v_today_end;
      
    ELSE
      v_start_date := v_today_start;
      v_end_date := v_today_end;
      v_is_single_day := TRUE;
  END CASE;
  
  IF v_is_single_day THEN
    v_result := (
      WITH heartbeat_pairs AS (
        SELECT
          h.timestamp,
          h.project,
          h.language,
          h.editor,
          h.os,
          h.file,
          h.branch,
          EXTRACT(HOUR FROM h.timestamp - (p_offset_seconds || ' seconds')::INTERVAL) as hour,
          LAG(h.timestamp) OVER (ORDER BY h.timestamp) as prev_timestamp
        FROM "Heartbeats" h
        WHERE h."userId" = p_user_id
          AND h.timestamp >= v_start_date
          AND h.timestamp <= v_end_date
        ORDER BY h.timestamp
      ),
      calculated_times AS (
        SELECT
          timestamp,
          project,
          language,
          editor,
          os,
          file,
          branch,
          hour,
          CASE
            WHEN prev_timestamp IS NULL THEN 30  -- First heartbeat
            WHEN EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) > (v_keystroke_timeout * 60) THEN 30  -- New session
            ELSE LEAST(EXTRACT(EPOCH FROM (timestamp - prev_timestamp)), v_keystroke_timeout * 60)  -- Time since last
          END as seconds_to_add
        FROM heartbeat_pairs
      ),
      hourly_stats AS (
        SELECT
          hour::INT as hour_num,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        GROUP BY hour
      ),
      category_stats AS (
        SELECT
          'projects' as category,
          project as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE project IS NOT NULL
        GROUP BY project
        
        UNION ALL
        
        SELECT
          'languages' as category,
          language as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE language IS NOT NULL
        GROUP BY language
        
        UNION ALL
        
        SELECT
          'editors' as category,
          editor as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE editor IS NOT NULL
        GROUP BY editor
        
        UNION ALL
        
        SELECT
          'os' as category,
          os as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE os IS NOT NULL
        GROUP BY os
        
        UNION ALL
        
        SELECT
          'files' as category,
          file as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE file IS NOT NULL
        GROUP BY file
        
        UNION ALL
        
        SELECT
          'branches' as category,
          branch as name,
          SUM(seconds_to_add)::INT as seconds
        FROM calculated_times
        WHERE branch IS NOT NULL
        GROUP BY branch
      ),
      summary_data AS (
        SELECT
          TO_CHAR(v_start_date - (p_offset_seconds || ' seconds')::INTERVAL, 'YYYY-MM-DD') as date_str,
          COALESCE(SUM(seconds_to_add), 0)::INT as total_seconds
        FROM calculated_times
      )
      SELECT json_build_object(
        'summaries', json_build_array(
          json_build_object(
            'date', (SELECT date_str FROM summary_data),
            'totalSeconds', (SELECT total_seconds FROM summary_data),
            'projects', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'projects'), '{}'::json),
            'languages', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'languages'), '{}'::json),
            'editors', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'editors'), '{}'::json),
            'os', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'os'), '{}'::json),
            'files', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'files'), '{}'::json),
            'branches', COALESCE((SELECT json_object_agg(name, seconds) FROM category_stats WHERE category = 'branches'), '{}'::json),
            'hourlyData', COALESCE(
              (SELECT json_agg(
                json_build_object('seconds', COALESCE(h.seconds, 0))
                ORDER BY n.hour
              )
              FROM generate_series(0, 23) n(hour)
              LEFT JOIN hourly_stats h ON h.hour_num = n.hour),
              (SELECT json_agg(json_build_object('seconds', 0)) FROM generate_series(0, 23))
            )
          )
        ),
        'offsetSeconds', p_offset_seconds,
        'projectSeconds', CASE 
          WHEN p_project_filter IS NOT NULL THEN
            CASE 
              WHEN p_project_filter = 'all' THEN (SELECT total_seconds FROM summary_data)
              ELSE COALESCE((SELECT seconds FROM category_stats WHERE category = 'projects' AND LOWER(name) = LOWER(p_project_filter)), 0)
            END
          ELSE NULL
        END,
        'projectFilter', p_project_filter
      )
    );
  ELSE
    v_result := (
      WITH daily_summaries AS (
        SELECT
          TO_CHAR(s.date, 'YYYY-MM-DD') as date_str,
          s."totalMinutes" * 60 as total_seconds,
          COALESCE(s.projects::json, '{}'::json) as projects,
          COALESCE(s.languages::json, '{}'::json) as languages,
          COALESCE(s.editors::json, '{}'::json) as editors,
          COALESCE(s.os::json, '{}'::json) as os,
          COALESCE(s.files::json, '{}'::json) as files,
          COALESCE(s.branches::json, '{}'::json) as branches
        FROM "Summaries" s
        WHERE s."userId" = p_user_id
          AND s.date >= v_start_date::DATE
          AND s.date <= v_end_date::DATE
        ORDER BY s.date
      ),
      project_totals AS (
        SELECT
          SUM((projects->>(p_project_filter))::INT) as project_seconds
        FROM daily_summaries
        WHERE p_project_filter IS NOT NULL 
          AND p_project_filter != 'all'
          AND projects->>(p_project_filter) IS NOT NULL
      )
      SELECT json_build_object(
        'summaries', COALESCE(
          (SELECT json_agg(
            json_build_object(
              'date', date_str,
              'totalSeconds', total_seconds,
              'projects', projects,
              'languages', languages,
              'editors', editors,
              'os', os,
              'files', files,
              'branches', branches,
              'hourlyData', (SELECT json_agg(json_build_object('seconds', 0)) FROM generate_series(0, 23))
            )
            ORDER BY date_str
          ) FROM daily_summaries),
          '[]'::json
        ),
        'offsetSeconds', p_offset_seconds,
        'projectSeconds', CASE 
          WHEN p_project_filter IS NOT NULL THEN
            CASE 
              WHEN p_project_filter = 'all' THEN (SELECT SUM(total_seconds)::INT FROM daily_summaries)
              ELSE COALESCE((SELECT project_seconds FROM project_totals), 0)
            END
          ELSE NULL
        END,
        'projectFilter', p_project_filter
      )
    );
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;


-- Specific Time Range User total aggragation function
CREATE OR REPLACE FUNCTION get_user_time_range_total(
  p_user_id TEXT,
  p_time_range TEXT
) RETURNS TABLE (
  total_minutes INT,
  total_hours NUMERIC,
  start_date DATE,
  end_date DATE
) AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  CASE p_time_range
    WHEN 'TODAY' THEN
      v_start_date := CURRENT_DATE;
      v_end_date := CURRENT_DATE;
      
    WHEN 'YESTERDAY' THEN
      v_start_date := CURRENT_DATE - 1;
      v_end_date := CURRENT_DATE - 1;
      
    WHEN 'WEEK' THEN
      v_start_date := CURRENT_DATE - 6;
      v_end_date := CURRENT_DATE;
      
    WHEN 'MONTH' THEN
      v_start_date := CURRENT_DATE - 29;
      v_end_date := CURRENT_DATE;
      
    WHEN 'LAST_MONTH' THEN
      v_start_date := DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')::DATE;
      v_end_date := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::DATE;
      
    WHEN 'YEAR_TO_DATE' THEN
      v_start_date := DATE_TRUNC('year', CURRENT_DATE)::DATE;
      v_end_date := CURRENT_DATE;
      
    WHEN 'ALL_TIME' THEN
      v_start_date := '1970-01-01'::DATE;
      v_end_date := CURRENT_DATE;
      
    ELSE
      v_start_date := CURRENT_DATE;
      v_end_date := CURRENT_DATE;
  END CASE;
  
  RETURN QUERY
  SELECT
    COALESCE(SUM(s."totalMinutes"), 0)::INT as total_minutes,
    ROUND(COALESCE(SUM(s."totalMinutes"), 0) / 60.0, 2) as total_hours,
    v_start_date as start_date,
    v_end_date as end_date
  FROM "Summaries" s
  WHERE s."userId" = p_user_id
    AND s.date >= v_start_date
    AND s.date <= v_end_date;
END;
$$ LANGUAGE plpgsql STABLE;