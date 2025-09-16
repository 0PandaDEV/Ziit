import { createEventStream, getRequestHeader } from "h3";
import type { User } from "@prisma/client";
import {
  getAllJobStatuses,
  getQueueStatus,
} from "~~/server/utils/import-queue";
import { handleLog } from "~~/server/utils/logging";

function isActiveJobStatus(status: string): boolean {
  const activeStatuses = ["Processing", "Queued", "Uploading", "Pending"];
  return activeStatuses.some((activeStatus) => status.startsWith(activeStatus));
}

export default defineEventHandler((event) => {
  const user = (event.context as any).user as User;
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const userId = user.id;
  const userJobs = getAllJobStatuses(userId);
  const queueStatus = getQueueStatus();

  const activeJob =
    userJobs.find((j) => isActiveJobStatus(j.status)) ||
    userJobs.sort((a, b) => b.id.localeCompare(a.id))[0];

  const acceptHeader = getRequestHeader(event, "accept");
  if (!acceptHeader?.includes("text/event-stream")) {
    return {
      activeJob,
      allJobs: userJobs.slice(0, 10),
      queueStatus: {
        queueLength: queueStatus.queueLength,
        busyWorkers: queueStatus.busyWorkers,
        availableWorkers: queueStatus.availableWorkers,
      },
      hasActiveJobs: userJobs.some((j) => isActiveJobStatus(j.status)),
    };
  }

  const eventStream = createEventStream(event);

  handleLog(`[sse] open for user ${userId}`);

  let completedMessagesSent = 0;
  let isCompleted = false;
  let heartbeatsSent = 0;

  const interval = setInterval(() => {
    const currentUserJobs = getAllJobStatuses(userId);
    const currentQueueStatus = getQueueStatus();

    const currentActiveJob = currentUserJobs.find((j) =>
      isActiveJobStatus(j.status),
    );

    const response = {
      activeJob: currentActiveJob,
      queueStatus: {
        queueLength: currentQueueStatus.queueLength,
        busyWorkers: currentQueueStatus.busyWorkers,
        availableWorkers: currentQueueStatus.availableWorkers,
      },
      hasActiveJobs: currentUserJobs.some((j) => isActiveJobStatus(j.status)),
      totalJobs: currentUserJobs.length,
      recentJobs: currentUserJobs.slice(0, 5),
      heartbeat: ++heartbeatsSent,
    };

    try {
      eventStream.push(JSON.stringify(response));
    } catch (error) {
      handleLog(`[sse] Error sending message to user ${userId}: ${error}`);
      clearInterval(interval);
      return;
    }

    const hasActiveJobs = currentUserJobs.some((j) =>
      isActiveJobStatus(j.status),
    );

    if (!hasActiveJobs && !isCompleted) {
      isCompleted = true;
      completedMessagesSent = 0;
    }

    if (isCompleted) {
      completedMessagesSent++;
      if (completedMessagesSent >= 120) {
        clearInterval(interval);
        eventStream.close();
      }
    }
  }, 250);

  eventStream.onClosed(() => {
    handleLog(`[sse] close for user ${userId}`);
    clearInterval(interval);
  });

  return eventStream.send();
});
