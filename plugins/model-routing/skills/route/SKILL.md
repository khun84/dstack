---
name: route
description: Block or unblock subagent models for this chat without editing pstack-models.md. Use for $route, and for plain requests like "don't use GLM", "avoid astra", "skip ilmu today", "ilmu is down", "no GPT", "GLM is fine again", "back to normal routing", "what models am I blocking", or "what if I block X".
---

# Route

A per-chat block list for subagent models. A `spawn_agent` hook denies blocked models and names equal-strength models from the pstack rows. This skill turns the user's words into exact script calls.

Script: `node <folder of this SKILL.md>/../../scripts/route.mjs <command>`. It reads `CODEX_THREAD_ID`, so run it from the lead chat only. Rules written by a subagent are never read.

## Short forms

| User types | Command |
|---|---|
| `$route` | `status` |
| `$route glm` | `block 'ilmu/*'` |
| `$route +glm` | `unblock 'ilmu/*'` |
| `$route ?glm` | `block 'ilmu/*' --dry-run` |
| `$route off` or `$route reset` | `reset` |

Plain words use the same map. "Avoid", "skip", "no", "don't use", and "X is down" mean block. "X is fine again" and "allow X" mean unblock. "Back to normal", "default routing", and "clear" mean reset. "What if", "preview", "dry run", and "check first" mean `--dry-run`.

## Names to patterns

| Words | Pattern |
|---|---|
| glm, ilmu | `ilmu/*` |
| gpt, openai | `gpt-*` |
| flash, flashx | `*flash*` |
| one model (astra, luna, sol) | its full id, for example `gpt-6-astra` |

Always quote the pattern. If a word fits no row here and no model id in pstack, run `--dry-run` first, show the matches, and wait for a yes. Do the same when a word could mean more than one set, such as "the fast ones".

## Reply

Show the script's first line. Show the model list only for `?` and status. If the script exits 2 (no match, or not blocked), show its message and ask what the user meant.
