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
  const job = Array.from(activeJobs.values()).find((j) => j.userId === userId);

  const acceptHeader = getRequestHeader(event, "accept");
  if (!acceptHeader?.includes("text/event-stream")) {
    if (job) {
      return job;
    }
    return { status: "no_job" };
  }

  const eventStream = createEventStream(event);

  handleLog(`[sse] open for user ${userId}`);

  let completedMessagesSent = 0;
  let isCompleted = false;

  const interval = setInterval(() => {
    const job = Array.from(activeJobs.values()).find(
      (j) => j.userId === userId,
    );

    if (job) {
      eventStream.push(JSON.stringify(job));

      if (
        (job.status === "Completed" || job.status === "Failed") &&
        !isCompleted
      ) {
        isCompleted = true;
        completedMessagesSent = 0;
      }

      if (isCompleted) {
        completedMessagesSent++;
        if (completedMessagesSent >= 10) {
          clearInterval(interval);
          activeJobs.delete(job.id);
          eventStream.close();
        }
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
