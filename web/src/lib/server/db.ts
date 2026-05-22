import { env } from "cloudflare:workers";

export function getDb() {
  return env.DB;
}

export function now() {
  return Date.now();
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function all<T>(statement: D1PreparedStatement) {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function first<T>(statement: D1PreparedStatement) {
  return (await statement.first<T>()) ?? null;
}

export function assertOwned<T>(
  row: T | null | undefined,
  resource = "Resource"
): asserts row is T {
  if (!row) {
    throw new Error(`${resource} not found`);
  }
}
