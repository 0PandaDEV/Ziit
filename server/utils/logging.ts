import { createError, H3Error } from "h3";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 69;

const standardMessages: Record<ErrorStatusCode, string> = {
  400: "Invalid Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  429: "Too Many Requests",
  69: "Server On Fire",
};

export function handleApiError(
  statusCode: ErrorStatusCode,
  detailedMessage: string,
  frontendMessage?: string
): H3Error {
  const effectiveCode =
    process.env.NODE_ENV === "production" && statusCode === 69
      ? 500
      : statusCode;

  const clientResponseMessage =
    frontendMessage || standardMessages[statusCode] || standardMessages[69];

  console.error(
    `${new Date().toISOString()} Error ${effectiveCode}: ${detailedMessage}`
  );

  return createError({
    statusCode: effectiveCode,
    message: clientResponseMessage,
    statusMessage: clientResponseMessage,
  });
}

export function handleLog(...message: any[]) {
  console.log(new Date().toISOString(), ...message);
}

export function handleError(...message: any[]) {
  console.error(new Date().toISOString(), ...message);
}
