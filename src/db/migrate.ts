import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index";
import path from "path";

const migrationsFolder = path.resolve(__dirname, "../../drizzle");

console.log("Running migrations...");
migrate(db, { migrationsFolder });
console.log("Migrations complete.");
