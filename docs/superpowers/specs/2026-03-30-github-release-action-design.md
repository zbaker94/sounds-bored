# GitHub Release Action Design

**Date:** 2026-03-30
**Status:** Approved

## Goal

Build a Windows binary and publish it to GitHub Releases automatically when a `v*` tag is pushed. The tag triggers a version bump commit back to `master` before building.

## Trigger

```yaml
on:
  push:
    tags:
      - 'v*'
```

Tag format: `v0.1.0`, `v1.2.3`, etc.

## Permissions

```yaml
permissions:
  contents: write
```

Required for: pushing the version bump commit and creating the GitHub Release.

## Job: `release` on `windows-latest`

### Step 1: Checkout

`actions/checkout@v4` with `fetch-depth: 0` to ensure full history is available for the push-back.

### Step 2: Extract version

Strip the `v` prefix from the tag and write to `$GITHUB_ENV`:

```bash
echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_ENV
```

### Step 3: Update version files

Three files must have their `version` field updated to match the tag:

- **`package.json`** — Node.js inline script to parse/rewrite JSON, preserving 2-space indent
- **`src-tauri/tauri.conf.json`** — same Node.js approach
- **`src-tauri/Cargo.toml`** — `sed` replace on the `^version = "..."` line (only one such line in the package section)

`Cargo.lock` is intentionally not updated here — `cargo` regenerates it during the build.

### Step 4: Commit version bump to master

```bash
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to $VERSION [skip ci]"
git push origin HEAD:master
```

`[skip ci]` in the commit message prevents the push from re-triggering CI workflows.

**Sequencing note:** The tag points to the pre-bump commit. The version bump lands on `master` after the tag. The build runs from the checked-out working tree (version files already modified in place), so built artifacts always carry the correct version regardless of what the tag SHA points to.

### Step 5: Setup toolchain

- `actions/setup-node@v4` — Node 20, `npm` cache
- `dtolnay/rust-toolchain@stable` — stable Rust
- `Swatinem/rust-cache@v2` — cache Rust build artifacts (workspaces: `src-tauri`)

### Step 6: Install JS dependencies

```bash
npm ci
```

### Step 7: Build and release

`tauri-apps/tauri-action@v0` with:

| Input | Value |
|---|---|
| `tagName` | `${{ github.ref_name }}` |
| `releaseName` | `SoundsBored ${{ env.VERSION }}` |
| `releaseDraft` | `false` |
| `prerelease` | `false` |
| `GITHUB_TOKEN` | `${{ secrets.GITHUB_TOKEN }}` |

The action builds the Tauri app (`npm run build` + Tauri bundler), creates the GitHub Release, and uploads all Windows bundle artifacts: NSIS installer (`.exe`) and MSI installer (`.msi`) from `src-tauri/target/release/bundle/`.

## File Created

`.github/workflows/release.yml`

## Out of Scope

- Code signing
- macOS / Linux builds
- Release notes body (left empty — edit manually after release creation)
- Pre-release version conventions (e.g. `-beta.1` suffixes)
