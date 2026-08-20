import { config } from "./config.js";
import { migrateDatabase } from "./migrations.js";

const version = migrateDatabase(config.databasePath);
process.stdout.write(`${JSON.stringify({ type: "database_migration_completed", at: new Date().toISOString(), version })}\n`);
