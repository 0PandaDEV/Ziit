import { TimeRangeEnum, type TimeRange, type Summary } from "~/lib/stats";
import { badgen } from "badgen";
import { calculateStats } from "~/server/utils/stats";

interface StatsResult {
  summaries: Summary[];
  offsetSeconds: number;
  debug: Record<string, any>;
}

interface StatsWithProject extends StatsResult {
  projectSeconds: number;
  projectFilter: string;
}

export default defineEventHandler(async (event) => {
  const path = event.path || "";
  const segments = path.split("/").filter(Boolean);

  const pathParams = segments.slice(segments.indexOf("badge") + 1);

  // /api/public/badge/:userId/:timeRange/:project/:color/:labelText?
  const userId = pathParams[0];
  const timeRangeParam = (pathParams[1] as TimeRange) || TimeRangeEnum.ALL_TIME;
  const projectInput = pathParams[2] || "all";
  let color = pathParams[3] || "blue";
  const labelText = pathParams[4] || projectInput;

  const project = projectInput.toLowerCase();

  if (!userId) {
    throw createError({
      statusCode: 400,
      statusMessage: "User ID is required",
    });
  }

  if (
    timeRangeParam &&
    !Object.values(TimeRangeEnum).includes(timeRangeParam as any)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid time range. Valid options are: ${Object.values(TimeRangeEnum).join(", ")}`,
    });
  }

  const query = getQuery(event);
  const style = query.style ? String(query.style) : "flat";
  const icon = query.icon as string;

  const stats = (await calculateStats(
    userId,
    timeRangeParam,
    undefined,
    project
  )) as StatsResult | StatsWithProject;

  let totalSeconds = 0;

  if ("projectFilter" in stats) {
    totalSeconds = stats.projectSeconds;
  } else {
    if (project === "all") {
      totalSeconds = stats.summaries.reduce(
        (total: number, summary: Summary) => total + summary.totalSeconds,
        0
      );
    } else {
      for (const summary of stats.summaries) {
        if (summary.projects) {
          const projectsData = summary.projects as Record<string, number>;

          for (const [projectName, seconds] of Object.entries(projectsData)) {
            if (projectName.toLowerCase() === project) {
              totalSeconds += seconds;
            }
          }
        }
      }
    }
  }

  let formattedTime;
  if (totalSeconds === 0) {
    formattedTime = "0 mins";
  } else if (totalSeconds < 60) {
    formattedTime = `${totalSeconds} secs`;
  } else if (totalSeconds < 3600) {
    formattedTime = `${Math.round(totalSeconds / 60)} mins`;
  } else {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);

    if (minutes === 0) {
      formattedTime = `${hours} hrs`;
    } else {
      formattedTime = `${hours} hrs ${minutes} mins`;
    }
  }

  const colorMap: Record<string, string> = {
    blue: "007ec6",
    green: "97ca00",
    red: "e05d44",
    orange: "fe7d37",
    yellow: "dfb317",
    purple: "9f9f9f",
    black: "333333",
  };

  const badgeOptions: any = {
    label: labelText,
    status: formattedTime,
    color: colorMap[color as keyof typeof colorMap] || color,
    style: style === "flat" ? "flat" : "classic",
  };

  if (icon) {
    badgeOptions.icon = icon;
  }

  const svg = badgen(badgeOptions);

  event.node.res.setHeader("Content-Type", "image/svg+xml");
  event.node.res.setHeader("Cache-Control", "max-age=600, s-maxage=600");

  return svg;
});
