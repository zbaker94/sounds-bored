#!/usr/bin/env node
// Called by .githooks/pre-commit.
// Reads SUMMARY from env and inserts it under '## Current Changes' in CHANGELOG.md.
'use strict';
const fs = require('fs');
const path = require('path');

const changelogPath = path.resolve('CHANGELOG.md');
const summary = process.env.SUMMARY;
const marker = '## Current Changes';

if (!summary) {
  console.error('[changelog-entry] SUMMARY env var is empty — nothing to write');
  process.exit(1);
}

let changelog = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n')
  : '# Changelog\n';

if (changelog.includes(marker)) {
  changelog = changelog.replace(marker + '\n', marker + '\n' + summary + '\n');
} else {
  const firstNewline = changelog.indexOf('\n');
  changelog = firstNewline !== -1
    ? changelog.slice(0, firstNewline + 1) + '\n' + marker + '\n' + summary + '\n' + changelog.slice(firstNewline + 1)
    : '# Changelog\n\n' + marker + '\n' + summary + '\n';
}

fs.writeFileSync(changelogPath, changelog, 'utf8');
