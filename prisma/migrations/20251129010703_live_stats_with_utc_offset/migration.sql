-- Combined migration: Live today/yesterday calculation with UTC offset
-- Fixes timezone issues and calculates current data live from heartbeats
CREATE OR REPLACE FUNCTION get_user_stats(
    p_user_id TEXT,
    p_time_range TEXT,
    p_offset_seconds INT DEFAULT 0,
    p_project_filter TEXT DEFAULT NULL
  ) RETURNS JSON AS $$
DECLARE v_keystroke_timeout INT;
v_start_ts TIMESTAMPTZ;
v_end_ts TIMESTAMPTZ;
v_is_single_day BOOLEAN := FALSE;
v_today_start TIMESTAMPTZ;
v_today_end TIMESTAMPTZ;
v_yesterday_start TIMESTAMPTZ;
v_yesterday_end TIMESTAMPTZ;
v_result JSON;
BEGIN
SELECT "keystrokeTimeout" INTO v_keystroke_timeout
FROM "User"
WHERE id = p_user_id;
IF NOT FOUND THEN RAISE EXCEPTION 'User not found';
END IF;
v_today_start := date_trunc(
  'day',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
) - (p_offset_seconds || ' seconds')::INTERVAL;
v_today_end := v_today_start + INTERVAL '1 day' - INTERVAL '1 millisecond';
v_yesterday_start := v_today_start - INTERVAL '1 day';
v_yesterday_end := v_today_end - INTERVAL '1 day';
CASE
  p_time_range
  WHEN 'TODAY' THEN v_start_ts := v_today_start;
v_end_ts := NOW();
v_is_single_day := TRUE;
WHEN 'YESTERDAY' THEN v_start_ts := v_yesterday_start;
v_end_ts := v_yesterday_end;
v_is_single_day := TRUE;
WHEN 'WEEK' THEN v_start_ts := v_today_start - INTERVAL '6 days';
v_end_ts := v_today_end;
WHEN 'MONTH' THEN v_start_ts := v_today_start - INTERVAL '29 days';
v_end_ts := v_today_end;
WHEN 'MONTH_TO_DATE' THEN v_start_ts := date_trunc(
  'month',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
) - (p_offset_seconds || ' seconds')::INTERVAL;
v_end_ts := v_today_end;
WHEN 'LAST_MONTH' THEN v_start_ts := date_trunc(
  'month',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL - INTERVAL '1 month'
) - (p_offset_seconds || ' seconds')::INTERVAL;
v_end_ts := date_trunc(
  'month',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
) - (p_offset_seconds || ' seconds')::INTERVAL - INTERVAL '1 millisecond';
WHEN 'LAST_90_DAYS' THEN v_start_ts := v_today_start - INTERVAL '89 days';
v_end_ts := v_today_end;
WHEN 'YEAR_TO_DATE' THEN v_start_ts := date_trunc(
  'year',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
) - (p_offset_seconds || ' seconds')::INTERVAL;
v_end_ts := v_today_end;
WHEN 'LAST_12_MONTHS' THEN v_start_ts := v_today_start - INTERVAL '1 year';
v_end_ts := v_today_end;
WHEN 'ALL_TIME' THEN v_start_ts := '1970-01-01'::TIMESTAMPTZ;
v_end_ts := v_today_end;
ELSE v_start_ts := v_today_start;
v_end_ts := v_today_end;
v_is_single_day := TRUE;
END CASE
;
IF v_is_single_day THEN v_result := (
  WITH heartbeat_pairs AS (
    SELECT h.timestamp,
      h.project,
      h.language,
      h.editor,
      h.os,
      h.file,
      h.branch,
      EXTRACT(
        HOUR
        FROM h.timestamp + (p_offset_seconds || ' seconds')::INTERVAL
      ) as hour,
      LAG(h.timestamp) OVER (
        ORDER BY h.timestamp
      ) as prev_timestamp
    FROM "Heartbeats" h
    WHERE h."userId" = p_user_id
      AND h.timestamp >= v_start_ts
      AND h.timestamp <= v_end_ts
    ORDER BY h.timestamp
  ),
  calculated_times AS (
    SELECT timestamp,
      project,
      language,
      editor,
      os,
      file,
      branch,
      hour,
      CASE
        WHEN prev_timestamp IS NULL THEN 30
        WHEN EXTRACT(
          EPOCH
          FROM (timestamp - prev_timestamp)
        ) > (v_keystroke_timeout * 60) THEN 30
        ELSE LEAST(
          EXTRACT(
            EPOCH
            FROM (timestamp - prev_timestamp)
          ),
          v_keystroke_timeout * 60
        )
      END as seconds_to_add
    FROM heartbeat_pairs
  ),
  hourly_stats AS (
    SELECT hour::INT as hour_num,
      LEAST(SUM(seconds_to_add)::INT, 3600) as seconds
    FROM calculated_times
    GROUP BY hour
  ),
  category_stats AS (
    SELECT 'projects' as category,
      project as name,
      SUM(seconds_to_add)::INT as seconds
    FROM calculated_times
    WHERE project IS NOT NULL
    GROUP BY project
    UNION ALL
    SELECT 'languages',
      language,
      SUM(seconds_to_add)::INT
    FROM calculated_times
    WHERE language IS NOT NULL
    GROUP BY language
    UNION ALL
    SELECT 'editors',
      editor,
      SUM(seconds_to_add)::INT
    FROM calculated_times
    WHERE editor IS NOT NULL
    GROUP BY editor
    UNION ALL
    SELECT 'os',
      os,
      SUM(seconds_to_add)::INT
    FROM calculated_times
    WHERE os IS NOT NULL
    GROUP BY os
    UNION ALL
    SELECT 'files',
      file,
      SUM(seconds_to_add)::INT
    FROM calculated_times
    WHERE file IS NOT NULL
    GROUP BY file
    UNION ALL
    SELECT 'branches',
      branch,
      SUM(seconds_to_add)::INT
    FROM calculated_times
    WHERE branch IS NOT NULL
    GROUP BY branch
  ),
  summary_data AS (
    SELECT TO_CHAR(
        v_start_ts + (p_offset_seconds || ' seconds')::INTERVAL,
        'YYYY-MM-DD'
      ) as date_str,
      COALESCE(SUM(seconds_to_add), 0)::INT as total_seconds
    FROM calculated_times
  )
  SELECT json_build_object(
      'summaries',
      json_build_array(
        json_build_object(
          'date',
          (
            SELECT date_str
            FROM summary_data
          ),
          'totalSeconds',
          (
            SELECT total_seconds
            FROM summary_data
          ),
          'projects',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'projects'
            ),
            '{}'::json
          ),
          'languages',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'languages'
            ),
            '{}'::json
          ),
          'editors',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'editors'
            ),
            '{}'::json
          ),
          'os',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'os'
            ),
            '{}'::json
          ),
          'files',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'files'
            ),
            '{}'::json
          ),
          'branches',
          COALESCE(
            (
              SELECT json_object_agg(name, seconds)
              FROM category_stats
              WHERE category = 'branches'
            ),
            '{}'::json
          ),
          'hourlyData',
          COALESCE(
            (
              SELECT json_agg(
                  json_build_object('seconds', COALESCE(h.seconds, 0))
                  ORDER BY n.hour
                )
              FROM generate_series(0, 23) n(hour)
                LEFT JOIN hourly_stats h ON h.hour_num = n.hour
            ),
            (
              SELECT json_agg(json_build_object('seconds', 0))
              FROM generate_series(0, 23)
            )
          )
        )
      ),
      'offsetSeconds',
      p_offset_seconds,
      'projectSeconds',
      CASE
        WHEN p_project_filter IS NOT NULL THEN CASE
          WHEN LOWER(p_project_filter) = 'all' THEN (
            SELECT total_seconds
            FROM summary_data
          )
          ELSE COALESCE(
            (
              SELECT seconds
              FROM category_stats
              WHERE category = 'projects'
                AND LOWER(name) = LOWER(p_project_filter)
            ),
            0
          )
        END
        ELSE NULL
      END,
      'projectFilter',
      p_project_filter
    )
);
ELSE v_result := (
  WITH today_heartbeats AS (
    SELECT h.timestamp,
      h.project,
      h.language,
      h.editor,
      h.os,
      h.file,
      h.branch,
      LAG(h.timestamp) OVER (
        ORDER BY h.timestamp
      ) as prev_timestamp
    FROM "Heartbeats" h
    WHERE h."userId" = p_user_id
      AND h.timestamp >= v_today_start
      AND h.timestamp <= v_today_end
    ORDER BY h.timestamp
  ),
  today_calculated AS (
    SELECT project,
      language,
      editor,
      os,
      file,
      branch,
      CASE
        WHEN prev_timestamp IS NULL THEN 30
        WHEN EXTRACT(
          EPOCH
          FROM (timestamp - prev_timestamp)
        ) > (v_keystroke_timeout * 60) THEN 30
        ELSE LEAST(
          EXTRACT(
            EPOCH
            FROM (timestamp - prev_timestamp)
          ),
          v_keystroke_timeout * 60
        )
      END as seconds_to_add
    FROM today_heartbeats
  ),
  today_category_stats AS (
    SELECT 'projects',
      project,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE project IS NOT NULL
    GROUP BY project
    UNION ALL
    SELECT 'languages',
      language,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE language IS NOT NULL
    GROUP BY language
    UNION ALL
    SELECT 'editors',
      editor,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE editor IS NOT NULL
    GROUP BY editor
    UNION ALL
    SELECT 'os',
      os,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE os IS NOT NULL
    GROUP BY os
    UNION ALL
    SELECT 'files',
      file,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE file IS NOT NULL
    GROUP BY file
    UNION ALL
    SELECT 'branches',
      branch,
      SUM(seconds_to_add)::INT
    FROM today_calculated
    WHERE branch IS NOT NULL
    GROUP BY branch
  ),
  today_summary AS (
    SELECT TO_CHAR(
        v_today_start + (p_offset_seconds || ' seconds')::INTERVAL,
        'YYYY-MM-DD'
      ) as date_str,
      COALESCE(SUM(seconds_to_add), 0)::INT as total_seconds,
      COALESCE(
        (
          SELECT json_object_agg(project, sum)
          FROM (
              SELECT project,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE project IS NOT NULL
              GROUP BY project
            ) x
        ),
        '{}'::json
      ) as projects,
      COALESCE(
        (
          SELECT json_object_agg(language, sum)
          FROM (
              SELECT language,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE language IS NOT NULL
              GROUP BY language
            ) x
        ),
        '{}'::json
      ) as languages,
      COALESCE(
        (
          SELECT json_object_agg(editor, sum)
          FROM (
              SELECT editor,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE editor IS NOT NULL
              GROUP BY editor
            ) x
        ),
        '{}'::json
      ) as editors,
      COALESCE(
        (
          SELECT json_object_agg(os, sum)
          FROM (
              SELECT os,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE os IS NOT NULL
              GROUP BY os
            ) x
        ),
        '{}'::json
      ) as os,
      COALESCE(
        (
          SELECT json_object_agg(file, sum)
          FROM (
              SELECT file,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE file IS NOT NULL
              GROUP BY file
            ) x
        ),
        '{}'::json
      ) as files,
      COALESCE(
        (
          SELECT json_object_agg(branch, sum)
          FROM (
              SELECT branch,
                SUM(seconds_to_add)::INT as sum
              FROM today_calculated
              WHERE branch IS NOT NULL
              GROUP BY branch
            ) x
        ),
        '{}'::json
      ) as branches
    FROM today_calculated
  ),
  yesterday_heartbeats AS (
    SELECT h.timestamp,
      h.project,
      h.language,
      h.editor,
      h.os,
      h.file,
      h.branch,
      LAG(h.timestamp) OVER (
        ORDER BY h.timestamp
      ) as prev_timestamp
    FROM "Heartbeats" h
    WHERE h."userId" = p_user_id
      AND h.timestamp >= v_yesterday_start
      AND h.timestamp <= v_yesterday_end
    ORDER BY h.timestamp
  ),
  yesterday_calculated AS (
    SELECT project,
      language,
      editor,
      os,
      file,
      branch,
      CASE
        WHEN prev_timestamp IS NULL THEN 30
        WHEN EXTRACT(
          EPOCH
          FROM (timestamp - prev_timestamp)
        ) > (v_keystroke_timeout * 60) THEN 30
        ELSE LEAST(
          EXTRACT(
            EPOCH
            FROM (timestamp - prev_timestamp)
          ),
          v_keystroke_timeout * 60
        )
      END as seconds_to_add
    FROM yesterday_heartbeats
  ),
  yesterday_summary AS (
    SELECT TO_CHAR(
        v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL,
        'YYYY-MM-DD'
      ) as date_str,
      COALESCE(SUM(seconds_to_add), 0)::INT as total_seconds,
      COALESCE(
        (
          SELECT json_object_agg(project, sum)
          FROM (
              SELECT project,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE project IS NOT NULL
              GROUP BY project
            ) x
        ),
        '{}'::json
      ) as projects,
      COALESCE(
        (
          SELECT json_object_agg(language, sum)
          FROM (
              SELECT language,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE language IS NOT NULL
              GROUP BY language
            ) x
        ),
        '{}'::json
      ) as languages,
      COALESCE(
        (
          SELECT json_object_agg(editor, sum)
          FROM (
              SELECT editor,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE editor IS NOT NULL
              GROUP BY editor
            ) x
        ),
        '{}'::json
      ) as editors,
      COALESCE(
        (
          SELECT json_object_agg(os, sum)
          FROM (
              SELECT os,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE os IS NOT NULL
              GROUP BY os
            ) x
        ),
        '{}'::json
      ) as os,
      COALESCE(
        (
          SELECT json_object_agg(file, sum)
          FROM (
              SELECT file,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE file IS NOT NULL
              GROUP BY file
            ) x
        ),
        '{}'::json
      ) as files,
      COALESCE(
        (
          SELECT json_object_agg(branch, sum)
          FROM (
              SELECT branch,
                SUM(seconds_to_add)::INT as sum
              FROM yesterday_calculated
              WHERE branch IS NOT NULL
              GROUP BY branch
            ) x
        ),
        '{}'::json
      ) as branches
    FROM yesterday_calculated
  ),
  old_summaries AS (
    SELECT TO_CHAR(s.date, 'YYYY-MM-DD') as date_str,
      s."totalMinutes" * 60 as total_seconds,
      COALESCE(s.projects::json, '{}'::json) as projects,
      COALESCE(s.languages::json, '{}'::json) as languages,
      COALESCE(s.editors::json, '{}'::json) as editors,
      COALESCE(s.os::json, '{}'::json) as os,
      COALESCE(s.files::json, '{}'::json) as files,
      COALESCE(s.branches::json, '{}'::json) as branches
    FROM "Summaries" s
    WHERE s."userId" = p_user_id
      AND s.date >= (
        v_start_ts + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE
      AND s.date < (
        v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE
    ORDER BY s.date
  ),
  all_summaries AS (
    SELECT *
    FROM old_summaries
    UNION ALL
    SELECT *
    FROM yesterday_summary
    WHERE total_seconds > 0
    UNION ALL
    SELECT *
    FROM today_summary
    WHERE total_seconds > 0
  ),
  project_filter_seconds AS (
    SELECT SUM(kv.value::INT) as total
    FROM all_summaries,
      LATERAL json_each_text(projects) AS kv(key, value)
    WHERE p_project_filter IS NOT NULL
      AND LOWER(p_project_filter) != 'all'
      AND LOWER(kv.key) = LOWER(p_project_filter)
  )
  SELECT json_build_object(
      'summaries',
      COALESCE(
        (
          SELECT json_agg(
              json_build_object(
                'date',
                date_str,
                'totalSeconds',
                total_seconds,
                'projects',
                projects,
                'languages',
                languages,
                'editors',
                editors,
                'os',
                os,
                'files',
                files,
                'branches',
                branches,
                'hourlyData',
                (
                  SELECT json_agg(json_build_object('seconds', 0))
                  FROM generate_series(0, 23)
                )
              )
              ORDER BY date_str
            )
          FROM all_summaries
        ),
        '[]'::json
      ),
      'offsetSeconds',
      p_offset_seconds,
      'projectSeconds',
      CASE
        WHEN p_project_filter IS NOT NULL THEN CASE
          WHEN LOWER(p_project_filter) = 'all' THEN (
            SELECT SUM(total_seconds)::INT
            FROM all_summaries
          )
          ELSE COALESCE(
            (
              SELECT total
              FROM project_filter_seconds
            ),
            0
          )
        END
        ELSE NULL
      END,
      'projectFilter',
      p_project_filter
    )
);
END IF;
RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;
-- Update get_user_time_range_total to also calculate today and yesterday live
CREATE OR REPLACE FUNCTION get_user_time_range_total (
    p_user_id TEXT,
    p_time_range TEXT,
    p_offset_seconds INT DEFAULT 0
  ) RETURNS TABLE (
    total_minutes INT,
    total_hours NUMERIC,
    start_date DATE,
    end_date DATE
  ) AS $$
DECLARE v_keystroke_timeout INT;
v_start_date DATE;
v_end_date DATE;
v_today_start TIMESTAMPTZ;
v_yesterday_start TIMESTAMPTZ;
v_today_minutes INT;
v_yesterday_minutes INT;
v_old_summaries_minutes INT;
BEGIN
SELECT "keystrokeTimeout" INTO v_keystroke_timeout
FROM "User"
WHERE id = p_user_id;
IF NOT FOUND THEN RAISE EXCEPTION 'User not found';
END IF;
v_today_start := date_trunc(
  'day',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
) - (p_offset_seconds || ' seconds')::INTERVAL;
v_yesterday_start := v_today_start - INTERVAL '1 day';
CASE
  p_time_range
  WHEN 'TODAY' THEN v_start_date := (
    v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
  )::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'YESTERDAY' THEN v_start_date := (
  v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'WEEK' THEN v_start_date := (
  v_today_start - INTERVAL '6 days' + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'MONTH' THEN v_start_date := (
  v_today_start - INTERVAL '29 days' + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'MONTH_TO_DATE' THEN v_start_date := date_trunc(
  'month',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'LAST_MONTH' THEN v_start_date := date_trunc(
  'month',
  (
    NOW() + (p_offset_seconds || ' seconds')::INTERVAL
  ) - INTERVAL '1 month'
)::DATE;
v_end_date := (
  date_trunc(
    'month',
    NOW() + (p_offset_seconds || ' seconds')::INTERVAL
  ) - INTERVAL '1 day'
)::DATE;
WHEN 'LAST_90_DAYS' THEN v_start_date := (
  v_today_start - INTERVAL '89 days' + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'YEAR_TO_DATE' THEN v_start_date := date_trunc(
  'year',
  NOW() + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'LAST_12_MONTHS' THEN v_start_date := (
  v_today_start - INTERVAL '1 year' + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
WHEN 'ALL_TIME' THEN v_start_date := '1970-01-01'::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
ELSE v_start_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
v_end_date := (
  v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
)::DATE;
END CASE
;
SELECT COALESCE(
    SUM(
      CASE
        WHEN prev_timestamp IS NULL THEN 30
        WHEN EXTRACT(
          EPOCH
          FROM (timestamp - prev_timestamp)
        ) > (v_keystroke_timeout * 60) THEN 30
        ELSE LEAST(
          EXTRACT(
            EPOCH
            FROM (timestamp - prev_timestamp)
          ),
          v_keystroke_timeout * 60
        )
      END
    ) / 60,
    0
  )::INT INTO v_today_minutes
FROM (
    SELECT timestamp,
      LAG(timestamp) OVER (
        ORDER BY timestamp
      ) as prev_timestamp
    FROM "Heartbeats"
    WHERE "userId" = p_user_id
      AND timestamp >= v_today_start
      AND timestamp < v_today_start + INTERVAL '1 day'
  ) heartbeats;
SELECT COALESCE(
    SUM(
      CASE
        WHEN prev_timestamp IS NULL THEN 30
        WHEN EXTRACT(
          EPOCH
          FROM (timestamp - prev_timestamp)
        ) > (v_keystroke_timeout * 60) THEN 30
        ELSE LEAST(
          EXTRACT(
            EPOCH
            FROM (timestamp - prev_timestamp)
          ),
          v_keystroke_timeout * 60
        )
      END
    ) / 60,
    0
  )::INT INTO v_yesterday_minutes
FROM (
    SELECT timestamp,
      LAG(timestamp) OVER (
        ORDER BY timestamp
      ) as prev_timestamp
    FROM "Heartbeats"
    WHERE "userId" = p_user_id
      AND timestamp >= v_yesterday_start
      AND timestamp < v_yesterday_start + INTERVAL '1 day'
  ) heartbeats;
SELECT COALESCE(SUM("totalMinutes"), 0)::INT INTO v_old_summaries_minutes
FROM "Summaries"
WHERE "userId" = p_user_id
  AND date >= v_start_date
  AND date < (
    v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
  )::DATE;
RETURN QUERY
SELECT (
    v_old_summaries_minutes + CASE
      WHEN (
        v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE >= v_start_date
      AND (
        v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE <= v_end_date THEN v_yesterday_minutes
      ELSE 0
    END + CASE
      WHEN (
        v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE >= v_start_date
      AND (
        v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
      )::DATE <= v_end_date THEN v_today_minutes
      ELSE 0
    END
  )::INT as total_minutes,
  ROUND(
    (
      v_old_summaries_minutes + CASE
        WHEN (
          v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
        )::DATE >= v_start_date
        AND (
          v_yesterday_start + (p_offset_seconds || ' seconds')::INTERVAL
        )::DATE <= v_end_date THEN v_yesterday_minutes
        ELSE 0
      END + CASE
        WHEN (
          v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
        )::DATE >= v_start_date
        AND (
          v_today_start + (p_offset_seconds || ' seconds')::INTERVAL
        )::DATE <= v_end_date THEN v_today_minutes
        ELSE 0
      END
    ) / 60.0,
    2
  ) as total_hours,
  v_start_date,
  v_end_date;
END;
$$ LANGUAGE plpgsql STABLE;