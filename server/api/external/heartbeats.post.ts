import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["External", "Heartbeats"],
    summary: "Create a single heartbeat",
    description:
      "Accepts one heartbeat payload authenticated via Bearer API key.",
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              timestamp: {
                type: "string",
                format: "date-time",
                description: "ISO 8601 timestamp; numeric epoch also accepted.",
              },
              project: { type: "string" },
              language: { type: "string" },
              editor: { type: "string" },
              os: { type: "string" },
              branch: { type: "string" },
              file: { type: "string" },
            },
            required: [
              "timestamp",
              "project",
              "language",
              "editor",
              "os",
              "file",
            ],
          },
        },
      },
    },
    responses: {
      200: {
        description: "Heartbeat created",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                id: { type: "string" },
              },
            },
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Invalid or missing API key" },
      500: { description: "Server error" },
    },
    operationId: "postExternalHeartbeat",
  },
});

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

const apiKeySchema = z.uuid();

const heartbeatSchema = z.object({
  timestamp: z.string().datetime().or(z.number()),
  project: z.string().min(1).max(255),
  language: z.string().min(1).max(50),
  editor: z.string().min(1).max(50),
  os: z.string().min(1).max(50),
  branch: z.string().max(255).optional(),
  file: z.string().max(255),
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "Heartbeat API error: Missing or invalid API key format in header."
      );
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(
        401,
        `Heartbeat API error: Invalid API key format. Key: ${apiKey.substring(0, 4)}...`
      );
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      throw handleApiError(
        401,
        `Heartbeat API error: Invalid API key. Key: ${apiKey.substring(0, 4)}...`
      );
    }

    const body = await readBody(event);
    const validatedData = heartbeatSchema.parse(body);

    const timestamp =
      typeof validatedData.timestamp === "number"
        ? BigInt(validatedData.timestamp)
        : BigInt(new Date(validatedData.timestamp).getTime());

    const heartbeat = await prisma.heartbeats.create({
      data: {
        userId: user.id,
        timestamp,
        project: validatedData.project,
        language: validatedData.language,
        editor: validatedData.editor,
        os: validatedData.os,
        branch: validatedData.branch,
        file: validatedData.file,
      },
    });

    return {
      success: true,
      id: heartbeat.id,
    };
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    if (error instanceof z.ZodError) {
      throw handleApiError(
        400,
        `Heartbeat API error: Validation error. Details: ${error.message}`
      );
    }
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred processing heartbeat.";
    const apiKeyPrefix =
      getHeader(event, "authorization")?.substring(7, 11) || "UNKNOWN";
    throw handleApiError(
      69,
      `Heartbeat API error: Failed to process heartbeat. API Key prefix: ${apiKeyPrefix}... Error: ${detailedMessage}`,
      "Failed to process your request."
    );
  }
});
