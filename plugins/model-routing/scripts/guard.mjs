#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockedBy, loadRows, readRules, validThread } from "./lib.mjs";

function alternatives(model, rules, rows) {
  const found = new Map();
  let listed = false;
  for (const [role, entries] of rows) {
    if (!entries.some((entry) => entry.model === model)) continue;
    listed = true;
    for (const entry of entries) {
      if (blockedBy(entry.model, rules)) continue;
      const key = entry.effort ? `${entry.model} (${entry.effort})` : entry.model;
      found.set(key, [...(found.get(key) ?? []), role]);
    }
  }
  return { listed, found };
}

export function decide(payload) {
  if (payload?.tool_name !== "spawn_agent" || !validThread(payload.session_id)) return null;
  let rules;
  try {
    rules = readRules(payload.session_id);
  } catch (error) {
    return `MODEL ROUTING: this chat's routing file is broken (${error.message}). Do not spawn. Ask the user to run "$route off".`;
  }
  const model = typeof payload.tool_input?.model === "string" ? payload.tool_input.model.trim() : "";
  const rule = model && blockedBy(model, rules);
  if (!rule) return null;
  const head = `MODEL ROUTING: ${model} is blocked in this chat (rule: ${rule}).`;
  const { listed, found } = alternatives(model, rules, loadRows());
  if (!listed) {
    return `${head} It is in no pstack ## codex row, so there is no equal-strength list. Retry with an allowed model from your role's row in pstack-models.md. Ask the user only if every model in that row is blocked.`;
  }
  if (found.size) {
    return [
      head,
      "Equal-strength models from the pstack rows that list it:",
      ...[...found].map(([key, roles]) => `  - ${key}: ${roles.join(", ")}`),
      "Retry spawn_agent now with the model from your role's row, at that effort, and update the TIER line to match. Do not ask the user.",
    ].join("\n");
  }
  return `${head} Every model in its pstack rows is blocked too (rules: ${rules.map((r) => r.pattern).join(", ")}). Do not spawn with another model or without a model. Ask the user which model to use, and name the rules that blocked the others.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const reason = decide(payload);
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  }
}
