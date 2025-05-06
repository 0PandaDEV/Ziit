import { createError } from "h3";

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

export function createStandardError(
  statusCode: ErrorStatusCode,
  detailedMessage?: string
) {
  if (detailedMessage) {
    console.error(`Error ${statusCode}: ${detailedMessage}`);
  }

  return createError({
    statusCode,
    message: standardMessages[statusCode],
  });
}

export function handleApiError(
  error: unknown,
  defaultMsg = "Unknown error"
): never {
  const detailedMessage = error instanceof Error ? error.message : defaultMsg;

  console.error("API Error:", detailedMessage);

  const statusCode =
    error instanceof Error && "statusCode" in error
      ? ((error as any).statusCode as ErrorStatusCode)
      : 500;

  throw createStandardError(statusCode, detailedMessage);
}
