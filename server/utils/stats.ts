import { PrismaClient } from "@prisma/client";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";

const prisma = new PrismaClient();

export async function calculateStats(userId: string, timeRange: TimeRange) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { keystrokeTimeoutMinutes: true }
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: "User not found",
    });
  }

  const keystrokeTimeoutSeconds = user.keystrokeTimeoutMinutes * 60;

  const utcTodayEnd = new Date();
  utcTodayEnd.setUTCHours(23, 59, 59, 999);
  const utcTodayStart = new Date(utcTodayEnd);
  utcTodayStart.setUTCHours(0, 0, 0, 0);

  const utcYesterdayEnd = new Date(utcTodayStart);
  utcYesterdayEnd.setUTCDate(utcYesterdayEnd.getUTCDate() - 1);
  utcYesterdayEnd.setUTCHours(23, 59, 59, 999);
  const utcYesterdayStart = new Date(utcYesterdayEnd);
  utcYesterdayStart.setUTCHours(0, 0, 0, 0);

  const utcTomorrowEnd = new Date(utcTodayEnd);
  utcTomorrowEnd.setUTCDate(utcTomorrowEnd.getUTCDate() + 1);
  utcTomorrowEnd.setUTCHours(23, 59, 59, 999);

  const utcDayBeforeYesterdayStart = new Date(utcYesterdayStart);
  utcDayBeforeYesterdayStart.setUTCDate(
    utcDayBeforeYesterdayStart.getUTCDate() - 1,
  );
  utcDayBeforeYesterdayStart.setUTCHours(0, 0, 0, 0);

  let fetchStartDate: Date;
  let fetchEndDate: Date;

  if (timeRange === TimeRangeEnum.TODAY) {
    fetchStartDate = utcTodayStart;
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.YESTERDAY) {
    fetchStartDate = utcYesterdayStart;
    fetchEndDate = utcYesterdayEnd;
  } else if (timeRange === TimeRangeEnum.WEEK) {
    fetchStartDate = new Date(utcTodayEnd);
    fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 7);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.MONTH) {
    fetchStartDate = new Date(utcTodayEnd);
    fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 30);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.MONTH_TO_DATE) {
    fetchStartDate = new Date(utcTodayEnd);
    fetchStartDate.setUTCDate(1);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.LAST_MONTH) {
    const lastDayOfLastUTCMonth = new Date(utcTodayStart);
    lastDayOfLastUTCMonth.setUTCDate(0);
    lastDayOfLastUTCMonth.setUTCHours(23, 59, 59, 999);

    const firstDayOfLastUTCMonth = new Date(lastDayOfLastUTCMonth);
    firstDayOfLastUTCMonth.setUTCDate(1);
    firstDayOfLastUTCMonth.setUTCHours(0, 0, 0, 0);

    fetchStartDate = firstDayOfLastUTCMonth;
    fetchEndDate = lastDayOfLastUTCMonth;
  } else if (timeRange === TimeRangeEnum.YEAR_TO_DATE) {
    fetchStartDate = new Date(utcTodayEnd);
    fetchStartDate.setUTCMonth(0, 1);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.LAST_12_MONTHS) {
    fetchStartDate = new Date(utcTodayEnd);
    fetchStartDate.setUTCFullYear(fetchStartDate.getUTCFullYear() - 1);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcTodayEnd;
  } else if (timeRange === TimeRangeEnum.ALL_TIME) {
    fetchStartDate = new Date("2020-01-01T00:00:00.000Z");
    fetchEndDate = utcTodayEnd;
  } else {
    fetchStartDate = utcTodayStart;
    fetchEndDate = utcTodayEnd;
  }

  const heartbeats = await prisma.heartbeats.findMany({
    where: {
      userId,
      timestamp: {
        gte: fetchStartDate,
        lte: fetchEndDate,
      },
    },
    orderBy: {
      timestamp: "asc",
    },
  });

  const dailyDataMap = new Map<string, {
    date: string
    totalSeconds: number
    projects: Record<string, number>
    languages: Record<string, number>
    editors: Record<string, number>
    os: Record<string, number>
    hourlyData: Array<{
      seconds: number
      file: string | null
      editor: string | null
      language: string | null
      branch: string | null
      os: string | null
    }>
  }>();

  const heartbeatsByDate = new Map<string, Array<typeof heartbeats[0]>>();
  
  for (const heartbeat of heartbeats) {
    const dateStr = heartbeat.timestamp.toISOString().split('T')[0];
    
    if (!heartbeatsByDate.has(dateStr)) {
      heartbeatsByDate.set(dateStr, []);
    }
    
    heartbeatsByDate.get(dateStr)!.push(heartbeat);
  }
  
  for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
    if (!dailyDataMap.has(dateStr)) {
      dailyDataMap.set(dateStr, {
        date: dateStr,
        totalSeconds: 0,
        projects: {},
        languages: {},
        editors: {},
        os: {},
        hourlyData: Array(24).fill(null).map(() => ({
          seconds: 0,
          file: null,
          editor: null,
          language: null,
          branch: null,
          os: null
        }))
      });
    }
    
    const dailyData = dailyDataMap.get(dateStr)!;
    
    dateHeartbeats.sort((a, b) => 
      a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    for (let i = 0; i < dateHeartbeats.length; i++) {
      const heartbeat = dateHeartbeats[i];
      const hour = heartbeat.timestamp.getHours();
      
      if (heartbeat.editor) {
        dailyData.hourlyData[hour].editor = heartbeat.editor;
      }
      
      if (heartbeat.language) {
        dailyData.hourlyData[hour].language = heartbeat.language;
      }
      
      if (heartbeat.os) {
        dailyData.hourlyData[hour].os = heartbeat.os;
      }
      
      if (heartbeat.file) {
        dailyData.hourlyData[hour].file = heartbeat.file;
      }
      
      if (heartbeat.branch) {
        dailyData.hourlyData[hour].branch = heartbeat.branch;
      }
      
      let secondsToAdd = 30;
      
      if (i > 0) {
        const current = heartbeat.timestamp.getTime();
        const previous = dateHeartbeats[i - 1].timestamp.getTime();
        const diffSeconds = (current - previous) / 1000;
        
        const prevHour = dateHeartbeats[i - 1].timestamp.getHours();
        
        if (diffSeconds < keystrokeTimeoutSeconds) {
          secondsToAdd = diffSeconds;
          
          if (hour !== prevHour) {
            const hourBoundary = new Date(heartbeat.timestamp);
            hourBoundary.setMinutes(0, 0, 0);
            
            const secondsBeforeBoundary = 
              (hourBoundary.getTime() - previous) / 1000;
            const secondsAfterBoundary = 
              (current - hourBoundary.getTime()) / 1000;
            
            if (secondsBeforeBoundary > 0 && secondsBeforeBoundary < keystrokeTimeoutSeconds) {
              dailyData.hourlyData[prevHour].seconds += secondsBeforeBoundary;
              secondsToAdd = secondsAfterBoundary;
            }
          }
        }
      }
      
      dailyData.totalSeconds += secondsToAdd;
      dailyData.hourlyData[hour].seconds += secondsToAdd;
      
      if (heartbeat.project) {
        dailyData.projects[heartbeat.project] = (dailyData.projects[heartbeat.project] || 0) + secondsToAdd;
      }
      
      if (heartbeat.language) {
        dailyData.languages[heartbeat.language] = (dailyData.languages[heartbeat.language] || 0) + secondsToAdd;
      }
      
      if (heartbeat.editor) {
        dailyData.editors[heartbeat.editor] = (dailyData.editors[heartbeat.editor] || 0) + secondsToAdd;
      }
      
      if (heartbeat.os) {
        dailyData.os[heartbeat.os] = (dailyData.os[heartbeat.os] || 0) + secondsToAdd;
      }
    }
  }

  const dailyData = Array.from(dailyDataMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    summaries: dailyData,
    heartbeats: heartbeats.map(h => ({
      ...h,
      timestamp: h.timestamp.toISOString(),
      createdAt: h.createdAt.toISOString()
    }))
  };
} 