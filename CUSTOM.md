# Paperclip Fork — Custom Runbook

This is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) maintained by sethstevenson.

## Repository Layout

```
main                    — stable custom version (branched from upstream master)
custom/agent-chat       — active feature branch for direct agent chat work
master                  — mirrors upstream (do not commit custom code here)
```

Custom code lives under `/custom/` to isolate it from upstream files and minimize merge conflicts.

## Upstream Sync Procedure

```bash
# 1. Fetch latest upstream changes
git fetch upstream

# 2. Tag current state before merging (for rollback safety)
git tag pre-sync-$(date +%Y%m%d) main

# 3. Switch to main and merge upstream
git checkout main
git merge upstream/master

# 4. Resolve any conflicts, then push
git push origin main

# 5. Rebase feature branch onto updated main
git checkout custom/agent-chat
git rebase main
git push origin custom/agent-chat --force-with-lease
```

## Rollback Procedure

```bash
# Roll back main to the clean base (before any custom changes)
git checkout main
git reset --hard v0.0-base
git push origin main --force-with-lease

# Or roll back to a specific pre-sync tag
git reset --hard pre-sync-YYYYMMDD
git push origin main --force-with-lease
```

Available rollback points:
- `v0.0-base` — clean fork before any customization

## Custom Code Directory Structure

```
/custom/
  agent-chat/           — direct agent chat feature
    README.md           — feature-level docs
    ...                 — implementation files
```

All custom additions should be placed under `/custom/` unless modifying an existing upstream file is strictly necessary (e.g., wiring a route). In that case, keep the change minimal and add a comment: `// CUSTOM: <reason>`.

## Branching Convention

| Branch | Purpose |
|--------|---------|
| `main` | Stable custom baseline; stays in sync with upstream |
| `custom/<feature>` | Feature work; based off `main` |
| `master` | Upstream mirror — no custom commits |

## Tags

| Tag | Commit | Description |
|-----|--------|-------------|
| `v0.0-base` | `c610192c` | Clean fork before customization |
