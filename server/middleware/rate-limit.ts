import { createError, getRequestIP, setResponseHeaders } from "h3";
import type { H3Event } from "h3";
import { useStorage } from "#imports";

const storage = useStorage();

type RateLimitProfile = { limit: number; window: number };
type PathMapping = { path: string; profile: keyof typeof profiles };

const profiles = {
  default: { limit: 50, window: 60000 },
  auth: { limit: 5, window: 1800000 },
  external: { limit: 100, window: 30000 },
  stats: { limit: 50, window: 60000 },
  wakatime: { limit: 2, window: 1800000 },
  public: { limit: 50, window: 60000 },
} as const;

const RATE_LIMIT_CONFIG = {
  profiles,
  pathMappings: [
    { path: "/api/auth", profile: "auth" },
    { path: "/api/external", profile: "external" },
    { path: "/api/stats", profile: "stats" },
    { path: "/api/wakatime", profile: "wakatime" },
    { path: "/api/public", profile: "public" },
  ] as PathMapping[],
  defaultProfile: "default" as keyof typeof profiles,
  apiOnly: true,
  storageKeyPrefix: "rate-limit",
};

function getRateLimitProfile(path: string): RateLimitProfile {
  for (const mapping of RATE_LIMIT_CONFIG.pathMappings) {
    if (path.startsWith(mapping.path)) {
      return RATE_LIMIT_CONFIG.profiles[mapping.profile];
    }
  }
  return RATE_LIMIT_CONFIG.profiles[RATE_LIMIT_CONFIG.defaultProfile];
}

export default defineEventHandler(async (event: H3Event) => {
  const path = (event.path || event.node?.req?.url || "/") as string;

  if (RATE_LIMIT_CONFIG.apiOnly && !path.startsWith("/api")) {
    return;
  }

  const ip = getRequestIP(event, { xForwardedFor: true });

  const limitConfig = getRateLimitProfile(path);
  const key = `${RATE_LIMIT_CONFIG.storageKeyPrefix}:${ip}:${path}`;

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
