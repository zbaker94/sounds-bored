# Changelog

## Current Changes
- Added a `pre-push` git hook that auto-stamps `CHANGELOG.md` with the version heading, Claude-generated release summary, and bullet points when pushing a version tag
- Updated the release workflow to prefer the pre-stamped version section in `CHANGELOG.md` over `## Current Changes`, with a fallback if the hook didn't run
- Release workflow now exposes two separate env vars: `RELEASE_NOTES_FULL` (all bullets) for the GitHub release body, and `RELEASE_NOTES_SUMMARY` (intro paragraph) for the updater release notes
- `package.json` `prepare` script updated to also `chmod +x` the new `pre-push` hook
- Added a pre-commit hook that auto-generates changelog entries using Claude CLI and inserts them under a `## Current Changes` section in `CHANGELOG.md`
- Release workflow now extracts `## Current Changes` as release notes, stamps the section with the version number, and publishes notes to GitHub releases on both repos
- Release artifact downloads and uploads now filter to specific file patterns (`*.exe`, `*.msi`, `*.sig`, `*.json`) instead of grabbing everything
- Added a `prepare` npm script to auto-configure the git hooks path and set executable permissions on install
