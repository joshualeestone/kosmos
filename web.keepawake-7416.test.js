'use strict';
/**
 * kosmos#7416 slice 3: the "Keep this computer awake while agents are working" switch on Settings > Computer, from
 * the page's own source. As the start-at-sign-in switch (web.win32-start-at-sign-in.test.js): drawn only for a
 * setting the engine READ, and after a click its position comes from a fresh /api/machine, never from the click.
 *
 *   node --test web.keepawake-7416.test.js
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
const CLICK_FNS = [...ROW_FNS, 'wireMachineRows', 'startAtSignInClick', 'keepAwakeClick', 'machineSwitchClick', 'refreshMachineRows'];
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

const SLEEP = { key: 'sleep', state: 'ok', title: 'This computer stays awake', detail: 'D', settings: true };
const NOW = 'An agent is working, so this computer is staying awake now.';

test('a sleep row the engine read draws the switch with its wording, off by default', () => {
  const html = rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: false, holding: false } }] });
  assert.match(html, /<button class="toggle" type="button" role="switch" aria-checked="false" aria-label="Keep this computer awake while agents are working" data-keep-awake><i><\/i><\/button>/);
  assert.match(html, /<b>Keep this computer awake while agents are working<\/b>/);
  assert.match(html, /Uses more power while agents work\. A laptop still sleeps when you close its lid, unless it&rsquo;s plugged in with a screen attached\./);
  assert.ok(html.indexOf('data-keep-awake') > html.indexOf('data-sleep-settings'), 'the switch is not under the sleep row\'s own button');
  assert.equal(html.includes(NOW), false, 'an off switch said the computer is being held awake');
});

test('on, it says so only while the engine says it is holding', () => {
  const holding = rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: true, holding: true } }] });
  assert.match(holding, /class="toggle on"[^>]*aria-checked="true"/);
  assert.ok(holding.includes(NOW));
  assert.equal(rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: true, holding: false } }] }).includes(NOW), false, 'nothing was working and it said it was holding');
});

test('on, a caffeinate that did not start says so in plain words, and never while holding', () => {
  const failed = rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: true, holding: false, because: 'caffeinate did not start (<ENOENT>)' } }] });
  assert.ok(failed.includes('We could not keep this computer awake just now.</p>'), 'the failure was not shown');
  assert.equal(failed.includes('ENOENT'), false, 'an error code reached the Settings screen');
  assert.equal(failed.includes(NOW), false);
  assert.doesNotMatch(rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: false, holding: false, because: 'x' } }] }), /data-keep-awake-failed/, 'an off switch reported a failure');
  assert.doesNotMatch(rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: true, holding: true, because: 'x' } }] }), /data-keep-awake-failed/, 'a live hold reported a failure');
});

test('🛑 nothing the engine read, no switch', () => {
  assert.doesNotMatch(rows('darwin', { checks: [SLEEP] }), /data-keep-awake|role="switch"/);
  assert.doesNotMatch(rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: 'true' } }] }), /data-keep-awake/, 'a string was drawn as a position');
  assert.doesNotMatch(rows('darwin', { checks: [{ ...SLEEP, keepAwake: null }] }), /data-keep-awake/);
});

function clickRig(answers) {
  const calls = [];
  const msg = { hidden: true, textContent: '' };
  const removed = [];
  const mach = {
    innerHTML: '',
    listeners: 0,
    querySelectorAll: (sel) => (sel === '[data-keep-awake]' && mach.innerHTML.includes('data-keep-awake')
      ? [{ addEventListener: () => { mach.listeners += 1; }, closest: () => ({ remove: () => removed.push('switch row') }) }] : []),
  };
  const sw = { disabled: false, getAttribute: (name) => (name === 'aria-checked' ? answers.clickedFrom : null) };
  const fetch = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : undefined });
    const a = url === '/api/machine' ? answers.machine : answers.put;
    if (a instanceof Error) throw a;
    return { ok: a.status === 200, status: a.status, json: async () => a.body };
  };
  const document = docFor('darwin', { 'set-machine-msg': msg, 'set-machine': mach });
  const fns = pageFns('darwin', CLICK_FNS, { ...CHK, document, fetch, kplusRemote: () => false, KPLUS_SETTINGS_ELSEWHERE: '' });
  return { fns, sw, msg, mach, calls, removed };
}

test('a click asks for the other position, then repaints from the engine, not from the click', async () => {
  const rig = clickRig({
    clickedFrom: 'false',
    put: { status: 200, body: { on: true, ok: true, supported: true, holding: false } },
    machine: { status: 200, body: { checks: [{ ...SLEEP, keepAwake: { on: false, holding: false } }] } },
  });
  await rig.fns.keepAwakeClick(rig.sw);
  assert.deepEqual(rig.calls.map((c) => c.method + ' ' + c.url), ['PUT /api/keepawake-setting', 'GET /api/machine']);
  assert.deepEqual(rig.calls[0].body, { on: true });
  assert.match(rig.mach.innerHTML, /aria-checked="false"/, 'the repaint did not come from the engine\'s answer');
  assert.equal(rig.mach.listeners, 1, 'the repainted switch was not wired');
  assert.equal(rig.msg.hidden, true);
});

test('a refused save says why', async () => {
  const rig = clickRig({
    clickedFrom: 'true',
    put: { status: 403, body: { error: 'only you can change this, from Settings' } },
    machine: { status: 200, body: { checks: [{ ...SLEEP, keepAwake: { on: true, holding: false } }] } },
  });
  await rig.fns.keepAwakeClick(rig.sw);
  assert.deepEqual(rig.calls[0].body, { on: false });
  assert.equal(rig.msg.hidden, false);
  assert.equal(rig.msg.textContent, 'only you can change this, from Settings');
});

test('when the rows cannot be read again, the switch is taken away', async () => {
  const rig = clickRig({ clickedFrom: 'true', put: new Error('offline'), machine: new Error('offline') });
  rig.mach.innerHTML = rows('darwin', { checks: [{ ...SLEEP, keepAwake: { on: true, holding: false } }] });
  await rig.fns.keepAwakeClick(rig.sw);
  assert.deepEqual(rig.removed, ['switch row'], 'a switch whose position nobody could read stayed on screen');
  assert.equal(rig.msg.hidden, false);
  assert.equal(rig.msg.textContent, 'We could not reach Kosmos to save that.');
});
