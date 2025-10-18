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
  let lastActiveJobState: any = null;
  let connectionStartTime = Date.now();

  let currentInterval = 1000;
  const ACTIVE_INTERVAL = 500;
  const INACTIVE_INTERVAL = 5000;
  const MAX_CONNECTION_TIME = 30 * 60 * 1000;

  const sendUpdate = () => {
    try {
      if (Date.now() - connectionStartTime > MAX_CONNECTION_TIME) {
        handleLog(`[sse] Connection timeout for user ${userId}`);
        clearTimeout(timeoutId);
        eventStream.close();
        return;
      }

      const currentUserJobs = getAllJobStatuses(userId);
      const currentQueueStatus = getQueueStatus();

      const currentActiveJob = currentUserJobs.find((j) =>
        isActiveJobStatus(j.status)
      );

      const hasActiveJobs = currentUserJobs.some((j) =>
        isActiveJobStatus(j.status)
      );

      const currentJobState = JSON.stringify(currentActiveJob);
      const shouldSendUpdate =
        currentJobState !== lastActiveJobState ||
        heartbeatsSent % 10 === 0 ||
        hasActiveJobs;

      if (shouldSendUpdate) {
        const response = {
          activeJob: currentActiveJob,
          queueStatus: {
            queueLength: currentQueueStatus.queueLength,
            busyWorkers: currentQueueStatus.busyWorkers,
            availableWorkers: currentQueueStatus.availableWorkers,
          },
          hasActiveJobs,
          totalJobs: currentUserJobs.length,
          recentJobs: currentUserJobs.slice(0, 5),
          heartbeat: ++heartbeatsSent,
        };

        eventStream.push(JSON.stringify(response));
        lastActiveJobState = currentJobState;
      }

      const newInterval = hasActiveJobs ? ACTIVE_INTERVAL : INACTIVE_INTERVAL;
      if (newInterval !== currentInterval) {
        currentInterval = newInterval;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(sendUpdate, currentInterval);
        return;
      }

      if (!hasActiveJobs && !isCompleted) {
        isCompleted = true;
        completedMessagesSent = 0;
      }

      if (isCompleted) {
        completedMessagesSent++;
        if (completedMessagesSent >= 24) {
          clearTimeout(timeoutId);
          eventStream.close();
          return;
        }
      }
    } catch (error) {
      handleLog(`[sse] Error sending message to user ${userId}: ${error}`);
      clearTimeout(timeoutId);
      eventStream.close();
      return;
    }

    timeoutId = setTimeout(sendUpdate, currentInterval);
  };

  let timeoutId = setTimeout(sendUpdate, 100);

  eventStream.onClosed(() => {
    handleLog(`[sse] close for user ${userId}`);
    clearTimeout(timeoutId);
  });

  return eventStream.send();
});
