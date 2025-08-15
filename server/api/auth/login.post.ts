import bcrypt from "bcrypt";
import { encrypt } from "paseto-ts/v4";
import { prisma } from "~~/prisma/prisma";
import { z } from "zod";
import { handleApiError} from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth"],
    summary: "Login with email and password",
    description: "Authenticates a user and sets a session cookie.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string" },
            },
            required: ["email", "password"],
          },
        },
      },
    },
    responses: {
      302: { description: "Redirect on success" },
      400: { description: "Validation error" },
      401: { description: "Invalid credentials" },
      500: { description: "Authentication failed" },
    },
    operationId: "postLogin",
  },
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const config = useRuntimeConfig();

  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    throw handleApiError(400, `Login validation failed for email ${body.email}. Errors: ${JSON.stringify(validation.error)}`, validation.error.message || "Email and password are required");
  }

  try {
    const { email, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      const errorDetail = `Invalid login attempt for email: ${email}. User not found or no password hash.`;
      throw handleApiError(401, errorDetail , "Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      const errorDetail = `Invalid login attempt for email: ${email}. Password mismatch.`;
      throw handleApiError(401, errorDetail , "Invalid email or password");
    }

    const token = encrypt(
      config.pasetoKey,
      {
        userId: user.id,
        email: user.email,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }
    );

    setCookie(event, "ziit_session", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    await sendRedirect(event, "/");
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) {
      throw error;
    }
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred during login.";
    throw handleApiError(500, `Authentication failed: ${detailedMessage}`, "Authentication failed. Please try again.");
  }
});
