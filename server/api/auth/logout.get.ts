defineRouteMeta({
  openAPI: {
    tags: ["Auth"],
    summary: "Logout current user",
    description: "Clears the session cookie and redirects to home.",
    responses: {
      302: { description: "Redirect after logout" },
    },
    operationId: "getLogout",
  },
});

export default defineEventHandler(async (event) => {
  deleteCookie(event, "ziit_session");
  await sendRedirect(event, "/");
});
