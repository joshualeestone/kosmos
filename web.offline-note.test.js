'use strict';

/**
 * What Kosmos says when nothing is answering at all (#269, Mona Lisa).
 *
 * 🛑 BAKING THE VERSION FIXED THE FACT AND NOT THE DEAD END. Josh's screen on
 * 2026-08-22 had five panels all correctly refusing and nothing anywhere to say
 * whether the app was broken, the machine had been asleep, or he should wait.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function slotAfter(calls, { baked = '0.2.87', host = '127.0.0.1:16180' } = {}) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'uoffline-slot' ? slot : null),
    querySelector: () => (baked === undefined ? null : { getAttribute: () => baked }),
  };
  const fn = new Function('document', 'esc', 'location',
    `${page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS)}\n${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    doc, (x) => String(x == null ? '' : x), host === null ? null : { host },
  );
  for (const down of calls) fn(down);
  return slot;
}

test('a poll that came back failing says so, with what it can still know', () => {
  const slot = slotAfter([true]);
  assert.match(slot.innerHTML, /Kosmos is not answering on this computer/);
  /* Both details survive a dead server: the version is baked into this page and
     the host is what the page was loaded from. */
  assert.match(slot.innerHTML, /Version 0\.2\.87 is loaded\./);
  assert.match(slot.innerHTML, /Nothing answered at 127\.0\.0\.1:16180\./);
});

test('it names no cause, because every cause produces the same failed fetch', () => {
  /* 🔑 A STOPPED SERVER, A CHANGED PORT, A FIREWALL AND A MACHINE THAT HAS JUST
     WOKEN are indistinguishable from here. If one of these words ever appears
     it is because somebody decided the page can tell, and that decision should
     be visible rather than arriving inside a copy tweak. */
  const said = slotAfter([true]).innerHTML.toLowerCase();
  for (const word of ['server', 'crashed', 'stopped', 'offline', 'restart', 'down', 'firewall', 'quit']) {
    assert.ok(!said.includes(word), `the note names a cause it cannot know: ${word}`);
  }
  /* ⚠️ And "not answering" rather than "not running": not running is a cause,
     not answering is what was observed. */
  assert.ok(!/not running/.test(said));
});

test('it is absent while the first poll is merely in flight', () => {
  /* 🛑 THE ARM WORTH WRITING, and the one most likely to be got wrong: on a slow
     machine the in-flight state and the failed state look identical to whoever
     is writing the code. A test that only asserts the note appears on rejection
     passes on a build that shows it immediately, which is the actual bug.

     Held open here by driving `tick` with a fetch that never settles, so the
     assertion is about the real caller rather than about my own restraint. */
  const slot = { dataset: {}, innerHTML: '' };
  const painted = [];
  let asked = 0;
  new Function('paintOfflineNote', 'fetch', 'document', 'INSTR_EPOCH', 'setNavBadge',
    `${page.lift(SCRIPT, 'tick')}\ntick();`)(
    (down) => painted.push(down),
    () => { asked += 1; return new Promise(() => {}); },
    { getElementById: () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: false, closest: () => null }) },
    0,
    () => {},
  );
  /* ⚠️ THE POSITIVE CONTROL FIRST. An empty `painted` also describes a `tick`
     that threw on line one, which would make this assertion pass for a reason
     that has nothing to do with the rule. */
  assert.equal(asked, 1, 'tick never reached the fetch, so its restraint proves nothing');
  assert.deepEqual(painted, [], 'something drew the note before any poll had answered');
  assert.equal(slot.innerHTML, '');
});

test('a server that ANSWERED with a refusal is not "not answering": the note paints only when nothing answered (#268)', async () => {
  /**
   * The two failures a person could not tell apart: the whole of Kosmos absent
   * (the fetch never got an answer) and one subsystem unreadable (Kosmos
   * answered 500 with tmux's words). The first is said once at the top; the
   * second belongs to the board's own box with the engine's sentence, and
   * painting "not answering" over it is the screen contradicting itself.
   * Driven through the real `tick`, both ways, with the rest of the paint
   * swallowed by a document that answers every id with a stub.
   */
  const drive = async (fetchImpl) => {
    const painted = [];
    const stub = () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: true, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
    // The catch branch repaints the board's failure state; everything it
    // touches beyond the note is a stub, so the only thing measured here is
    // the one call this test is about.
    await new Function('paintOfflineNote', 'fetch', 'document', 'INSTR_EPOCH', 'boardEmpty', 'paintAddAgents', 'ORG_HTML', 'BOARD_LOOK_FAILED', 'BOARD_NEEDS_SIGNIN', 'BOARD_SIGNED_OUT', 'BOARD_DEVICE_OFFLINE', 'setNavBadge', 'ringNewAgentMessages', 'setAgentsGrouped', 'orgBoxPlain',
      `${page.lift(SCRIPT, 'relaySignedOut')}\n${page.lift(SCRIPT, 'kplusRemote')}\n${page.lift(SCRIPT, 'deviceOffline')}\n${page.lift(SCRIPT, 'tick')}\nreturn tick();`)(
      (down) => painted.push(down),
      fetchImpl,
      { getElementById: stub, querySelector: () => null, querySelectorAll: () => [] },
      0, () => '', () => {}, null, null, false, false, false, () => {}, () => {}, () => {}, () => {}, // #3301: ringNewAgentMessages / #3387: setAgentsGrouped / #718: orgBoxPlain no-ops (tick calls them; not under test here)
    );
    return painted;
  };
  // Nothing answered: the fetch itself failed.
  const absent = await drive(() => Promise.reject(new TypeError('Failed to fetch')));
  assert.deepEqual(absent, [true], 'a failed fetch did not paint the note');
  // Kosmos answered, in words, with a refusal.
  const refused = await drive(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'we could not make sense of what came back', detail: 'tmux said no' }) }));
  assert.deepEqual(refused, [false], 'a server that answered was reported as not answering');
});

test('#2023: BOARD_NEEDS_SIGNIN does not latch -- a non-403 outcome after a 403 clears it', async () => {
  /* 🛑 THE ANTI-LATCH GUARD. The fix (tick sets the flag from res.status===403 on
     an answered failure, and clears it in the catch when NOTHING answered) had no
     executable guard: a mutation deleting `if (!answered) BOARD_NEEDS_SIGNIN =
     false`, or changing the answered set to always-true, left every suite green.
     This drives the REAL tick through 403 -> 500 -> 403 -> network-throw and
     asserts the flag tracks each, so "not signed in" can never sit over "not
     answering" (the #268 self-contradiction) or over a genuine 500.
     BOARD_NEEDS_SIGNIN is deliberately NOT injected as a param, so tick's writes
     land on globalThis where this test reads them; the sandboxed new Function
     body is non-strict, so a bare assignment creates the global. */
  const stub = () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: true, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
  let fetchImpl;
  const tick = new Function('paintOfflineNote', 'fetch', 'document', 'INSTR_EPOCH', 'boardEmpty', 'paintAddAgents', 'ORG_HTML', 'BOARD_LOOK_FAILED', 'SIGNIN_SENTENCE', 'ORG_SIGNED_OUT_SENTENCE', 'DEVICE_SIGNIN_BUTTON', 'esc', 'setNavBadge', 'ringNewAgentMessages', 'setAgentsGrouped', 'orgBoxPlain',
    `${page.lift(SCRIPT, 'relaySignedOut')}\n${page.lift(SCRIPT, 'kplusRemote')}\n${page.lift(SCRIPT, 'deviceOffline')}\n${page.lift(SCRIPT, 'tick')}\nreturn tick;`)(
    () => {}, (...a) => fetchImpl(...a), { getElementById: stub, querySelector: () => null, querySelectorAll: () => [] }, 0, () => '', () => {}, null, null, page.liftConst(SCRIPT, 'SIGNIN_SENTENCE'), page.liftConst(SCRIPT, 'ORG_SIGNED_OUT_SENTENCE'), new Function(page.liftConst(SCRIPT, 'DEVICE_SIGNIN_BUTTON') + '\nreturn DEVICE_SIGNIN_BUTTON;')(), (x) => String(x), () => {}, () => {}, () => {}, () => {}, // #3301: ringNewAgentMessages / #3387: setAgentsGrouped / #718: orgBoxPlain no-ops (tick calls them; not under test here)
  );
  delete globalThis.BOARD_NEEDS_SIGNIN;
  delete globalThis.BOARD_SIGNED_OUT;
  const status403 = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'this board belongs to the account that started it' }) });
  const status500 = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'we could not read tmux' }) });
  const throws = () => Promise.reject(new TypeError('Failed to fetch'));
  fetchImpl = status403; await tick();
  assert.equal(globalThis.BOARD_NEEDS_SIGNIN, true, 'a 403 did not set the not-signed-in flag');
  fetchImpl = status500; await tick();
  assert.equal(globalThis.BOARD_NEEDS_SIGNIN, false, 'a genuine 500 after a 403 left the flag true -- res.status===403 not honoured on the answered path');
  fetchImpl = status403; await tick();
  assert.equal(globalThis.BOARD_NEEDS_SIGNIN, true, 'a second 403 did not re-set the flag');
  fetchImpl = throws; await tick();
  assert.equal(globalThis.BOARD_NEEDS_SIGNIN, false, 'the flag stuck TRUE across a genuine outage -- the latch #2023/#268 forbid (signin over not-answering)');
  /* #718 state 3: the relay's signed-out flag, through the same real tick, the same way:
     401 signed_out -> 500 -> 401 signed_out -> network throw. A sticky true would draw
     "Sign in again" over "not answering". */
  const relay401 = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ signed_out: true, error: 'this device is not signed in to this Mac' }) });
  fetchImpl = relay401; await tick();
  assert.equal(globalThis.BOARD_SIGNED_OUT, true, "the relay's signed-out 401 did not set the flag");
  assert.equal(globalThis.BOARD_NEEDS_SIGNIN, false, 'a 401 set the board-token (403) flag');
  fetchImpl = status500; await tick();
  assert.equal(globalThis.BOARD_SIGNED_OUT, false, 'a genuine 500 after the relay 401 left the signed-out flag true');
  fetchImpl = relay401; await tick();
  assert.equal(globalThis.BOARD_SIGNED_OUT, true, 'a second relay 401 did not re-set the flag');
  fetchImpl = throws; await tick();
  assert.equal(globalThis.BOARD_SIGNED_OUT, false, 'the signed-out flag stuck TRUE across a genuine outage (sign-in over not-answering)');
  delete globalThis.BOARD_NEEDS_SIGNIN;
  delete globalThis.BOARD_SIGNED_OUT;
});

test("#718 state 3: only the relay's explicit signed_out:true counts as signed out", () => {
  const relaySignedOut = new Function(`${page.lift(SCRIPT, 'relaySignedOut')}\nreturn relaySignedOut;`)();
  assert.equal(relaySignedOut(401, { signed_out: true }), true);
  assert.equal(relaySignedOut(401, { error: 'unauthorized' }), false, 'a bare 401 is not proof that signing in fixes it');
  assert.equal(relaySignedOut(401, { signed_out: 'true' }), false, 'a string is not the relay field');
  assert.equal(relaySignedOut(401, null), false, 'an unparseable body is not signed out');
  assert.equal(relaySignedOut(403, { signed_out: true }), false, 'the board-token 403 has its own state');
});

function deviceSlotAfter(calls) {
  /* calls: [down, deviceIsOffline] pairs, driven through the real paintOfflineNote. */
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'uoffline-slot' ? slot : null),
    querySelector: () => ({ getAttribute: () => '0.2.87' }),
  };
  const fn = new Function('document', 'esc', 'location',
    `${page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS)}\n${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    doc, (x) => String(x == null ? '' : x), { host: 'mac.kosmosplus.com' },
  );
  for (const [down, off] of calls) fn(down, off);
  return slot;
}

test('#718 state 1: an offline phone is told it is offline, not that the Mac is not answering', () => {
  const said = deviceSlotAfter([[true, true]]).innerHTML;
  assert.match(said, /You are offline/);
  assert.match(said, /This phone or computer is not connected to the internet, so it cannot reach your Mac\./);
  assert.ok(!/not answering|on this computer|Applications folder|Nothing answered at/.test(said), 'the offline note blamed the Mac or gave a desktop remedy');
  assert.ok(!/<button/.test(said), 'the note grew a control; the board card carries Try again');
});

test('#718 state 1: a change of which end is offline repaints the note, and recovery clears it', () => {
  const slot = deviceSlotAfter([[true, true], [true, false]]);
  assert.match(slot.innerHTML, /Kosmos is not answering on this computer/, 'back online but the Mac silent still said the phone was offline');
  assert.match(deviceSlotAfter([[true, false], [true, true]]).innerHTML, /You are offline/, 'the Mac note stuck after the phone went offline');
  assert.equal(deviceSlotAfter([[true, true], [false, false]]).innerHTML, '');
  // Unchanged, it is not re-announced.
  const held = deviceSlotAfter([[true, true]]);
  held.innerHTML = 'MARKED';
  const again = new Function('document', 'esc', 'location',
    `${page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS)}\n${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    { getElementById: () => held, querySelector: () => null }, (x) => String(x), { host: 'h' });
  again(true, true);
  assert.equal(held.innerHTML, 'MARKED', 'the offline note rewrote itself over an unchanged state');
});

test('#718 state 1: only a Kosmos+ view with the browser saying offline counts as the device offline', () => {
  const deviceOffline = (hostname, onLine) => new Function('location', 'navigator',
    `${page.lift(SCRIPT, 'kplusRemote')}\n${page.lift(SCRIPT, 'deviceOffline')}\nreturn deviceOffline();`)({ hostname }, { onLine });
  assert.equal(deviceOffline('mac.kosmosplus.com', false), true);
  assert.equal(deviceOffline('mac.kosmosplus.com', true), false, 'onLine true proves nothing, so it must not claim offline');
  assert.equal(deviceOffline('mac.kosmosplus.com', undefined), false, 'a browser that does not say is not offline');
  // On the Mac itself the board is loopback, which works with no network: a failure there is Kosmos.
  assert.equal(deviceOffline('127.0.0.1', false), false);
  assert.equal(deviceOffline('localhost', false), false);
});

test('#718 state 1: tick sets the offline flag only when nothing answered, and it does not latch', async () => {
  const stub = () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: true, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
  let fetchImpl;
  const painted = [];
  const nav = { onLine: false };
  const tick = new Function('paintOfflineNote', 'fetch', 'document', 'INSTR_EPOCH', 'boardEmpty', 'paintAddAgents', 'ORG_HTML', 'BOARD_LOOK_FAILED', 'SIGNIN_SENTENCE', 'ORG_SIGNED_OUT_SENTENCE', 'OFFLINE_SENTENCE', 'esc', 'setNavBadge', 'ringNewAgentMessages', 'setAgentsGrouped', 'orgBoxPlain', 'location', 'navigator',
    `${page.lift(SCRIPT, 'relaySignedOut')}\n${page.lift(SCRIPT, 'kplusRemote')}\n${page.lift(SCRIPT, 'deviceOffline')}\n${page.lift(SCRIPT, 'tick')}\nreturn tick;`)(
    (down, off) => painted.push([down, off]), (...a) => fetchImpl(...a), { getElementById: stub, querySelector: () => null, querySelectorAll: () => [] }, 0, () => '', () => {}, null, null,
    page.liftConst(SCRIPT, 'SIGNIN_SENTENCE'), page.liftConst(SCRIPT, 'ORG_SIGNED_OUT_SENTENCE'), page.liftConst(SCRIPT, 'OFFLINE_SENTENCE'), (x) => String(x), () => {}, () => {}, () => {}, () => {},
    { hostname: 'mac.kosmosplus.com', search: '' }, nav,
  );
  delete globalThis.BOARD_DEVICE_OFFLINE;
  const reject = () => Promise.reject(new TypeError('Load failed'));
  const refuse = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'bad gateway' }) });
  fetchImpl = reject; nav.onLine = false; await tick();
  assert.equal(globalThis.BOARD_DEVICE_OFFLINE, true, 'no answer while the browser says offline did not set the flag');
  assert.deepEqual(painted.pop(), [true, true], 'the note was not told the device is offline');
  fetchImpl = reject; nav.onLine = true; await tick();
  assert.equal(globalThis.BOARD_DEVICE_OFFLINE, false, 'back online with the Mac silent still claimed the phone was offline');
  assert.deepEqual(painted.pop(), [true, false]);
  fetchImpl = refuse; nav.onLine = false; await tick();
  assert.equal(globalThis.BOARD_DEVICE_OFFLINE, false, 'something ANSWERED, so the device is not offline, whatever onLine says');
  delete globalThis.BOARD_DEVICE_OFFLINE;
  delete globalThis.BOARD_NEEDS_SIGNIN;
  delete globalThis.BOARD_SIGNED_OUT;
});

test('a poll that works clears it in the same paint', () => {
  /* ⚠️ A STALE FAILURE NOTICE OVER A WORKING BOARD is this note inverted: the
     board says everything is fine and the chrome says nothing is answering, and
     a person believes the alarming half. */
  const slot = slotAfter([true, false]);
  assert.equal(slot.innerHTML, '');
});

test('a second outage draws it again', () => {
  /* 🛑 THE FLAG THAT STOPS IT RE-ANNOUNCING EVERY FIVE SECONDS becomes a trap if
     a recovery does not clear it: the note would be permanently silent from the
     second outage on. The removed-list cache shipped exactly this bug. */
  const slot = slotAfter([true, false, true]);
  assert.match(slot.innerHTML, /not answering/);
});

test('it does not re-announce itself on every poll while the condition holds', () => {
  const slot = slotAfter([true]);
  const first = slot.innerHTML;
  slot.innerHTML = 'MARKED';
  slotAfterAgain(slot);
  assert.equal(slot.innerHTML, 'MARKED', 'the note rewrote itself over an unchanged state');
  assert.ok(first.length > 0);
});
function slotAfterAgain(slot) {
  const doc = { getElementById: () => slot, querySelector: () => ({ getAttribute: () => '0.2.87' }) };
  new Function('document', 'esc', 'location',
    `${page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS)}\n${page.lift(SCRIPT, 'bakedVersion')}\n${page.lift(SCRIPT, 'paintOfflineNote')}\nreturn paintOfflineNote;`)(
    doc, (x) => String(x), { host: 'h' },
  )(true);
}

test('it offers nothing to press', () => {
  /* The board already carries Try again and now says when it is looking, so a
     second retry here is two controls doing one job; a dismiss on a live
     condition is a note that lies on the next glance; and a countdown would
     imply the page knows something about the recovery. */
  const said = slotAfter([true]).innerHTML;
  assert.ok(!/<button/.test(said));
  assert.ok(!/Later|Dismiss|Retry|Try again/i.test(said));
});

test('a page with no version or no host still says the part it holds', () => {
  /* ⚠️ THE FAILURE DIRECTION. This runs when things are already wrong, so the
     path where a detail is unavailable is ordinary rather than exotic, and the
     primary sentence must never depend on one. */
  assert.match(slotAfter([true], { baked: '__KOSMOS_VERSION__' }).innerHTML, /not answering on this computer/);
  assert.ok(!/Version/.test(slotAfter([true], { baked: '__KOSMOS_VERSION__' }).innerHTML));
  assert.match(slotAfter([true], { host: null }).innerHTML, /not answering on this computer/);
});

test('it has its own slot, so it cannot overwrite the update chip', () => {
  /* Both can be true at once, and in that order: a person who updates and then loses the server.
     #3955: the post-update note is now the "Kosmos has been updated" window, so the chip's slot
     (#utoast-slot) is the one this must not share. */
  assert.match(PAGE, /<div id="uoffline-slot"><\/div>/);
  assert.ok(PAGE.indexOf('id="utoast-slot"') < PAGE.indexOf('id="uoffline-slot"'));
  assert.match(PAGE, /#uoffline-slot:empty \{ display: none; \}|#uoffline-slot:empty/);
});

test('nothing outside the poll ever paints it', () => {
  /* 🛑 THE OTHER WAY TO BREAK THE IN-FLIGHT RULE, and the test above cannot see
     it: that one drives `tick` in isolation, so a call added to the page's BOOT
     sequence paints the note on every load and every assertion still passes.
     Measured by adding exactly that and watching all nine stay green.

     🔑 So the claim is about WHERE the calls are, not about what one call does.
     Both live inside `tick`: one on the success path, one in the catch. A third
     anywhere else is a decision to draw this without a failed poll behind it. */
  const body = page.lift(SCRIPT, 'tick');
  const inTick = (body.match(/paintOfflineNote\(/g) || []).length;
  const inPage = (SCRIPT.match(/paintOfflineNote\(/g) || []).length;
  assert.equal(inTick, 2, 'the poll no longer both draws and clears the note');
  assert.equal(inPage - 1, inTick,
    'something outside the poll calls it, so the note can appear with no failed poll behind it');
});
