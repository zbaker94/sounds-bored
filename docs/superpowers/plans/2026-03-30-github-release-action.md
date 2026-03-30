# GitHub Release Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a GitHub Actions workflow that bumps version files from a `v*` tag, commits back to master, builds a Windows Tauri binary, and publishes it to GitHub Releases.

**Architecture:** Single workflow file triggered on `v*` tag push. Strips `v` prefix to get the semver, rewrites `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` in-place, commits back to `master` with `[skip ci]`, then uses `tauri-apps/tauri-action@v0` to build and create the release.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action@v0`, `actions/setup-node@v4`, `dtolnay/rust-toolchain`, `Swatinem/rust-cache@v2`, Node.js 20, Rust stable, `windows-latest` runner.

---

### Task 1: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

There are no automated tests for a GitHub Actions YAML file. Validation is:
1. YAML syntax check (via `npx js-yaml` — already available through Node)
2. Manual review of the rendered workflow in GitHub's UI after push

- [ ] **Step 1: Create the `.github/workflows/` directory and write `release.yml`**

Create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Extract version from tag
        shell: bash
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_ENV

      - name: Bump package.json
        shell: bash
        run: node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=process.env.VERSION;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

      - name: Bump src-tauri/tauri.conf.json
        shell: bash
        run: node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));p.version=process.env.VERSION;fs.writeFileSync('src-tauri/tauri.conf.json',JSON.stringify(p,null,2)+'\n')"

      - name: Bump src-tauri/Cargo.toml
        shell: bash
        run: sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

      - name: Commit version bump to master
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
          git commit -m "chore: bump version to $VERSION [skip ci]"
          git push origin HEAD:master

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust build artifacts
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install JS dependencies
        run: npm ci

      - name: Build and publish release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "SoundsBored ${{ env.VERSION }}"
          releaseDraft: false
          prerelease: false
```

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "require('fs'); const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('YAML valid')"
```

If `js-yaml` is not installed globally, use:

```bash
npx --yes js-yaml .github/workflows/release.yml && echo "YAML valid"
```

Expected output: `YAML valid` (no errors thrown).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add Windows release workflow on tag push"
```

---

## Manual Smoke Test (after push)

To verify the workflow end-to-end after merging to `master`:

1. Ensure the repo is pushed to GitHub with the workflow file on `master`
2. Create and push a test tag:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. In the GitHub repo, go to **Actions** → **Release** — confirm the workflow run starts
4. Confirm steps complete in order: checkout → version bump → commit push → build → release created
5. Check **Releases** page — confirm a release named `SoundsBored 0.1.1` exists with `.exe` and `.msi` assets
6. Check `master` branch — confirm a `chore: bump version to 0.1.1 [skip ci]` commit was added
7. Clean up test tag if needed: `git push origin --delete v0.1.1`

## Known Constraints

- The tag SHA and the version-bump commit are different objects on `master`. The tag points to the pre-bump commit — this is intentional and acceptable.
- The build runs from the checked-out working tree (version files modified before the build step), so artifacts always carry the correct version.
- `[skip ci]` in the commit message prevents the version-bump push from re-triggering this workflow.
- No code signing is configured. Windows Defender SmartScreen may warn on first run of unsigned executables.
