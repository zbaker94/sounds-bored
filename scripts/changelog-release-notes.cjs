#!/usr/bin/env node
// Called by the release workflow.
// Reads the release section from CHANGELOG.md and writes RELEASE_NOTES_FULL
// and RELEASE_NOTES_SUMMARY to $GITHUB_ENV.
//
// Prefers ## v{VERSION} (stamped by pre-push hook); falls back to ## Current Changes.
'use strict';
const fs = require('fs');
const path = require('path');

const changelogPath = path.resolve('CHANGELOG.md');
const version = process.env.VERSION;
const githubEnv = process.env.GITHUB_ENV;

if (!version) {
  console.error('[changelog-release-notes] VERSION env var is required');
  process.exit(1);
}
if (!githubEnv) {
  console.error('[changelog-release-notes] GITHUB_ENV env var is required');
  process.exit(1);
}

const changelog = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n')
  : '# Changelog\n';

const versionMarker = '## v' + version;
const currentMarker = '## Current Changes';

let sectionStart = changelog.indexOf(versionMarker);
let needsRename = false;
if (sectionStart === -1) {
  sectionStart = changelog.indexOf(currentMarker);
  needsRename = true;
}

let fullNotes = 'No changelog entries.';
let summary = '';

if (sectionStart !== -1) {
  const afterMarker = changelog.indexOf('\n', sectionStart) + 1;
  const rest = changelog.slice(afterMarker);
  const nextSection = rest.search(/^## /m);
  fullNotes = (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim() || 'No changelog entries.';

  if (needsRename) {
    const updated = changelog.replace(currentMarker, versionMarker);
    fs.writeFileSync(changelogPath, updated, 'utf8');
  }

  // Summary = first paragraph before the bullet list (added by pre-push hook).
  // Falls back to full notes if no separate summary paragraph exists.
  const bulletIndex = fullNotes.search(/^- /m);
  summary = bulletIndex > 0 ? fullNotes.slice(0, bulletIndex).trim() : fullNotes;
}

function appendEnv(key, val) {
  const d = key + '_DELIM_' + Date.now();
  fs.appendFileSync(githubEnv, key + '<<' + d + '\n' + val + '\n' + d + '\n');
}

appendEnv('RELEASE_NOTES_FULL', fullNotes);
appendEnv('RELEASE_NOTES_SUMMARY', summary || fullNotes);

console.log('[changelog-release-notes] RELEASE_NOTES_FULL and RELEASE_NOTES_SUMMARY written to GITHUB_ENV');
