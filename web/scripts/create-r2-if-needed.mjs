import { execFileSync } from "node:child_process";

const bucketName = process.argv[2] ?? "media-rating-images";

function runWrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"]
  });
}

let listOutput = "";
try {
  listOutput = runWrangler(["r2", "bucket", "list"]);
} catch (error) {
  const stderr = error.stderr?.toString() ?? "";
  if (stderr.includes("code: 10042") || stderr.includes("enable R2")) {
    console.error("R2 is not enabled for this Cloudflare account yet.");
    console.error("Open the Cloudflare dashboard, enable R2 Object Storage, then rerun this command.");
  } else {
    process.stderr.write(stderr);
  }
  process.exit(error.status || 1);
}

if (listOutput.includes(bucketName)) {
  console.log(`R2 bucket '${bucketName}' already exists.`);
  process.exit(0);
}

console.log(`Creating R2 bucket '${bucketName}'...`);
try {
  process.stdout.write(runWrangler(["r2", "bucket", "create", bucketName]));
} catch (error) {
  const stderr = error.stderr?.toString() ?? "";
  if (stderr.includes("already exists")) {
    console.log(`R2 bucket '${bucketName}' already exists.`);
    process.exit(0);
  }
  process.stderr.write(stderr);
  process.exit(error.status || 1);
}
