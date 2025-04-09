-- AddForeignKey
ALTER TABLE "DailyProjectSummary" ADD CONSTRAINT "DailyProjectSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
