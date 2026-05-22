import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const failures = [];

const d1 = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!d1) {
  failures.push("Missing D1 binding named DB in wrangler.jsonc.");
} else {
  if (d1.database_name !== "media-rating") {
    failures.push(`D1 database_name should be "media-rating", found "${d1.database_name}".`);
  }
  if (!d1.database_id || d1.database_id === "replace-with-cloudflare-d1-database-id") {
    failures.push("D1 database_id is still the placeholder. Run `make cf-create-d1` or edit wrangler.jsonc.");
  }
}

const r2 = config.r2_buckets?.find((binding) => binding.binding === "IMAGES");
if (!r2) {
  failures.push("Missing R2 bucket binding named IMAGES in wrangler.jsonc.");
} else if (r2.bucket_name !== "media-rating-images") {
  failures.push(`R2 bucket_name should be "media-rating-images", found "${r2.bucket_name}".`);
}

const authUrl = config.vars?.BETTER_AUTH_URL;
if (!authUrl) {
  failures.push("BETTER_AUTH_URL is missing from wrangler.jsonc vars.");
} else if (authUrl.includes("localhost") || !authUrl.startsWith("https://")) {
  failures.push("BETTER_AUTH_URL must be the production HTTPS URL before deploy.");
}

if (failures.length > 0) {
  console.error("Deploy config is not ready:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deploy config looks ready.");
