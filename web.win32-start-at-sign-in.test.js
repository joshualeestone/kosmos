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
const CLICK_FNS = [...ROW_FNS, 'wireMachineRows', 'startAtSignInClick', 'startAtSignInRecoverySaid', 'keepAwakeClick', 'machineSwitchClick', 'refreshMachineRows'];
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
  assert.match(html, /<button class="toggle on" type="button" role="switch" aria-checked="true" aria-label="Start Kosmos when I sign in to Windows" aria-describedby="start-at-sign-in-hint" data-start-at-sign-in><i><\/i><\/button>/);
  assert.match(html, /<b>Start Kosmos when I sign in to Windows<\/b>/);
  assert.ok(html.indexOf('data-start-at-sign-in') > html.indexOf('</details>'), 'the switch is not after the row\'s own words');
});

/* #7493: the switch is also the #2988 watchdog's off switch, so the row says so, on and off alike, and
   the switch points at that sentence for a screen reader. */
test('the switch row says it also restarts Kosmos, and the switch is described by that sentence (#7493)', () => {
  const hint = 'When this is on, Kosmos also tries to start again if it closes unexpectedly. When it is off, Kosmos stays closed until you open it.';
  for (const startAtSignIn of [true, false]) {
    const html = rows('win32', { checks: [{ ...AUTOSTART_ON, startAtSignIn }] });
    assert.ok(html.includes('<div class="dhint" id="start-at-sign-in-hint" style="margin:2px 0 0;">' + hint + '</div>'), 'no hint when ' + startAtSignIn);
    assert.ok(html.includes('aria-describedby="start-at-sign-in-hint"'), 'switch not described when ' + startAtSignIn);
  }
  // CONTROL: no switch, no hint (it describes the switch, so it never stands alone).
  assert.doesNotMatch(rows('win32', { checks: [{ ...AUTOSTART_ON, startAtSignIn: null }] }), /start-at-sign-in-hint/);
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

/* kosmos#7504: the route says when turning the switch on did not register the crash-recovery watchdog (#7498), with
   its kind. The switch shows on either way, so the line under the rows is the only place that failure is said. The
   page owns the words (design review); the engine's own sentence is never shown. */
const ON_ROWS = { status: 200, body: { checks: [{ ...AUTOSTART_ON, startAtSignIn: true }] } };
const NO_REOPEN = 'Kosmos will start when you sign in, but it will not reopen on its own if it closes.';
const RETRY = 'Turn the switch off and on to try again.';
async function saidFor(watchdog) {
  const rig = clickRig({ clickedFrom: 'false', post: { status: 200, body: { ok: true, on: true, watchdog } }, machine: ON_ROWS });
  await rig.fns.startAtSignInClick(rig.sw);
  assert.match(rig.mach.innerHTML, /aria-checked="true"/, 'the switch did not repaint on from the engine');
  return rig.msg.hidden ? null : rig.msg.textContent;
}

test('kosmos#7504: Windows refused: the page says it will not reopen, Windows\' own words without ERROR:, and the way out', async () => {
  const because = 'we could not register the job that restarts the board if it stops (ERROR: Access is denied.)';
  assert.equal(await saidFor({ ok: false, kind: 'refused', detail: 'Access is denied.', because }),
    NO_REOPEN + ' Windows did not allow it: Access is denied. ' + RETRY);
  assert.equal(await saidFor({ ok: false, kind: 'refused', detail: '', because }), NO_REOPEN + ' Windows did not allow it. ' + RETRY, 'an empty detail left a colon');
  assert.equal(await saidFor({ ok: false, kind: 'refused', because }), NO_REOPEN + ' Windows did not allow it. ' + RETRY);
});

test('kosmos#7504: not set up yet is said as fixing itself, with no way out to take', async () => {
  assert.equal(await saidFor({ ok: false, kind: 'not-yet', because: 'Kosmos has not set up its startup files on this computer yet, so the job that restarts it if it stops is registered the next time Kosmos starts' }),
    'Kosmos will start when you sign in. It will set itself to reopen if it closes the next time it starts.');
});

test('kosmos#7504: no time left says "yet" and the way out; any other kind, or none, says the first sentence and the way out', async () => {
  assert.equal(await saidFor({ ok: false, kind: 'no-time', because: 'there was no time left in this read to ask Task Scheduler, so ...' }),
    'Kosmos will start when you sign in, but it will not reopen on its own yet if it closes. ' + RETRY);
  for (const w of [{ ok: false, kind: 'other', because: 'we could not tell where Kosmos keeps its startup files' }, { ok: false, because: 'an older engine with no kind' }, { ok: false, kind: 'something new' }]) {
    assert.equal(await saidFor(w), NO_REOPEN + ' ' + RETRY, JSON.stringify(w));
  }
});

test('kosmos#7504: unknown (it could not be checked) says so, never that it will not reopen; a detail ending in ? or ! gets no extra full stop', async () => {
  assert.equal(await saidFor({ ok: false, kind: 'unknown', because: 'we could not tell whether ...' }),
    'Kosmos will start when you sign in, but we could not check whether it will reopen on its own if it closes. ' + RETRY);
  assert.equal(await saidFor({ ok: false, kind: 'refused', detail: 'Access is denied!' }), NO_REOPEN + ' Windows did not allow it: Access is denied! ' + RETRY);
  assert.equal(await saidFor({ ok: false, kind: 'refused', detail: 'Denied?' }), NO_REOPEN + ' Windows did not allow it: Denied? ' + RETRY);
});

test('kosmos#7504: the engine\'s own sentence is never on the page, whatever the kind', async () => {
  for (const kind of ['refused', 'not-yet', 'no-time', 'unknown', 'other', undefined]) {
    const said = await saidFor({ ok: false, kind, because: 'ENGINE WORDS job board register', detail: 'Access is denied.' });
    assert.ok(said && !/ENGINE WORDS|job|board|register/.test(said), kind + ': ' + said);
  }
});

test('kosmos#7504 CONTROL: a watchdog registered or present, or no watchdog field (switched off, an older engine), says nothing', async () => {
  for (const watchdog of [{ ok: true, action: 'registered' }, { ok: true, action: 'present' }, undefined, null]) {
    const body = { ok: true, on: true, ...(watchdog === undefined ? {} : { watchdog }) };
    const rig = clickRig({ clickedFrom: 'false', post: { status: 200, body }, machine: ON_ROWS });
    await rig.fns.startAtSignInClick(rig.sw);
    assert.equal(rig.msg.hidden, true, 'said something for ' + JSON.stringify(watchdog) + ': ' + rig.msg.textContent);
  }
});

test('kosmos#7504: a refusal still wins over the watchdog line, and the keep-awake switch never reads a watchdog', async () => {
  const refused = clickRig({ clickedFrom: 'false', post: { status: 409, body: { error: 'Windows said no', watchdog: { ok: false, kind: 'refused' } } }, machine: ON_ROWS });
  await refused.fns.startAtSignInClick(refused.sw);
  assert.equal(refused.msg.textContent, 'Windows said no');
  const awake = clickRig({ clickedFrom: 'false', post: { status: 200, body: { ok: true, on: true, watchdog: { ok: false, kind: 'refused' } } }, machine: ON_ROWS });
  await awake.fns.keepAwakeClick(awake.sw);
  assert.equal(awake.msg.hidden, true, 'keep-awake said a watchdog line');
});
