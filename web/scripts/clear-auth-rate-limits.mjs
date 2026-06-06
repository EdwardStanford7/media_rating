#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const useLocal = process.argv.includes("--local");
const config = readWranglerConfig();
const databaseName = config.d1_databases?.[0]?.database_name;

if (!databaseName) {
    console.error("Could not find d1_databases[0].database_name in wrangler.jsonc.");
    process.exit(1);
}

executeSql("DELETE FROM rateLimit");
console.log(`Cleared ${useLocal ? "local" : "remote"} auth rate limits.`);

function executeSql(command) {
    execFileSync(
        "npx",
        [
            "wrangler",
            "d1",
            "execute",
            databaseName,
            useLocal ? "--local" : "--remote",
            "--command",
            command
        ],
        {
            stdio: "inherit"
        }
    );
}

function readWranglerConfig() {
    const jsonc = readFileSync("wrangler.jsonc", "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(jsonc);
}
