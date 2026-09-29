'use strict';
/* claude-setup#100 (/design-shots): mobile-shots.js refuses a run that would take no shot, and decides it before
 * any browser or board starts, so this needs neither. The phone-only skip at the desktop size is exercised for
 * real by the gate's mobile-shots arm (tools/browser-checks.sh), which runs nav-menu at se and desktop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js');

/* MSHOTS_PLAN_ONLY=1 makes the tool stop right after deciding its plan, whatever is installed: no browser, no board. */
function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, MSHOTS_PLAN_ONLY: '1', ...env }, encoding: 'utf8', timeout: 60000 });
}

test('every requested screen phone-only at the desktop size: exit 2, before a browser starts', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'nav-menu', '--themes', 'light', '--engines', 'chromium']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no shot would be taken/);
});

test('control: the same run plus one screen that is not phone-only passes the check, with one shot planned', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'nav-menu,home', '--themes', 'light', '--engines', 'chromium']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /no shot would be taken/);
  assert.match(r.stdout, /planned 1 screen\(s\)/);
});

/* kosmos#4524: a mistyped cover control would arm nothing and pass, so it is refused before the plan; the right
 * name is the control that the refusal is about the name. */
test('a mistyped MSHOTS_COVER_CONTROL is refused with exit 2, before a browser starts', () => {
  const r = run(['--sizes', 'se', '--screens', 'home'], { MSHOTS_COVER_CONTROL: 'cmnotic' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL must be cmnotice, not cmnotic/);
});

test('control: MSHOTS_COVER_CONTROL=cmnotice is accepted and the plan is made', () => {
  const r = run(['--sizes', 'se', '--screens', 'home', '--themes', 'light', '--engines', 'chromium'], { MSHOTS_COVER_CONTROL: 'cmnotice' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /planned 1 screen\(s\)/);
});
