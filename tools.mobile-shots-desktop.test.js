'use strict';
/* claude-setup#100 (/design-shots): mobile-shots.js refuses a run that would take no shot, and decides it before
 * any browser or board starts, so this needs neither. The phone-only skip at the desktop size is exercised for
 * real by the gate's mobile-shots arm (tools/browser-checks.sh), which runs nav-menu at se and desktop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js');

/* NODE_PATH is removed so Playwright cannot load: a run that gets PAST the check stops there, cheaply. */
function run(args) {
  const env = { ...process.env };
  delete env.NODE_PATH;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 60000 });
}

test('every requested screen phone-only at the desktop size: exit 2, before a browser starts', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'nav-menu', '--themes', 'light', '--engines', 'chromium']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no shot would be taken/);
  assert.doesNotMatch(r.stderr, /playwright/i);
});

test('control: a run with a shot to take gets past the check (and stops at loading Playwright, hidden here)', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'nav-menu,home', '--themes', 'light', '--engines', 'chromium']);
  assert.doesNotMatch(r.stderr, /no shot would be taken/);
  assert.match(r.stderr, /Cannot find module 'playwright'/);
});
