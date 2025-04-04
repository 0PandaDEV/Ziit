import { PrismaClient, Heartbeat } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Missing or invalid API key",
      });
    }

    const apiKey = authHeader.substring(7);

    const user = await prisma.user.findUnique({
      where: { apiKey },
    });

    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Invalid API key",
      });
    }

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

    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId: user.id,
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
      
      for (const dateStr of datesToCheck) {
        const dayStart = new Date(dateStr);
        const dayEnd = new Date(dateStr);
        dayEnd.setHours(23, 59, 59, 999);
        
        const heartbeats = await prisma.heartbeat.findMany({
          where: {
            userId: user.id,
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
          
          heartbeats.forEach((heartbeat) => {
            const project = heartbeat.project || "unknown";
            
            if (!projectHeartbeats[project]) {
              projectHeartbeats[project] = [];
            }
            
            projectHeartbeats[project].push(heartbeat);
          });
          
          groupedSummaries[dateStr] = {
            date: dateStr,
            totalSeconds: 0,
            projects: {},
          };
          
          for (const project in projectHeartbeats) {
            const beats = projectHeartbeats[project];
            let projectSeconds = 0;
            
            beats.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            
            for (let i = 0; i < beats.length; i++) {
              if (i === 0) {
                projectSeconds += HEARTBEAT_INTERVAL_SECONDS;
                continue;
              }
              
              const current = new Date(beats[i].timestamp).getTime();
              const previous = new Date(beats[i - 1].timestamp).getTime();
              const diff = (current - previous) / 1000;
              
              if (diff < 300) {
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
