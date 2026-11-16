# dstack

An agent-agnostic plugin marketplace. One plugin folder carries skills, hooks, and scripts that work across coding agents. Each agent harness gets its own thin manifest next to the shared files.

**Current focus: Codex.** Every plugin ships for Codex first. Other harnesses come later, one at a time.

```
plugins/<name>/
  .codex-plugin/plugin.json     Codex manifest
  skills/  hooks/  scripts/     shared by every harness
```

## Harness support

| Harness | Catalog | Plugin manifest | Status |
|---|---|---|---|
| Codex | `.agents/plugins/marketplace.json` | `.codex-plugin/plugin.json` | Supported |
| Claude Code | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | Planned |
| Other agents (OpenCode, Cursor, Pi, ...) | | | Planned |

Shared code reads harness-specific inputs (session ID, plugin root, hook payload) at its edge, so the logic in between stays the same for every harness.

Scripts and hooks are Node.js (`.mjs`) with built-in modules only, no npm packages. Claude Code ships with Node, and plugins cannot install dependencies for you.

## Plugins

- `model-routing`. Block model providers or models per chat. Not built yet. Codex first.

## Add a plugin

1. Create `plugins/<name>/` with its shared files.
2. Add a manifest for each supported harness, for Codex `plugins/<name>/.codex-plugin/plugin.json`.
3. List it in each harness catalog, for Codex `.agents/plugins/marketplace.json` with `"path": "./plugins/<name>"`.
4. Run `node check.mjs`.

## Codex

### Register

Add to `~/.codex/config.toml` (use the absolute path of your clone), then install plugins from the Codex plugin list:

```toml
[marketplaces.dstack]
source_type = "local"
source = "/absolute/path/to/dstack"
```

### Edit loop

Codex installs a copy of each plugin into `~/.codex/plugins/cache/dstack/<name>/<version>/`. Editing this repo does not change the installed copy. After a change, bump `version` in both `plugin.json` and `marketplace.json`, run `node check.mjs`, reinstall, and restart Codex.

Hook commands find their own files through `${PLUGIN_ROOT}`. Codex also sets `PLUGIN_DATA` to a per-plugin data directory.

`check.mjs` checks the Codex catalog today. It grows a check per harness as each one is added.
