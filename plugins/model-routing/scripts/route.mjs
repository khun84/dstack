#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { blockedBy, globToRegex, loadRows, readRules, validThread, writeRules } from "./lib.mjs";

const USAGE = "usage: route.mjs [status | block <pattern> [--dry-run] | unblock <pattern> | reset] [--thread <id>]";

function matchesOf(pattern, rows) {
  const re = globToRegex(pattern);
  const hits = new Map();
  for (const [role, entries] of rows) {
    for (const { model } of entries) {
      if (re.test(model)) hits.set(model, new Set([...(hits.get(model) ?? []), role]));
    }
  }
  return hits;
}

const deadRows = (rules, rows) =>
  [...rows].filter(([, entries]) => entries.every(({ model }) => blockedBy(model, rules))).map(([role]) => role);

export function run(argv, env = process.env) {
  const args = [...argv];
  let thread = env.CODEX_THREAD_ID;
  const at = args.indexOf("--thread");
  if (at >= 0) [, thread] = args.splice(at, 2);
  const dryRun = args.includes("--dry-run");
  const [command = "status", pattern] = args.filter((arg) => arg !== "--dry-run");
  if (!validThread(thread)) return { code: 2, out: "No chat id. Run inside Codex (CODEX_THREAD_ID) or pass --thread <id>." };
  if (command === "reset") {
    writeRules(thread, []);
    return { code: 0, out: "Cleared this chat's rules. pstack routing applies again." };
  }
  let rules;
  try {
    rules = readRules(thread);
  } catch (error) {
    return { code: 1, out: `Routing file for this chat is broken: ${error.message}. Run reset to clear it.` };
  }
  const rows = loadRows();
  const patterns = rules.map((rule) => rule.pattern);
  if (command === "status") {
    if (!rules.length) return { code: 0, out: "No rules in this chat. pstack routing applies." };
    const lines = rules.map((rule) => `- ${rule.pattern}  set ${rule.set_at}  ${matchesOf(rule.pattern, rows).size} models`);
    const dead = deadRows(rules, rows);
    return { code: 0, out: [`This chat (${thread.slice(0, 8)}):`, ...lines, `Rows with no allowed model: ${dead.join(", ") || "none"}`].join("\n") };
  }
  if (!pattern || !["block", "unblock"].includes(command)) return { code: 2, out: USAGE };
  if (command === "unblock") {
    if (!patterns.includes(pattern)) return { code: 2, out: `${pattern} is not blocked in this chat. Blocked: ${patterns.join(", ") || "nothing"}.` };
    const left = rules.filter((rule) => rule.pattern !== pattern);
    writeRules(thread, left);
    return { code: 0, out: `Unblocked ${pattern}. Left: ${left.map((rule) => rule.pattern).join(", ") || "none, pstack routing applies"}.` };
  }
  const hits = matchesOf(pattern, rows);
  const prefix = dryRun ? "DRY RUN. Nothing saved.\n" : "";
  if (!hits.size) return { code: 2, out: `${prefix}${pattern} matches no model in pstack ## codex. Refused.` };
  if (patterns.includes(pattern)) return { code: 0, out: `${pattern} is already blocked in this chat.` };
  const next = [...rules, { pattern, set_at: new Date().toISOString() }];
  const dead = deadRows(next, rows);
  const out = [
    `${prefix}${dryRun ? "Would block" : "Blocked"} ${pattern} in this chat. ${hits.size} models:`,
    ...[...hits].map(([model, roles]) => `  ${model}  (${[...roles].join(", ")})`),
    `Rows left with no allowed model: ${dead.join(", ") || "none"}`,
  ];
  if (dead.length) out.push("Spawns for these roles will stop and ask the user.");
  if (!dryRun) writeRules(thread, next);
  return { code: 0, out: out.join("\n") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  console.log(out);
  process.exit(code);
}
