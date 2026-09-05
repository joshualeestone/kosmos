'use strict';
/**
 * #2037 PR-C1: the daily-report SEND opt-in surfaces.
 *
 * The send behavior + once-per-day dedup live in engine/feedbacksend.test.js and
 * the route round-trip in server.test.js. This file pins the two wirings those
 * cannot see: that the LONG-LIVED BOARD actually fires the send on a timer (the
 * short-lived CLI cannot), and that the Settings > Automation switch is present,
 * wired to /api/feedback-setting, and uses the PRIVACY could-not-read treatment
 * (a privacy switch that reads a false Off is the exact failure to avoid).
 *
 * Ships ON by default (Josh: "baked in day one"), so a test here pins the
 * engine default ON (and the unreadable/corrupt path still OFF). The
 * install-time disclosure surface (install-flow Screen 6) is the fast-follow
 * (PR-C2); the Settings switch is the disclosure/opt-out for now.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

/* Strip comments so a presence check reads real code, never a comment mention
   of the id/copy (line comments only where the line begins with one, so the
   many https:// URLs in the page are not truncated). */
function codeOnly(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);
const CODE = codeOnly(SERVER);

test('the board (not the CLI) fires the daily send on a timer, and the engine is wired in', () => {
  assert.match(CODE, /require\('\.\/engine\/feedbacksend'\)/, 'server.js does not require feedbacksend');
  // The sweep: sendDailyOnce called from INSIDE the feedbackSweep timer body.
  // Anchored to `const feedbackSweep = setInterval(() => {` and bounded by `[^}]*`
  // (never crossing a `}`), so the call cannot be satisfied by a DIFFERENT sweep's
  // setInterval nor by the call being moved out of the timer to a bare statement -
  // both regressions the earlier lazy `[\s\S]*?` would have passed.
  assert.match(CODE, /const feedbackSweep = setInterval\(\(\) => \{[^}]*feedbacksend\.sendDailyOnce\(feedback\.today\(\)\)/,
    'feedbacksend.sendDailyOnce is not called from inside the feedbackSweep timer (the send never fires on a real install)');
  // unref'd like its sibling sweeps, so it never holds the process open.
  assert.match(CODE, /const feedbackSweep = setInterval[\s\S]{0,300}feedbackSweep[^;]*unref/,
    'the feedback sweep is not unref\'d, so it can hold the board process open');
});

test('the engine send defaults ON (Josh: baked in day one), unreadable still fails OFF', () => {
  const eng = codeOnly(fs.readFileSync(nodePath.join(__dirname, 'engine', 'feedbacksend.js'), 'utf8'));
  // ENOENT (a never-asked machine) reads ON - the launch default, pinned so the
  // flip is deliberate and visible. The unreadable/corrupt path still reads OFF
  // (the safe direction for a report body leaving the machine), so this asserts
  // BOTH: on for absent, off for the non-ENOENT error return.
  assert.match(eng, /err\.code === 'ENOENT'\) return \{ on: true/,
    'the feedback send no longer defaults ON (Josh ruled it baked in day one, #2037/#2013)');
  assert.match(eng, /return \{ on: false, sent: null, ok: false \};\s*\n\s*\}/,
    'the unreadable/corrupt path no longer fails to OFF (a report body could leave the machine on a read we cannot trust)');
});

test('the Settings switch is present, in Automation, with the approved copy', () => {
  for (const present of ['id="feedback-row"', 'id="feedback-toggle"', 'id="feedback-msg"',
    'Make Kosmos work better for everyone.',
    'Allow an agent to send a daily note with any system issues or improvement suggestions.']) {
    assert.ok(PAGE.includes(present), 'the daily-report switch is missing a piece: ' + present);
  }
  // The control: the Automation section it lives in must still exist, or the
  // presences above could pass on a page that lost the section entirely.
  assert.match(PAGE, /id="s-sec-automation"/, 'the Automation section is gone, so the presences prove nothing');
});

test('the switch is wired to /api/feedback-setting, and refreshed with its siblings', () => {
  assert.match(lift('refreshFeedback'), /\/api\/feedback-setting/,
    'refreshFeedback does not read /api/feedback-setting');
  assert.match(lift('feedbackToggleClick'), /\/api\/feedback-setting/,
    'feedbackToggleClick does not write /api/feedback-setting');
  assert.match(lift('feedbackToggleClick'), /method:\s*'PUT'/, 'the toggle does not PUT');
  // Refreshed where the other telemetry switches are (so opening Settings reads it).
  assert.match(PAGE, /refreshFeedback\(\);/, 'refreshFeedback is never called, so the switch never reads its state');
});

test('could-not-read is the PRIVACY treatment: knob hidden, actionable line, never a false Off', () => {
  const fp = lift('feedbackPaint');
  // paintSwitch(..., null) HIDES the knob on unread (no false position claimed).
  assert.match(fp, /paintSwitch\('feedback-toggle', unread \? null : r\.on === true\)/,
    'the switch paints a position on an unread setting (a false Off on a privacy control)');
  // Unread = no body, ok:false, or a non-boolean on (403-safe).
  assert.match(fp, /const unread = !r \|\| r\.ok === false \|\| typeof r\.on !== 'boolean'/,
    'the unread test is not 403-safe');
  assert.match(fp, /We could not check this setting here\. Open Kosmos from its icon/,
    'the could-not-read line is not the actionable privacy message');
  // refreshFeedback must not .json() a non-ok response into a position.
  assert.match(lift('refreshFeedback'), /if \(!res\.ok\) \{ if \(mine === FEEDBACK_EPOCH\) feedbackPaint\(null\)/,
    'refreshFeedback paints a non-ok GET as a position instead of could-not-read');
});
