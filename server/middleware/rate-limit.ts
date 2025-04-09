import { createError } from "h3";

const storage = useStorage();

const rateLimits = {
  default: { limit: 100, window: 60000 },
  auth: { limit: 5, window: 1800000 },
  external: { limit: 50, window: 60000 },
  stats: { limit: 10, window: 60000 }
};

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith("/api")) return;

  const ip = getRequestIP(event);
  const path = event.path;
  
  let limitConfig = rateLimits.default;
  
  if (path.startsWith("/api/auth")) {
    limitConfig = rateLimits.auth;
  } else if (path.startsWith("/api/external")) {
    limitConfig = rateLimits.external;
  } else if (path.startsWith("/api/stats")) {
    limitConfig = rateLimits.stats;
  }

  const key = `rate-limit:${ip}:${path}`;
  const current = ((await storage.getItem(key)) as {
    count: number;
    reset: number;
  }) || { count: 0, reset: Date.now() + limitConfig.window };

  if (Date.now() > current.reset) {
    current.count = 0;
    current.reset = Date.now() + limitConfig.window;
  }

  if (current.count >= limitConfig.limit) {
    throw createError({
      statusCode: 429,
      message: "Too many requests, please try again later",
    });
  }

  current.count++;
  await storage.setItem(key, current);

  setResponseHeaders(event, {
    "X-RateLimit-Limit": String(limitConfig.limit),
    "X-RateLimit-Remaining": String(limitConfig.limit - current.count),
    "X-RateLimit-Reset": String(Math.ceil((current.reset - Date.now()) / 1000)),
  });
});
