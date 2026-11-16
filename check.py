#!/usr/bin/env python3
"""Check the dstack marketplace catalog against each plugin's manifest. Exits 1 on any problem."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def problems() -> list[str]:
    catalog = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text())
    found, seen = [], set()
    for entry in catalog["plugins"]:
        name = entry["name"]
        if name in seen:
            found.append(f"{name}: duplicate name in marketplace.json")
        seen.add(name)
        plugin_dir = ROOT / entry["source"]["path"]
        manifest = json.loads((plugin_dir / ".codex-plugin/plugin.json").read_text())
        if manifest.get("name") != name:
            found.append(f"{name}: plugin.json name is {manifest.get('name')!r}")
        if manifest.get("version") != entry.get("version"):
            found.append(f"{name}: version {entry.get('version')} in marketplace.json, {manifest.get('version')} in plugin.json")
        if (plugin_dir / "hooks/hooks.json").exists() and "hooks" not in manifest:
            found.append(f"{name}: hooks/hooks.json is auto-loaded by Codex; declare \"hooks\" in plugin.json")
        for key in ("skills", "hooks"):
            if isinstance(manifest.get(key), str) and not (plugin_dir / manifest[key]).exists():
                found.append(f"{name}: {key} points to missing {manifest[key]}")
    return found


if __name__ == "__main__":
    issues = problems()
    print("\n".join(issues) or "ok")
    sys.exit(1 if issues else 0)
