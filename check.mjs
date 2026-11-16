#!/usr/bin/env node
// Check the dstack marketplace catalog against each plugin's manifest. Exits 1 on any problem.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function problems(base = root) {
  const catalog = readJson(join(base, ".agents/plugins/marketplace.json"));
  const found = [];
  const seen = new Set();
  for (const entry of catalog.plugins) {
    const { name } = entry;
    if (seen.has(name)) found.push(`${name}: duplicate name in marketplace.json`);
    seen.add(name);
    const pluginDir = join(base, entry.source.path);
    const manifest = readJson(join(pluginDir, ".codex-plugin/plugin.json"));
    if (manifest.name !== name) found.push(`${name}: plugin.json name is ${JSON.stringify(manifest.name)}`);
    if (manifest.version !== entry.version) {
      found.push(`${name}: version ${entry.version} in marketplace.json, ${manifest.version} in plugin.json`);
    }
    if (existsSync(join(pluginDir, "hooks/hooks.json")) && !("hooks" in manifest)) {
      found.push(`${name}: hooks/hooks.json is auto-loaded by Codex; declare "hooks" in plugin.json`);
    }
    for (const key of ["skills", "hooks"]) {
      if (typeof manifest[key] === "string" && !existsSync(join(pluginDir, manifest[key]))) {
        found.push(`${name}: ${key} points to missing ${manifest[key]}`);
      }
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = problems(process.argv[2] ?? root);
  console.log(issues.join("\n") || "ok");
  process.exit(issues.length ? 1 : 0);
}
