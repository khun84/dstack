# dstack

Personal Codex plugin marketplace. Each plugin lives in `plugins/<name>/` and is listed in `.agents/plugins/marketplace.json`.

## Register

Add to `~/.codex/config.toml` (use the absolute path of your clone), then install plugins from the Codex plugin list:

```toml
[marketplaces.dstack]
source_type = "local"
source = "/absolute/path/to/dstack"
```

## Plugins

- `model-routing`. Block model providers or models per chat. Not built yet.

## Add a plugin

1. Create `plugins/<name>/.codex-plugin/plugin.json`.
2. Add an entry to `.agents/plugins/marketplace.json` with `"path": "./plugins/<name>"`.
3. Run `python3 check.py`.

## Edit loop

Codex installs a copy of each plugin into `~/.codex/plugins/cache/dstack/<name>/<version>/`. Editing this repo does not change the installed copy. After a change, bump `version` in both `plugin.json` and `marketplace.json`, run `python3 check.py`, reinstall, and restart Codex.

Hook commands find their own files through `${PLUGIN_ROOT}`. Codex also sets `PLUGIN_DATA` to a per-plugin data directory.
