import { createError, H3Error } from "h3";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 911;

const standardMessages: Record<ErrorStatusCode, string> = {
  400: "Invalid Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  911: "Server On Fire",
};

export function handleApiError(
  statusCode: ErrorStatusCode,
  detailedMessage: string,
  frontendMessage?: string
): H3Error {
  const effectiveCode =
    process.env.NODE_ENV === "production" && statusCode === 911
      ? 500
      : statusCode;

  const clientResponseMessage =
    frontendMessage || standardMessages[statusCode] || standardMessages[911];

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
