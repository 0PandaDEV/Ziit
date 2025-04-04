import { PrismaClient, Heartbeat } from "@prisma/client";
import { H3Event } from "h3";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

export default defineEventHandler(async (event: H3Event) => {
  let userId;

  if (event.context.user) {
    userId = event.context.user.id;
  } else {
    const sessionCookie = getCookie(event, "session");

    if (!sessionCookie) {
      throw createError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }

    try {
      const config = useRuntimeConfig();
      const decoded = jwt.verify(sessionCookie, config.jwtSecret);

      if (
        typeof decoded !== "object" ||
        decoded === null ||
        !("userId" in decoded)
      ) {
        throw new Error("Invalid token format");
      }

      userId = decoded.userId;
    } catch (error) {
      deleteCookie(event, "session");
      throw createError({
        statusCode: 401,
        message: "Invalid session",
      });
    }
  }

  try {
    const query = getQuery(event);
    const startDateStr = query.startDate as string;
    const endDateStr =
      (query.endDate as string) || new Date().toISOString().split("T")[0];

    if (!startDateStr) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request: startDate is required",
      });
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    // First try to get pre-calculated summaries
    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId: userId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    const groupedSummaries: Record<string, any> = {};

    // Process any existing summaries
    summaries.forEach((summary) => {
      const dateStr = summary.date.toISOString().split("T")[0];

      if (!groupedSummaries[dateStr]) {
        groupedSummaries[dateStr] = {
          date: dateStr,
          totalSeconds: 0,
          projects: {},
        };
      }

      groupedSummaries[dateStr].totalSeconds += summary.totalSeconds;
      groupedSummaries[dateStr].projects[summary.project] =
        summary.totalSeconds;
    });

    // For dates without summaries, calculate from heartbeats
    const datesWithSummaries = summaries.map(s => 
      s.date.toISOString().split('T')[0]
    );
    
    const datesToCheck: string[] = [];
    let checkDate = new Date(startDate);
    
    while (checkDate <= endDate) {
      const dateStr = checkDate.toISOString().split('T')[0];
      if (!datesWithSummaries.includes(dateStr)) {
        datesToCheck.push(dateStr);
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }
    
    if (datesToCheck.length > 0) {
      console.log(`Calculating on-the-fly summaries for dates: ${datesToCheck.join(', ')}`);
      
      // For each missing date, calculate summary from heartbeats
      for (const dateStr of datesToCheck) {
        const dayStart = new Date(dateStr);
        const dayEnd = new Date(dateStr);
        dayEnd.setHours(23, 59, 59, 999);
        
        const heartbeats = await prisma.heartbeat.findMany({
          where: {
            userId: userId,
            timestamp: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
          orderBy: {
            timestamp: "asc",
          },
        });
        
        if (heartbeats.length > 0) {
          const projectHeartbeats: Record<string, Heartbeat[]> = {};
          
          // Group heartbeats by project
          heartbeats.forEach((heartbeat) => {
            const project = heartbeat.project || "unknown";
            
            if (!projectHeartbeats[project]) {
              projectHeartbeats[project] = [];
            }
            
            projectHeartbeats[project].push(heartbeat);
          });
          
          // Create summary entry for this date
          groupedSummaries[dateStr] = {
            date: dateStr,
            totalSeconds: 0,
            projects: {},
          };
          
          // Calculate time for each project
          for (const project in projectHeartbeats) {
            const beats = projectHeartbeats[project];
            let projectSeconds = 0;
            
            // Sort heartbeats by timestamp
            beats.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            
            // Calculate time using the same algorithm as summarize-heartbeats.ts
            for (let i = 0; i < beats.length; i++) {
              if (i === 0) {
                projectSeconds += HEARTBEAT_INTERVAL_SECONDS;
                continue;
              }
              
              const current = new Date(beats[i].timestamp).getTime();
              const previous = new Date(beats[i - 1].timestamp).getTime();
              const diff = (current - previous) / 1000;
              
              if (diff < 300) { // 5 minutes
                projectSeconds += diff;
              } else {
                projectSeconds += HEARTBEAT_INTERVAL_SECONDS;
              }
            }
            
            groupedSummaries[dateStr].projects[project] = Math.round(projectSeconds);
            groupedSummaries[dateStr].totalSeconds += Math.round(projectSeconds);
          }
          
          console.log(`Generated on-the-fly summary for ${dateStr}: ${groupedSummaries[dateStr].totalSeconds} seconds`);
        }
      }
    }

    return Object.values(groupedSummaries);
  } catch (error: any) {
    console.error("Error retrieving daily stats:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || "Internal server error",
    });
  }
});
