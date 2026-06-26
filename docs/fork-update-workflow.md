# HanaAgent Fork Update Workflow

## Goal

Keep this fork on the upstream OpenHanako release line while preserving local HanaAgent customizations.

The app must update from `elysia2326/openhanako`, not directly from upstream `liliMozi/openhanako`.

## Invariants

- Runtime updater feed defaults to `github:elysia2326/openhanako`.
- Packaged `resources/app-update.yml` is generated during `afterPack`.
- Desktop launcher prefers an installed HanaAgent before the local dev package.
- Local feature work stays in git commits before any upstream sync.
- A fork release is published only after merge and verification.

## Normal Update Flow

```powershell
cd "D:\hana agent\openhanako"

# Start from a clean committed state.
git status --short

# Pull upstream into this fork branch and run the update health gate.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update-from-upstream.ps1

# Run broader gates before publishing a fork release.
node scripts/hana-agent-quality-harness.mjs --stage all
npm run typecheck
npm run check:update-health
npm run check:update-health:remote
```

If the merge reports conflicts, resolve them by preserving this fork's local feature modules and update-feed changes, then rerun:

```powershell
npm run check:update-health
```

## Release Rule

Do not install or auto-update from upstream releases directly.

After upstream changes are merged into this fork and verified, publish a GitHub Release under `elysia2326/openhanako` with the Windows installer and `latest.yml`. The running app will then update from the fork release feed.

## Rollback

`scripts/update-from-upstream.ps1` creates a backup branch before merging:

```text
backup/pre-upstream-sync-YYYYMMDD-HHMMSS
```

Use that branch as the recovery point if an upstream merge needs to be abandoned or inspected later.
