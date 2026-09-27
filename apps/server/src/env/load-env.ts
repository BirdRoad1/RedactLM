import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// The repo root's .env: one for the whole monorepo, found from wherever a
// script runs (apps/server, the root, a test). Values already set (Docker,
// the shell) win; no .env at all (the Docker image) is fine.
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
