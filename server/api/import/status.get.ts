import { createEventStream, getRequestHeader } from "h3";
import type { User } from "@prisma/client";
import { activeJobs } from "~~/server/utils/import-jobs";
import { handleLog } from "~~/server/utils/logging";

export default defineEventHandler((event) => {
  const user = (event.context as any).user as User;
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const userId = user.id;
  const job = activeJobs.get(userId);

  const acceptHeader = getRequestHeader(event, "accept");
  if (!acceptHeader?.includes("text/event-stream")) {
    if (job) {
      return job;
    }
    return { status: "no_job" };
  }

  const eventStream = createEventStream(event);

  handleLog(`[sse] open for user ${userId}`);

  const interval = setInterval(() => {
    const job = activeJobs.get(userId);
    if (job) {
      eventStream.push(JSON.stringify(job));
      if (job.status === "Completed" || job.status === "Failed") {
        activeJobs.delete(userId);
        eventStream.close();
      }
    } else {
      eventStream.push(JSON.stringify({ status: "no_job" }));
    }
  }, 200);

  eventStream.onClosed(() => {
    handleLog(`[sse] close for user ${userId}`);
    clearInterval(interval);
  });

  return eventStream.send();
}); 