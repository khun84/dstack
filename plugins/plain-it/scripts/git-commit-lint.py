#!/usr/bin/env python3
"""PreToolUse hook — checks inline Git commit messages.

Blocks commits that violate the user's durable rules:
- Multi-line commit messages without explicit opt-in (`# ALLOW_MULTILINE`).
- Agent attribution phrases (`Co-Authored-By: Claude`, `Generated with Claude`).
- Missing conventional-commit prefix on the title.
- Missing `[CSO-NNN]` Jira tag when the current branch contains a Jira ID.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)

    cmd = payload.get("tool_input", {}).get("command", "")
    if not isinstance(cmd, str) or "git commit" not in cmd:
        sys.exit(0)

    # Skip --amend / --fixup / -C / interactive commits — message reuse,
    # not message authoring.
    if any(flag in cmd for flag in ("--amend", "--fixup", "--squash", " -C ")):
        sys.exit(0)

    msg = _extract_message(cmd)
    if not msg:
        sys.exit(0)

    errors: list[str] = []

    # Rule 1 — single-line commits by default.
    lines = [ln for ln in msg.strip().split("\n") if ln.strip()]
    if len(lines) > 1 and "ALLOW_MULTILINE" not in cmd:
        errors.append(
            f"Multi-line commit message ({len(lines)} non-empty lines). "
            "Global rule: single-line by default. Ask the user, then append "
            "`# ALLOW_MULTILINE` to the command if approved."
        )

    # Rule 2 — no agent attribution.
    banned = (
        "Co-Authored-By: Claude",
        "Generated with Claude",
        "Generated with [Claude",
        "🤖 Generated with",
    )
    for needle in banned:
        if needle in msg:
            errors.append(f"Forbidden attribution phrase in message: {needle!r}")

    # Rule 3 — conventional prefix on title.
    title = lines[0] if lines else ""
    if not re.match(
        r"^(feat|fix|chore|refactor|docs|test|perf|build|ci|style|revert)"
        r"(\([^)]+\))?!?:\s+\S",
        title,
    ):
        errors.append(
            f"Title missing conventional-commit prefix "
            f"(feat|fix|chore|refactor|docs|test|perf|build|ci|style|revert): {title!r}"
        )

    # Rule 4 — Jira ID tag when branch carries one. Branches are
    # commonly lowercase (e.g. `feat/cso-586-...`) but the PR title
    # requires the upper-cased tag, so match case-insensitively and
    # normalize before checking the title.
    branch = _current_branch()
    if branch:
        jira = re.search(r"([A-Za-z]{2,}-\d+)", branch)
        if jira:
            tag = jira.group(1).upper()
            if f"[{tag}]" not in title:
                errors.append(
                    f"Branch contains Jira ID {tag} but title is missing "
                    f"`[{tag}]` tag."
                )

    if errors:
        print(json.dumps({
            "decision": "block",
            "reason": (
                "git-commit-lint blocked the commit. Fix and retry:\n  - "
                + "\n  - ".join(errors)
            ),
        }))
    sys.exit(0)


def _extract_message(cmd: str) -> str:
    """Pull the commit message text out of a `git commit ...` shell command.

    Handles the two forms used in practice:
    - `git commit -m "title"` (single -m, possibly with escaped quotes)
    - `git commit -m "$(cat <<'EOF'\\n...\\nEOF\\n)"` (HEREDOC)
    Multiple `-m` flags are concatenated with blank lines (matches git's behaviour).
    """
    heredoc = re.search(r"<<'?\s*EOF'?\s*\n(.*?)\nEOF", cmd, re.DOTALL)
    if heredoc:
        return heredoc.group(1)

    parts = re.findall(r'-m\s+"((?:[^"\\]|\\.)*)"', cmd, re.DOTALL)
    if parts:
        return "\n\n".join(p.replace('\\"', '"').replace("\\n", "\n") for p in parts)

    parts_single = re.findall(r"-m\s+'((?:[^'\\]|\\.)*)'", cmd, re.DOTALL)
    if parts_single:
        return "\n\n".join(parts_single)

    return ""


def _current_branch() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.strip()
    except Exception:
        return ""


if __name__ == "__main__":
    main()
