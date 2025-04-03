import jwt from "jsonwebtoken";

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const sessionCookie = getCookie(event, "session");
  
  if (path === "/login" || path === "/register") {
    if (sessionCookie) {
      return sendRedirect(event, "/");
    }
    return;
  }
  
  if (path.startsWith("/api/auth/")) {
    return;
  }
  
  if (!sessionCookie) {
    return sendRedirect(event, "/login");
  }

  try {
    const config = useRuntimeConfig();
    const decoded = jwt.verify(sessionCookie, config.jwtSecret);

    if (typeof decoded !== "object" || decoded === null || !("userId" in decoded)) {
      throw new Error("Invalid token");
    }
    
    return;
  } catch (error) {
    console.error(error)
    deleteCookie(event, "session");
    return sendRedirect(event, "/login");
  }
});
