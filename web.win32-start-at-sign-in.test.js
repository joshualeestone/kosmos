'use strict';
/**
 * win32-installer-native (W-21a, W-22): the "Start Kosmos when I sign in to Windows" switch on
 * Settings > This computer, from the page's own source.
 *
 * 🔑 THE SWITCH SHOWS ONLY WHAT THE ENGINE READ. It is drawn only for a boolean the engine put on
 * the row (engine/machine.js leaves it off when the task's state could not be read), and after a
 * click its position comes from a fresh /api/machine, never from the click. (A full browser check
 * of the rendered switch timed out on a file:// hit-test in CI and is deferred to a follow-up; this
 * DOM-level test is the switch's committed coverage in the meantime.)
 *
 *   node --test web.win32-start-at-sign-in.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const LAYER = page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS);
const ROW_FNS = ['esc', 'chkRow', 'machineRows'];
const CLICK_FNS = [...ROW_FNS, 'wireMachineRows', 'startAtSignInClick', 'refreshMachineRows'];
const CHK = { CHK_CLASS: { ok: 'ok', attention: 'att', unknown: 'unk' }, CHK_MARK: { ok: '✓', attention: '!', unknown: '?' } };

function docFor(platform, byId) {
  return {
    querySelector: (sel) => (sel === 'meta[name="kosmos-platform"]' && platform !== undefined ? { getAttribute: () => platform } : null),
    getElementById: (id) => (byId && byId[id]) || null,
  };
}

/** The page's own functions, with `document` and the globals in `extra` bound. */
function pageFns(platform, names, extra) {
  const e = extra || {};
  const params = ['document', ...Object.keys(e).filter((k) => k !== 'document')];
  const values = params.slice(1).map((k) => e[k]);
  // eslint-disable-next-line no-new-func
  return new Function(...params, LAYER + '\n' + page.liftAll(SCRIPT, names)
    + '\nreturn { machineRows, ' + names.filter((n) => n !== 'machineRows' && n !== 'esc' && n !== 'chkRow').join(', ') + ' };')(
    e.document || docFor(platform), ...values);
}

const rows = (platform, report) => pageFns(platform, ROW_FNS, CHK).machineRows(report);

const AUTOSTART_ON = { key: 'autostart', state: 'ok', title: 'Kosmos starts itself when you sign in',
  detail: 'Kosmos starts when you sign in to Windows, and your agents come back on their own after a restart.',
  admin: 'To remove its startup job (Kosmos\\board): schtasks /Delete /F /TN "Kosmos\\board"', startAtSignIn: true };

test('a row the engine read as on draws the switch on, labelled, as a real switch', () => {
  const html = rows('win32', { checks: [AUTOSTART_ON] });
  assert.match(html, /<button class="toggle on" type="button" role="switch" aria-checked="true" aria-label="Start Kosmos when I sign in to Windows" data-start-at-sign-in><i><\/i><\/button>/);
  assert.match(html, /<b>Start Kosmos when I sign in to Windows<\/b>/);
  assert.ok(html.indexOf('data-start-at-sign-in') > html.indexOf('</details>'), 'the switch is not after the row\'s own words');
});

test('a row the engine read as off draws the switch off', () => {
  const html = rows('win32', { checks: [{ ...AUTOSTART_ON, state: 'attention', admin: undefined, startAtSignIn: false }] });
  assert.match(html, /<button class="toggle" type="button" role="switch" aria-checked="false"/);
});

test('🛑 no boolean from the engine, no switch: an unknown row, a missing task, a string', () => {
  const unknown = { key: 'autostart', state: 'unknown', title: 'We could not check whether Kosmos starts when you sign in', detail: 'Not the same as it being wrong.' };
  assert.doesNotMatch(rows('win32', { checks: [unknown] }), /data-start-at-sign-in|role="switch"/);
  assert.doesNotMatch(rows('win32', { checks: [{ ...AUTOSTART_ON, startAtSignIn: 'true' }] }), /data-start-at-sign-in/, 'a string was drawn as a position');
  assert.doesNotMatch(rows('win32', { checks: [{ ...AUTOSTART_ON, startAtSignIn: null }] }), /data-start-at-sign-in/);
});

test('MAC UNCHANGED: a Mac autostart row renders exactly as before, with no switch', () => {
  assert.equal(rows('darwin', { checks: [{ key: 'autostart', state: 'ok', title: 'T', detail: 'D' }] }),
    '<div class="chk ok"><div class="chk-m" aria-hidden="true">✓</div><div><div class="chk-t">T</div><div class="chk-d">D</div></div></div>');
});

/* A tiny DOM for the click: the message line, the rows container, and the switch. */
function clickRig(answers) {
  const calls = [];
  const msg = { hidden: true, textContent: '' };
  const removed = [];
  const mach = {
    innerHTML: '',
    listeners: 0,
    querySelectorAll: (sel) => (sel === '[data-start-at-sign-in]' && mach.innerHTML.includes('data-start-at-sign-in')
      ? [{ addEventListener: () => { mach.listeners += 1; }, closest: () => ({ remove: () => removed.push('switch row') }) }] : []),
  };
  const sw = { disabled: false, getAttribute: (name) => (name === 'aria-checked' ? answers.clickedFrom : null) };
  const fetch = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : undefined });
    const a = url === '/api/machine' ? answers.machine : answers.post;
    if (a instanceof Error) throw a;
    return { ok: a.status === 200, status: a.status, json: async () => a.body };
  };
  const document = docFor('win32', { 'set-machine-msg': msg, 'set-machine': mach });
  const fns = pageFns('win32', CLICK_FNS, { ...CHK, document, fetch });
  return { fns, sw, msg, mach, calls, removed };
}

test('a click asks for the other position, then repaints from what the engine reads now', async () => {
  const rig = clickRig({
    clickedFrom: 'true',
    post: { status: 200, body: { ok: true, on: false } },
    machine: { status: 200, body: { checks: [{ ...AUTOSTART_ON, state: 'attention', admin: undefined, startAtSignIn: false }] } },
  });
  await rig.fns.startAtSignInClick(rig.sw);
  assert.deepEqual(rig.calls.map((c) => c.method + ' ' + c.url), ['POST /api/machine/start-at-sign-in', 'GET /api/machine']);
  assert.deepEqual(rig.calls[0].body, { on: false });
  assert.match(rig.mach.innerHTML, /aria-checked="false"/, 'the repaint did not come from the engine\'s answer');
  assert.equal(rig.mach.listeners, 1, 'the repainted switch was not wired');
  assert.equal(rig.msg.hidden, true);
});

test('Windows refusing says why, and the switch still repaints from the engine, not from the click', async () => {
  const rig = clickRig({
    clickedFrom: 'false',
    post: { status: 409, body: { error: 'we could not set the board to start at logon again (ERROR: Access is denied.)' } },
    machine: { status: 200, body: { checks: [{ ...AUTOSTART_ON, state: 'attention', startAtSignIn: false }] } },
  });
  await rig.fns.startAtSignInClick(rig.sw);
  assert.deepEqual(rig.calls[0].body, { on: true });
  assert.equal(rig.msg.hidden, false);
  assert.equal(rig.msg.textContent, 'we could not set the board to start at logon again (ERROR: Access is denied.)');
  assert.match(rig.mach.innerHTML, /aria-checked="false"/);
});

test('when the rows cannot be read again, the switch is taken away and the page says it could not read it', async () => {
  const rig = clickRig({ clickedFrom: 'true', post: new Error('offline'), machine: new Error('offline') });
  rig.mach.innerHTML = rows('win32', { checks: [AUTOSTART_ON] });
  await rig.fns.startAtSignInClick(rig.sw);
  assert.deepEqual(rig.removed, ['switch row'], 'a switch whose position nobody could read stayed on screen');
  assert.equal(rig.msg.hidden, false);
  assert.equal(rig.msg.textContent, 'We could not change whether Kosmos starts when you sign in just now.');
});
