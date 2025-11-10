import cron from "node-cron";
import { runDailySync } from "./services/ProcessSyncService.js";
import { syncCasesFromTavily } from "./services/casesSync.js";

export const DEFAULT_CRON_EXPRESSION = "0 6 * * *";
export const processSyncCronExpression = process.env.CASE_SYNC_CRON || DEFAULT_CRON_EXPRESSION;

export const processSyncTask = cron.schedule(processSyncCronExpression, async () => {
  try {
    console.log("[cron] iniciando busca automática de processos...");
    await syncCasesFromTavily();
    await runDailySync();
    console.log("[cron] sincronização concluída com sucesso.");
  } catch (error) {
    console.error("[cron] falha ao executar sincronização automática", error);
  }
});

console.log(`[cron] rotina de processos agendada (${processSyncCronExpression})`);