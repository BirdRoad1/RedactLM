// Applies the migrations in drizzle/ that haven't run yet, then exits. Used
// when the Docker image starts, so it needs only drizzle-orm (not the
// drizzle-kit dev tool). Locally, `bunx drizzle-kit migrate` does the same.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "../src/db";

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log("Database is up to date");
process.exit(0);
