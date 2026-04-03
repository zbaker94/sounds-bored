# Changelog

## Current Changes
- Added a pre-commit hook that auto-generates changelog entries using Claude CLI and inserts them under a `## Current Changes` section in `CHANGELOG.md`
- Release workflow now extracts `## Current Changes` as release notes, stamps the section with the version number, and publishes notes to GitHub releases on both repos
- Release artifact downloads and uploads now filter to specific file patterns (`*.exe`, `*.msi`, `*.sig`, `*.json`) instead of grabbing everything
- Added a `prepare` npm script to auto-configure the git hooks path and set executable permissions on install
