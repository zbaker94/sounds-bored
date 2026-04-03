#!/usr/bin/env node
// Called by .githooks/pre-push.
// Reads VERSION, SUMMARY, BULLETS from env and stamps CHANGELOG.md:
//   ## Current Changes  →  ## v{VERSION}\n\n{summary}\n\n{bullets}
'use strict';
const fs = require('fs');
const path = require('path');

const changelogPath = path.resolve('CHANGELOG.md');
const version = process.env.VERSION;
const summary = process.env.SUMMARY || '';
const bullets = process.env.BULLETS || '';
const marker = '## Current Changes';

if (!version) {
  console.error('[changelog-stamp] VERSION env var is required');
  process.exit(1);
}

if (!fs.existsSync(changelogPath)) {
  console.error('[changelog-stamp] CHANGELOG.md not found');
  process.exit(1);
}

const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
const match = changelog.match(/^## Current Changes$/m);
const start = match ? match.index : -1;
if (start === -1) {
  console.error('[changelog-stamp] ## Current Changes not found');
  process.exit(1);
}

const afterMarker = changelog.indexOf('\n', start) + 1;
const rest = changelog.slice(afterMarker);
const nextSection = rest.search(/^## /m);
const after = nextSection === -1 ? '' : rest.slice(nextSection);

let section = '## v' + version + '\n';
if (summary) section += '\n' + summary + '\n';
if (bullets) section += '\n' + bullets + '\n';

const updated = changelog.slice(0, start) + section + (after ? '\n' + after : '');
fs.writeFileSync(changelogPath, updated, 'utf8');
