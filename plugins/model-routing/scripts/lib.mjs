import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENTRY = /^([^\s(]+)\s*(?:\((?:reasoning_effort:\s*)?([a-z]+)\))?$/;
const THREAD = /^[\w-]+$/;

export const stateDir = () => process.env.MODEL_ROUTING_DIR ?? join(homedir(), ".agents/model-routing");
const pstackPath = () => process.env.PSTACK_MODELS ?? join(homedir(), ".agents/pstack-models.md");
const statePath = (thread) => join(stateDir(), `${thread}.json`);

export const validThread = (thread) => typeof thread === "string" && THREAD.test(thread);

export function parseRows(text) {
  const rows = new Map();
  let inCodex = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      inCodex = line === "## codex";
      continue;
    }
    if (!inCodex || !line || line.startsWith("#")) continue;
    const colon = line.indexOf(": ");
    if (colon < 0) continue;
    const entries = line
      .slice(colon + 2)
      .split(/\s+or\s+|,\s+/)
      .map((part) => part.trim().match(ENTRY))
      .filter(Boolean)
      .map(([, model, effort]) => ({ model, effort: effort ?? null }));
    if (entries.length) rows.set(line.slice(0, colon), entries);
  }
  return rows;
}

export function loadRows() {
  const path = pstackPath();
  return existsSync(path) ? parseRows(readFileSync(path, "utf8")) : new Map();
}

export function globToRegex(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

export const blockedBy = (model, rules) => rules.find((rule) => globToRegex(rule.pattern).test(model))?.pattern ?? null;

export function readRules(thread) {
  const path = statePath(thread);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data?.blocked) || !data.blocked.every((rule) => typeof rule?.pattern === "string")) {
    throw new Error(`${path} has no valid "blocked" list`);
  }
  return data.blocked;
}

export function writeRules(thread, rules) {
  const path = statePath(thread);
  if (!rules.length) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(stateDir(), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ thread, blocked: rules }, null, 2)}\n`);
  renameSync(temp, path);
}
