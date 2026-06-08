import { execSync } from "child_process";
import pg from "pg";

const E2E_DB_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://gfl:gfl_dev_password@localhost:5433/gfl_e2e";

export default async function globalSetup() {
  // Point DATABASE_URL at the E2E database for the duration of this process.
  // The webServer (next start) inherits the env set here.
  process.env.DATABASE_URL = E2E_DB_URL;

  // Connect to the base postgres db to (re)create the E2E db.
  const parsed = new URL(E2E_DB_URL);
  const adminConnStr = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port}/postgres`;
  const client = new pg.Client({ connectionString: adminConnStr });
  await client.connect();
  const dbName = parsed.pathname.slice(1);
  await client.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
    [dbName]
  );
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const env = { ...process.env, DATABASE_URL: E2E_DB_URL };

  execSync("pnpm prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm tsx prisma/seed-e2e.ts", { env, stdio: "inherit" });
}
