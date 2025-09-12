import { prisma } from "~~/prisma/prisma";
import { defineCronHandler } from "#nuxt/cron";

export default defineCronHandler(
  "daily",
  async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const users = await prisma.user.findMany({
      where: {
        lastlogin: {
          lt: thirtyDaysAgo,
        },
        heartbeats: {
          none: {},
        },
        summaries: {
          none: {},
        },
      },
    });

    if (users.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: users.map((user) => user.id),
          },
        },
      });

      handleLog(`Deleted ${users.length} inactive users`);
    }
  },
  {
    timeZone: "UTC",
    runOnInit: true,
  }
);
