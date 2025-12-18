import { prisma } from "~~/prisma/db";
import { defineCronHandler } from "#nuxt/cron";

export default defineCronHandler(
  "daily",
  async () => {
    const date = new Date();
    date.setDate(date.getDate() - 90);

    const users = await prisma.user.findMany({
      where: {
        lastlogin: {
          lt: date,
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
