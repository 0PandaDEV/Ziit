import { runDataMaintenance } from "~~/server/utils/normalize-backfill";

export default defineNitroPlugin(() => {
  setTimeout(() => {
    runDataMaintenance().catch((error) => {
      console.error("[normalize] failed", error);
    });
  }, 0);
});
