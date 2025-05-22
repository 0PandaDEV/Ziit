import { createError, H3Error } from "h3";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500;

const standardMessages: Record<ErrorStatusCode, string> = {
  400: "Invalid Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

export function handleApiError(
  statusCode: ErrorStatusCode,
  detailedMessage: string,
  frontendMessage?: string
): H3Error {
  const clientResponseMessage =
    frontendMessage || standardMessages[statusCode] || standardMessages[500];

  console.error(
    `${new Date().toISOString()} Error ${statusCode}: ${detailedMessage}`
  );

  return createError({
    statusCode,
    message: clientResponseMessage,
    statusMessage: clientResponseMessage,
  });
}

export function log(...message: any[]) {
  console.log(new Date().toISOString(), ...message);
}
