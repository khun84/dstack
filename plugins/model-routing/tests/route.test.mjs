import assert from "node:assert/strict";
import { spawn as spawnProcess, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
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

test("guard still denies when the pstack path is a directory", () => {
  route("t-unreadable", "block", "ilmu/*");
  const result = spawnSync(process.execPath, [join(scripts, "guard.mjs")], {
    input: JSON.stringify({ tool_name: "spawn_agent", session_id: "t-unreadable", tool_input: { model: "ilmu/glm-5.3" } }),
    env: { ...process.env, PSTACK_MODELS: root },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /pstack file could not be read/i);
  assert.match(decision.permissionDecisionReason, /no alternatives are listed/i);
  assert.match(decision.permissionDecisionReason, /Retry with an allowed model from your role's/);
  assert.match(decision.permissionDecisionReason, /Ask the user only if every model in that row is blocked/);
});

test("guard subprocess allows missing state and denies broken state", () => {
  writeFileSync(join(root, "state", "t-bad-hook.json"), "{not json");
  for (const [thread, denied] of [["t-missing-hook", false], ["t-bad-hook", true]]) {
    const result = spawnSync(process.execPath, [join(scripts, "guard.mjs")], {
      input: JSON.stringify({ tool_name: "spawn_agent", session_id: thread, tool_input: { model: "gpt-6.1-sol" } }),
      env: { ...process.env, PSTACK_MODELS: root }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    if (denied) assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
    else assert.equal(result.stdout, "");
  }
  assert.equal(route("t-bad-hook", "reset").code, 0);
  assert.deepEqual(patterns("t-bad-hook"), []);
});

test("concurrent block commands keep every distinct rule", async () => {
  const expected = Array.from({ length: 40 }, (_, mask) =>
    [..."gpt-6.1-sol"].map((char, index) => index < 6 && (mask & (1 << index)) ? "?" : char).join(""));
  assert.equal(new Set(expected).size, 40);
  const results = await Promise.all(expected.map((pattern) => new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [join(scripts, "route.mjs"), "block", pattern, "--thread", "t-concurrent"], {
      env: process.env,
      timeout: 10000,
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  })));
  for (const result of results) assert.equal(result.code, 0, result.output);
  const actual = patterns("t-concurrent").sort();
  assert.deepEqual(actual, expected.sort(), `Kept ${actual.length} of ${expected.length} rules`);
});

test("active locks reject all writes but allow status and dry run", () => {
  route("t-locked", "block", "ilmu/*");
  const lock = join(root, "state", "t-locked.json.lock");
  writeFileSync(lock, "");
  assert.equal(route("t-locked", "status").code, 0);
  assert.equal(route("t-locked", "block", "gpt-*", "--dry-run").code, 0);
  for (const args of [["unblock", "ilmu/*"], ["reset"]]) {
    assert.equal(route("t-locked", ...args, "--dry-run").code, 2);
    assert.deepEqual(patterns("t-locked"), ["ilmu/*"]);
  }
  for (const args of [["block", "gpt-*"], ["unblock", "ilmu/*"], ["reset"]]) {
    const now = new Date();
    utimesSync(lock, now, now);
    const result = spawnSync(process.execPath, [join(scripts, "route.mjs"), ...args, "--thread", "t-locked"], {
      env: process.env, encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /timed out.*lock/i);
    assert.deepEqual(patterns("t-locked"), ["ilmu/*"]);
    assert.equal(existsSync(lock), true);
  }
});

test("stale locks are replaced and released after the update", () => {
  const lock = join(root, "state", "t-stale.json.lock");
  writeFileSync(lock, "");
  const old = new Date(Date.now() - 11000);
  utimesSync(lock, old, old);
  assert.equal(route("t-stale", "block", "gpt-*").code, 0);
  assert.deepEqual(patterns("t-stale"), ["gpt-*"]);
  assert.equal(existsSync(lock), false);
});

test("failed updates release the lock so the next command can run", () => {
  assert.equal(route("t-release", "block", "gemini*").code, 2);
  assert.equal(existsSync(join(root, "state", "t-release.json.lock")), false);
  const result = spawnSync(process.execPath, [join(scripts, "route.mjs"), "block", "gpt-*", "--thread", "t-release"], {
    env: { ...process.env, PSTACK_MODELS: root }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(existsSync(join(root, "state", "t-release.json.lock")), false);
  assert.equal(route("t-release", "block", "gpt-*").code, 0);
});
