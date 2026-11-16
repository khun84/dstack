import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../scripts/guard.mjs";
import { parseRows, readRules } from "../scripts/lib.mjs";
import { run } from "../scripts/route.mjs";
import { statusLine } from "../scripts/status_line.mjs";

const PSTACK = `## claude-code
bug-fix: opus
## codex
# comment line
bug-fix: gpt-6.1-sol (reasoning_effort: medium) or ilmu/glm-5.3 (reasoning_effort: high) or ilmu/ilmu-glm-5.3 (reasoning_effort: high)
live verification: ilmu/glm-5.3-flashx (reasoning_effort: high) or gpt-6-luna (reasoning_effort: max)
arena runners: gpt-6-astra (high), ilmu/glm-5.3 (max)
`;

const scripts = join(dirname(fileURLToPath(import.meta.url)), "../scripts");
const root = mkdtempSync(join(tmpdir(), "model-routing-test-"));
process.env.MODEL_ROUTING_DIR = join(root, "state");
process.env.PSTACK_MODELS = join(root, "pstack.md");
writeFileSync(process.env.PSTACK_MODELS, PSTACK);

const route = (thread, ...args) => run(args, { CODEX_THREAD_ID: thread });
const spawn = (thread, model) => decide({ tool_name: "spawn_agent", session_id: thread, tool_input: { model } });
const patterns = (thread) => readRules(thread).map((rule) => rule.pattern);

test("reads only the codex block, with efforts", () => {
  const rows = parseRows(PSTACK);
  assert.deepEqual([...rows.keys()], ["bug-fix", "live verification", "arena runners"]);
  assert.deepEqual(rows.get("bug-fix")[0], { model: "gpt-6.1-sol", effort: "medium" });
  assert.deepEqual(rows.get("arena runners")[1], { model: "ilmu/glm-5.3", effort: "max" });
});

test("block refuses a pattern that matches no pstack model", () => {
  assert.equal(route("t-refuse", "block", "gemini*").code, 2);
  assert.deepEqual(patterns("t-refuse"), []);
});

test("dry run reports matches and saves nothing", () => {
  const result = route("t-dry", "block", "*flash*", "--dry-run");
  assert.equal(result.code, 0);
  assert.match(result.out, /ilmu\/glm-5\.3-flashx/);
  assert.deepEqual(patterns("t-dry"), []);
});

test("block, unblock, and reset change only this chat", () => {
  route("t-life", "block", "ilmu/*");
  route("t-life", "block", "gpt-6-astra");
  assert.deepEqual(patterns("t-life"), ["ilmu/*", "gpt-6-astra"]);
  assert.deepEqual(patterns("t-other"), []);
  route("t-life", "unblock", "ilmu/*");
  assert.deepEqual(patterns("t-life"), ["gpt-6-astra"]);
  assert.equal(route("t-life", "unblock", "ilmu/*").code, 2);
  route("t-life", "reset");
  assert.equal(existsSync(join(root, "state", "t-life.json")), false);
});

test("guard allows when the chat has no rules or the model is not blocked", () => {
  assert.equal(spawn("t-free", "ilmu/glm-5.3"), null);
  route("t-allow", "block", "ilmu/*");
  assert.equal(spawn("t-allow", "gpt-6.1-sol"), null);
  assert.equal(decide({ tool_name: "exec_command", session_id: "t-allow", tool_input: { model: "ilmu/glm-5.3" } }), null);
});

test("guard denies a blocked model and names unblocked models from the same rows", () => {
  route("t-deny", "block", "ilmu/*");
  const reason = spawn("t-deny", "ilmu/glm-5.3");
  assert.match(reason, /gpt-6\.1-sol \(medium\): bug-fix/);
  assert.match(reason, /gpt-6-astra \(high\): arena runners/);
  assert.doesNotMatch(reason, /ilmu\/ilmu-glm-5\.3/);
  assert.match(reason, /Do not ask the user/);
});

test("guard tells the agent to ask only when no equal model is left", () => {
  route("t-none", "block", "ilmu/*");
  route("t-none", "block", "gpt-*");
  const reason = spawn("t-none", "ilmu/glm-5.3-flashx");
  assert.match(reason, /Ask the user/);
  assert.doesNotMatch(reason, /Do not ask the user/);
});

test("a broken routing file denies spawns and shows in the status line", () => {
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(join(root, "state", "t-broken.json"), "{not json");
  assert.match(spawn("t-broken", "gpt-6.1-sol"), /broken/);
  assert.match(statusLine({ session_id: "t-broken" }), /broken/);
});

test("status line is silent without rules and lists rules when set", () => {
  assert.equal(statusLine({ session_id: "t-quiet" }), "");
  route("t-line", "block", "gpt-6-astra");
  assert.equal(statusLine({ session_id: "t-line" }), "Model routing for this chat: blocked gpt-6-astra.");
});

test("guard.mjs as a hook prints a deny decision, and stays silent on bad input", () => {
  route("t-hook", "block", "ilmu/*");
  const hook = (input) => spawnSync(process.execPath, [join(scripts, "guard.mjs")], { input, env: process.env, encoding: "utf8" });
  const denied = hook(JSON.stringify({ tool_name: "spawn_agent", session_id: "t-hook", tool_input: { model: "ilmu/glm-5.3" } }));
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  const garbage = hook("not json");
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, "");
});
