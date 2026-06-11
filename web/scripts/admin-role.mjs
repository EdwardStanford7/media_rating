#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const useLocal = process.argv.includes("--local");
const args = process.argv.slice(2).filter((arg) => arg !== "--local");
const [action, email] = args;

if (!["promote", "demote"].includes(action) || !email) {
    console.error("Usage: node scripts/admin-role.mjs <promote|demote> user@example.com [--local]");
    process.exit(1);
}

const config = readWranglerConfig();
const databaseName = config.d1_databases?.[0]?.database_name;
if (!databaseName) {
    console.error("Could not find d1_databases[0].database_name in wrangler.jsonc.");
    process.exit(1);
}

const user = selectUserByEmail(email);
if (!user) {
    console.error(`No user found for ${email}. The user must sign up before their role can be changed.`);
    process.exit(1);
}

const previousRole = user.role || "user";
const roles = parseRoleList(previousRole).filter((role) => role !== "admin");
const nextRoles = action === "promote" ? [...roles, "admin"] : roles;
const nextRole = nextRoles.length > 0 ? nextRoles.join(",") : "user";
const timestamp = Date.now();

executeSql(
    `UPDATE "user" SET role = '${sqlString(nextRole)}', updatedAt = ${timestamp} WHERE id = '${sqlString(user.id)}'`
);
executeSql(
    `INSERT INTO admin_audit_events (
       id, actor_user_id, actor_label, target_user_id, action, reason, metadata_json, created_at
     )
     VALUES (
       'audit_${randomUUID()}',
       NULL,
       'script:admin-role',
       '${sqlString(user.id)}',
       '${action === "promote" ? "promote_user" : "demote_user"}',
       '${action === "promote" ? "Promoted by admin-role script" : "Demoted by admin-role script"}',
       '${sqlString(JSON.stringify({
           email: user.email,
           previousRole,
           nextRole,
           local: useLocal
       }))}',
       ${timestamp}
     )`
);

console.log(`${action === "promote" ? "Promoted" : "Demoted"} ${user.email}: ${previousRole} -> ${nextRole}`);

function selectUserByEmail(userEmail) {
    const output = execFileSync(
        "pnpm",
        [
            "exec",
            "wrangler",
            "d1",
            "execute",
            databaseName,
            useLocal ? "--local" : "--remote",
            "--json",
            "--command",
            `SELECT id, email, COALESCE(role, 'user') AS role FROM "user" WHERE lower(email) = lower('${sqlString(userEmail)}') LIMIT 1`
        ],
        {
            encoding: "utf8"
        }
    );
    const payload = JSON.parse(output);
    const resultSet = Array.isArray(payload) ? payload[0] : payload;
    return resultSet?.results?.[0] ?? null;
}

function executeSql(command) {
    execFileSync(
        "pnpm",
        [
            "exec",
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

function parseRoleList(role) {
    return String(role)
        .split(",")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
}

function sqlString(value) {
    return String(value).replaceAll("'", "''");
}

function readWranglerConfig() {
    const jsonc = readFileSync("wrangler.jsonc", "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(jsonc);
}
