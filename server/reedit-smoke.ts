import { config } from "./config.js";
import { UserStore } from "./db.js";
import { runReeditIntegrityCheck } from "./reedit-integrity.js";

const store = new UserStore(config.databasePath);
try {
  const results = runReeditIntegrityCheck(store, config.tosInputRetentionDays, true);
  process.stdout.write(`${JSON.stringify({ type: "reedit_smoke_completed", at: new Date().toISOString(), results })}\n`);
} finally {
  store.close();
}
