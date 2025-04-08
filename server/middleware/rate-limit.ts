import { createError } from "h3";

const storage = useStorage();

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith("/api/auth")) return;

  const ip = getRequestIP(event);
  const key = `rate-limit:${ip}`;

  const current = ((await storage.getItem(key)) as {
    count: number;
    reset: number;
  }) || { count: 0, reset: Date.now() + 1800000 };

  if (Date.now() > current.reset) {
    current.count = 0;
    current.reset = Date.now() + 1800000;
  }

  if (current.count >= 5) {
    throw createError({
      statusCode: 429,
      message: "Too many requests, please try again later",
    });
  }

  current.count++;
  await storage.setItem(key, current);

  setResponseHeaders(event, {
    "X-RateLimit-Limit": "5",
    "X-RateLimit-Remaining": String(5 - current.count),
    "X-RateLimit-Reset": String(Math.ceil((current.reset - Date.now()) / 1000)),
  });
});
