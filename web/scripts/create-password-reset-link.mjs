#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const useLocal = args.includes("--local");
const positional = args.filter((arg) => !arg.startsWith("--"));
const email = positional[0]?.trim();
const explicitBaseUrl = positional[1]?.trim();

if (!email) {
    console.error("Usage: node scripts/create-password-reset-link.mjs user@example.com [app-url] [--local]");
    console.error("Example: make password-reset-link EMAIL=user@example.com");
    process.exit(1);
}

const config = readWranglerConfig();
const databaseName = config.d1_databases?.[0]?.database_name;
const baseUrl = trimTrailingSlash(
    explicitBaseUrl ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    config.vars?.BETTER_AUTH_URL
);

if (!databaseName) {
    console.error("Could not find d1_databases[0].database_name in wrangler.jsonc.");
    process.exit(1);
}

if (!baseUrl) {
    console.error("Could not determine app URL. Pass it as the second argument or set APP_URL.");
    process.exit(1);
}

const user = findUserByEmail(email);
if (!user?.id) {
    console.error(`No user found for ${email}.`);
    process.exit(1);
}

const now = Date.now();
const expiresAt = now + 60 * 60 * 1000;
const token = randomBytes(18).toString("base64url");
const resetUrl = `${baseUrl}/?resetPassword=1&token=${encodeURIComponent(token)}`;

executeSql([
    `DELETE FROM verification WHERE value = ${sqlString(user.id)} AND identifier LIKE 'reset-password:%'`,
    `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (${sqlString(randomUUID())}, ${sqlString(`reset-password:${token}`)}, ${sqlString(user.id)}, ${sqlString(new Date(expiresAt).toISOString())}, ${sqlString(new Date(now).toISOString())}, ${sqlString(new Date(now).toISOString())})`
].join("; "));

console.log("");
console.log(`Password reset link for ${user.email}:`);
console.log(resetUrl);
console.log("");
console.log("This link expires in 1 hour and resets any older password reset links for that user.");

function findUserByEmail(targetEmail) {
    const output = executeSql(`SELECT id, email FROM "user" WHERE lower(email) = lower(${sqlString(targetEmail)}) LIMIT 1`);
    return firstResult(output);
}

function executeSql(command) {
    const output = execFileSync(
        "pnpm",
        [
            "exec",
            "wrangler",
            "d1",
            "execute",
            databaseName,
            useLocal ? "--local" : "--remote",
            "--command",
            command,
            "--json"
        ],
        {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"]
        }
    );

    return parseWranglerJson(output);
}

function firstResult(parsedOutput) {
    const envelopes = Array.isArray(parsedOutput) ? parsedOutput : [parsedOutput];
    for (const envelope of envelopes) {
        if (Array.isArray(envelope?.results) && envelope.results.length > 0) {
            return envelope.results[0];
        }
    }
    return null;
}

function parseWranglerJson(output) {
    const text = stripAnsi(output).trim();
    const starts = [...text.matchAll(/[\[{]/g)].map((match) => match.index ?? 0);
    for (const start of starts) {
        try {
            return JSON.parse(text.slice(start));
        } catch {
            // Wrangler can print preamble text before JSON. Keep trying later JSON starts.
        }
    }

    throw new Error(`Could not parse Wrangler JSON output:\n${text}`);
}

function readWranglerConfig() {
    const jsonc = readFileSync("wrangler.jsonc", "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(jsonc);
}

function sqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function trimTrailingSlash(value) {
    return value?.replace(/\/+$/, "");
}

function stripAnsi(value) {
    return value.replace(/\u001b\[[0-9;]*m/g, "");
}
