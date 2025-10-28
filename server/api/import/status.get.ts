import { createEventStream, getRequestHeader } from "h3";
import type { User } from "@prisma/client";

import { handleLog } from "~~/server/utils/logging";
import {
  getAllJobStatuses,
  getQueueStatus,
} from "~~/server/utils/import-queue";

function safeJSONStringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
}

function isActiveJobStatus(status: string): boolean {
  if (!status || typeof status !== "string") return false;
  const inactiveKeywords = ["Completed", "Failed"];
  return !inactiveKeywords.some((keyword) => status.includes(keyword));
}

const recentlyCompletedJobs = new Map<
  string,
  { timestamp: number; sentFinalUpdate: boolean }
>();

function cleanupOldCompletedJobs() {
  const now = Date.now();
  for (const [jobId, data] of recentlyCompletedJobs.entries()) {
    if (now - data.timestamp > 5000) {
      recentlyCompletedJobs.delete(jobId);
    }
  }
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

  let activeJob = userJobs.find((j) => isActiveJobStatus(j.status));

  if (!activeJob) {
    const completedJob = userJobs.find(
      (j) =>
        (j.status.includes("Completed") || j.status.includes("Failed")) &&
        (!recentlyCompletedJobs.has(j.id) ||
          !recentlyCompletedJobs.get(j.id)?.sentFinalUpdate),
    );

    if (completedJob) {
      if (!recentlyCompletedJobs.has(completedJob.id)) {
        recentlyCompletedJobs.set(completedJob.id, {
          timestamp: Date.now(),
          sentFinalUpdate: false,
        });
      }
      activeJob = completedJob;
    }
  }

  if (!activeJob) {
    activeJob = userJobs.sort((a, b) => b.id.localeCompare(a.id))[0];
  }

  cleanupOldCompletedJobs();

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

      let currentActiveJob = currentUserJobs.find((j) =>
        isActiveJobStatus(j.status),
      );

      if (!currentActiveJob) {
        const completedJob = currentUserJobs.find(
          (j) =>
            (j.status.includes("Completed") || j.status.includes("Failed")) &&
            (!recentlyCompletedJobs.has(j.id) ||
              !recentlyCompletedJobs.get(j.id)?.sentFinalUpdate),
        );

        if (completedJob) {
          currentActiveJob = completedJob;
          if (!recentlyCompletedJobs.has(completedJob.id)) {
            recentlyCompletedJobs.set(completedJob.id, {
              timestamp: Date.now(),
              sentFinalUpdate: false,
            });
          }
        }
      }

      const hasActiveJobs = currentUserJobs.some((j) =>
        isActiveJobStatus(j.status),
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

        eventStream.push(safeJSONStringify(response));
        lastActiveJobState = currentJobState;

        if (
          currentActiveJob &&
          (currentActiveJob.status.includes("Completed") ||
            currentActiveJob.status.includes("Failed")) &&
          recentlyCompletedJobs.has(currentActiveJob.id)
        ) {
          const jobData = recentlyCompletedJobs.get(currentActiveJob.id);
          if (jobData) {
            jobData.sentFinalUpdate = true;
          }
        }
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
