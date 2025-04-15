export default defineEventHandler(async (event) => {
  deleteCookie(event, "ziit_session");
  await sendRedirect(event, "/");
});
