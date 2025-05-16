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
  errorOrStatusCode: unknown | ErrorStatusCode,
  detailedMessage?: string,
  frontendMessage?: string
): H3Error {
  let statusCode: ErrorStatusCode;
  let logMessage: string;
  let clientResponseMessage: string;

  if (
    errorOrStatusCode instanceof H3Error ||
    errorOrStatusCode instanceof Error ||
    typeof errorOrStatusCode === "number"
  ) {
    statusCode =
      typeof errorOrStatusCode === "number"
        ? (errorOrStatusCode as ErrorStatusCode)
        : ((errorOrStatusCode as any).statusCode as ErrorStatusCode) || 500;

    logMessage =
      detailedMessage ||
      (errorOrStatusCode instanceof H3Error
        ? errorOrStatusCode.statusMessage
        : null) ||
      (errorOrStatusCode instanceof Error ? errorOrStatusCode.message : null) ||
      standardMessages[statusCode] ||
      "Unknown error";

    clientResponseMessage =
      frontendMessage ||
      (errorOrStatusCode instanceof Error ? errorOrStatusCode.message : null) ||
      standardMessages[statusCode] ||
      standardMessages[500];

    console.error(
      `Error ${statusCode}: ${logMessage}${errorOrStatusCode instanceof H3Error ? " (H3Error)" : errorOrStatusCode instanceof Error ? " (Generic Error)" : ""}`
    );
  } else {
    statusCode = 500;
    logMessage = detailedMessage || "An unknown error occurred";
    clientResponseMessage = frontendMessage || standardMessages[statusCode];
    console.error(`Error ${statusCode}: ${logMessage} (Unknown Error Type)`);
  }

  return createError({
    statusCode,
    message: clientResponseMessage,
    statusMessage: logMessage,
  });
}
