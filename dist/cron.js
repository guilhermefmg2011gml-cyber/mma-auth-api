import cron from "node-cron";
import { runDailySync } from "./services/ProcessSyncService.js";
const DEFAULT_CRON_EXPRESSION = "0 6,14,22 * * *";
export function registerProcessSyncCron() {
    const expression = process.env.CASE_SYNC_CRON || DEFAULT_CRON_EXPRESSION;
    if (!expression) {
        return;
    }
    cron.schedule(expression, async () => {
        try {
            await runDailySync();
            console.log(`[cron] daily sync executed at ${new Date().toISOString()}`);
        }
        catch (error) {
            console.error("[cron] failed to run daily sync", error);
        }
    });
}
