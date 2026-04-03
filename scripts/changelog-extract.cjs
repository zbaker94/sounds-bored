#!/usr/bin/env node
// Called by .githooks/pre-push.
// Prints the content of the '## Current Changes' section to stdout.
'use strict';
const fs = require('fs');
const path = require('path');

const changelogPath = path.resolve('CHANGELOG.md');
const marker = '## Current Changes';

if (!fs.existsSync(changelogPath)) process.exit(0);

const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
const match = changelog.match(/^## Current Changes$/m);
const start = match ? match.index : -1;
if (start === -1) process.exit(0);

const afterMarker = changelog.indexOf('\n', start) + 1;
const rest = changelog.slice(afterMarker);
const nextSection = rest.search(/^## /m);
const content = (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim();

process.stdout.write(content);
