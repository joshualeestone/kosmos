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
  return spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, MSHOTS_COVER_CONTROL: '', MSHOTS_LEAK_CONTROL: '', MSHOTS_PLAN_ONLY: '1', ...env }, encoding: 'utf8', timeout: 60000 });
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

/* #4594: the mirror, desktopOnly. The consolidated screens exist only at the desktop size. */
test('every requested screen desktop-only at a phone size: exit 2, before a browser starts', () => {
  const r = run(['--sizes', 'se', '--screens', 'cons-agents', '--themes', 'light', '--engines', 'chromium']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no shot would be taken: every requested screen is skipped/);
});

test('control: the same desktop-only screen at the desktop size is planned', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'cons-agents', '--themes', 'light', '--engines', 'chromium']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /planned 1 screen\(s\)/);
});

/* kosmos#4524: a mistyped cover control would arm nothing and pass, so it is refused before the plan. The correctly
 * spelled name is the control, showing the refusal is about the name. */
test('a mistyped MSHOTS_COVER_CONTROL is refused with exit 2, before a browser starts', () => {
  const r = run(['--sizes', 'se', '--screens', 'allow-card'], { MSHOTS_COVER_CONTROL: 'overlai' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL must be overlay or spill, not overlai/);
});

/* kosmos#4820: the cmnotice control went with the Community notice; asking for it is refused, not armed with nothing. */
test('MSHOTS_COVER_CONTROL=cmnotice is refused now that the notice is gone', () => {
  const r = run(['--sizes', 'se', '--screens', 'home'], { MSHOTS_COVER_CONTROL: 'cmnotice' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL must be overlay or spill, not cmnotice/);
});

for (const [name, screen] of [['overlay', 'allow-card'], ['spill', 'allow-card']]) {
  test(`control: MSHOTS_COVER_CONTROL=${name} on ${screen} is accepted and the plan is made`, () => {
    const r = run(['--sizes', 'se', '--screens', screen, '--themes', 'light', '--engines', 'chromium'], { MSHOTS_COVER_CONTROL: name });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /planned 1 screen\(s\)/);
  });
}

/* kosmos#4820: the Community notice is gone (Josh, 2026-09-30: no pop-up for existing users), and with it the
 * COVERED check that read #cmnotice. Pinned here so neither comes back half-way. */
test('#4820: the page no longer builds the Community notice, and mobile-shots no longer looks for it', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /cmnotice|communityNoticeCheck|notice-seen/);
  const shots = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');
  assert.doesNotMatch(shots, /#cmnotice|markNoticeSeen|#cn-ok/);
  // CONTROL: the same read finds a string that is there, so the two absences above are not a failed read.
  assert.match(html, /id="fr-s6-community"/);
  assert.match(shots, /MSHOTS_COVER_CONTROL/);
});

test('MSHOTS_COVER_CONTROL=overlay without the allow-card screen is refused: it would plant nothing and pass', () => {
  const r = run(['--sizes', 'se', '--screens', 'home'], { MSHOTS_COVER_CONTROL: 'overlay' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL=overlay needs the allow-card screen/);
});

test('MSHOTS_COVER_CONTROL=spill without the allow-card screen is refused: it would plant nothing and pass', () => {
  const r = run(['--sizes', 'se', '--screens', 'home'], { MSHOTS_COVER_CONTROL: 'spill' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL=spill needs the allow-card screen/);
});

test('MSHOTS_COVER_CONTROL=spill at the desktop size only is refused: the long code fits there', () => {
  const r = run(['--sizes', 'desktop', '--screens', 'allow-card'], { MSHOTS_COVER_CONTROL: 'spill' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /MSHOTS_COVER_CONTROL=spill needs a phone size/);
});
