#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRules, validThread } from "./lib.mjs";

export function statusLine(payload) {
  if (!validThread(payload?.session_id)) return "";
  try {
    const rules = readRules(payload.session_id);
    return rules.length ? `Model routing for this chat: blocked ${rules.map((rule) => rule.pattern).join(", ")}.` : "";
  } catch {
    return "Model routing for this chat: the routing file is broken, so every spawn is denied until $route off.";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const line = statusLine(payload);
  if (line) console.log(line);
}
