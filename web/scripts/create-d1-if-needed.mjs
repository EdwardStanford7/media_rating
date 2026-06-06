import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const databaseName = process.argv[2] ?? "media-rating";
const configUrl = new URL("../wrangler.jsonc", import.meta.url);
const config = JSON.parse(readFileSync(configUrl, "utf8"));
const placeholder = "replace-with-cloudflare-d1-database-id";
const existing = config.d1_databases?.find((binding) => binding.binding === "DB");

if (existing?.database_id && existing.database_id !== placeholder) {
  console.log(`D1 binding DB is already configured for ${existing.database_name} (${existing.database_id}).`);
  process.exit(0);
}

console.log(`Creating D1 database '${databaseName}'...`);
const output = execFileSync("npx", ["wrangler", "d1", "create", databaseName], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"]
});
process.stdout.write(output);

const databaseId = output.match(/"database_id":\s*"([^"]+)"/)?.[1];
if (!databaseId) {
  console.error("Could not find database_id in Wrangler output. Update wrangler.jsonc manually from the command output above.");
  process.exit(1);
}

const binding = {
  binding: "DB",
  database_name: databaseName,
  database_id: databaseId,
  migrations_dir: "migrations"
};

config.d1_databases = [
  binding,
  ...(config.d1_databases ?? []).filter((candidate) => candidate.binding !== "DB")
];

writeFileSync(configUrl, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updated wrangler.jsonc with D1 database_id ${databaseId}.`);
