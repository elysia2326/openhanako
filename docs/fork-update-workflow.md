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

## Windows Auto-Update Release

The fork has a Windows-only release workflow:

```text
.github/workflows/fork-windows-release.yml
```

Use it when you want the installed Windows app to receive an update.
The original full-platform `.github/workflows/build.yml` is disabled on `elysia2326/openhanako`, because it expects macOS signing secrets that this fork does not need for the Windows auto-update channel.

The tag must match the app version in `package.json`. For example, to publish `v0.345.7`:

```powershell
cd "D:\hana agent\openhanako"

node scripts/bump-hana-version.mjs 0.345.7
npm run typecheck
node scripts/hana-agent-quality-harness.mjs --stage all
npm run check:update-health

git add package.json package-lock.json
git commit -m "chore: release hana agent v0.345.7"
git tag v0.345.7
git push origin main
git push origin v0.345.7
```

Pushing the tag runs `Fork Windows Release`. The workflow:

- checks that `vX.Y.Z` matches `package.json.version`;
- verifies the update feed still points to `elysia2326/openhanako`;
- builds the Windows installer;
- uploads `HanaAgent-*-Windows-x64.exe` and `latest.yml`;
- publishes the release as a prerelease.

After the workflow completes, run:

```powershell
npm run check:update-health:remote
```

Expected result: `Remote update release` should become `PASS`.

## Rollback

`scripts/update-from-upstream.ps1` creates a backup branch before merging:

```text
backup/pre-upstream-sync-YYYYMMDD-HHMMSS
```

Use that branch as the recovery point if an upstream merge needs to be abandoned or inspected later.
