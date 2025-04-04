export default defineEventHandler(async (event) => {
  deleteCookie(event, "session");
  await sendRedirect(event, "/");
});
