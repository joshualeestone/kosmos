'use strict';
/**
 * kosmos#7416: when the computer running the agents stops answering, a phone or another computer seeing the board
 * through Kosmos+ says so with the computer's own name and when this page last heard from it, in Mona Lisa's words:
 * "Studio isn't answering. It may be asleep, off or offline. We last heard from it at 8:12 PM." The page's own
 * lastHeardSentence and paintOfflineNote run here; the rest of the page is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll, liftConst } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = [liftConst(SCRIPT, 'HEARD_GAP_MS'), liftAll(SCRIPT, ['lastHeardSentence', 'lastHeardTrusted', 'paintOfflineNote'])].join('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A clock the test sets: Date.now() inside the page reads `clock.now`, so nothing depends on when the test runs. */
function fixedDate(clock) {
  return class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } };
}
function page(extra = {}, clock = { now: new Date(2026, 9, 27, 22, 0).getTime() }) {
  const slot = { dataset: {}, innerHTML: '' };
  const ctx = vm.createContext({
    Date: fixedDate(clock), Number, String, esc,
    document: { getElementById: (id) => (id === 'uoffline-slot' ? slot : null) },
    location: { host: 'studio.kosmosplus.com' },
    offlineRemoteView: () => true, onCloudMachine: () => false, hostMachineCap: () => 'Your Mac',
    // The page's own sentence, so the splice is tested on the words that ship (review 1).
    MAC_ASLEEP_SENTENCE: vm.runInNewContext(liftConst(SCRIPT, 'MAC_ASLEEP_SENTENCE') + '; MAC_ASLEEP_SENTENCE', { onLinux: () => false }),
    CLOUD_ASLEEP_SENTENCE: 'It may be restarting, and this page asks again by itself.',
    ENGINE_RESTARTING: false,
    STATUS_FIRST_MISS_AT: null,
    ...extra,
  });
  vm.runInContext(SRC + '\nthis.heard = lastHeardSentence; this.paint = paintOfflineNote;', ctx);
  return { ctx, slot, clock };
}
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();   // local time, October 2026 (the 27th is a Tuesday)
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('#7416: "we last heard from it" says the time today, "yesterday", the weekday within a week, the date before', () => {
  const { ctx } = page();
  const now = at(27, 22, 0);
  assert.equal(ctx.heard(at(27, 20, 12), now), 'We last heard from it at ' + clock(at(27, 20, 12)) + '.');
  assert.equal(ctx.heard(at(26, 20, 12), now), 'We last heard from it yesterday at ' + clock(at(26, 20, 12)) + '.');
  const weekday = new Date(at(21, 20, 12)).toLocaleDateString([], { weekday: 'long' });   // Oct 21 2026 is a Wednesday
  assert.equal(ctx.heard(at(21, 20, 12), now), 'We last heard from it on ' + weekday + ' at ' + clock(at(21, 20, 12)) + '.');
  const date = new Date(at(20, 20, 12)).toLocaleDateString([], { month: 'short', day: 'numeric' });
  assert.equal(ctx.heard(at(20, 20, 12), now), 'We last heard from it on ' + date + '.');
  // Calendar days, not 24-hour spans: 11 PM yesterday read at 1 AM is "yesterday", not "at 11 PM".
  assert.match(ctx.heard(at(26, 23, 0), at(27, 1, 0)), /^We last heard from it yesterday at /);
  // Nothing that is not a real past time.
  assert.equal(ctx.heard(NaN, now), '');
  assert.equal(ctx.heard(now + 10 * 60 * 1000, now), '');
  // A clock up to a minute ahead (another device's time) still reads as now.
  assert.equal(ctx.heard(now + 30 * 1000, now), 'We last heard from it at ' + clock(now + 30 * 1000) + '.');
});

test('#7416: the note names the computer, says it is not answering, and when it was last heard from', () => {
  const { ctx, slot } = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: at(27, 21, 59) });
  ctx.paint(true, false);
  assert.match(slot.innerHTML, /<b>Studio isn't answering<\/b>/);
  assert.match(slot.innerHTML, /<small>It may be asleep, off or offline\. We last heard from it at [^<]*?\. Wake it/);
  assert.match(slot.innerHTML, /If it is on, check this phone/, 'the body says "it", not a second machine, under a named title');
  assert.match(slot.innerHTML, /Nothing answered at studio\.kosmosplus\.com\./, 'the rest of the remote sentence stays');
  assert.doesNotMatch(slot.innerHTML, /\b(is|was|went)\b[^.]*\basleep/, 'it never claims the computer is asleep');
});

test('#7416: with no name from Kosmos+ it says the generic one, and a name is escaped', () => {
  const plain = page({ THIS_COMPUTER_NAME: '', LAST_STATUS_OK_AT: at(27, 21, 59) });
  plain.ctx.paint(true, false);
  assert.match(plain.slot.innerHTML, /<b>Your Mac isn't answering<\/b>/);
  const odd = page({ THIS_COMPUTER_NAME: '<b>Josh</b>' });
  odd.ctx.paint(true, false);
  assert.match(odd.slot.innerHTML, /<b>&lt;b&gt;Josh&lt;\/b&gt; isn't answering<\/b>/);
});

test('#7416: a page that never heard from the computer (opened while it was asleep) says no time, and nothing invented', () => {
  const { ctx, slot } = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: null });
  ctx.paint(true, false);
  assert.doesNotMatch(slot.innerHTML, /last heard/);
  assert.match(slot.innerHTML, /<small>It may be asleep, off or offline\. Wake it/);
});

test('#7416 review 3: the cloud machine\'s note is as main has it: seam H\'s title, no name, no time', () => {
  const { ctx, slot } = page({ onCloudMachine: () => true, THIS_COMPUTER_NAME: 'cloud-ab12', hostMachineCap: () => 'Your cloud machine', LAST_STATUS_OK_AT: at(27, 21, 59) });
  ctx.paint(true, false);
  assert.match(slot.innerHTML, /<b>Your cloud machine is not answering<\/b>/);
  assert.doesNotMatch(slot.innerHTML, /cloud-ab12/, 'a name the person never gave');
  assert.doesNotMatch(slot.innerHTML, /We last heard/, 'a time not in Mona Lisa\'s words for the cloud note');
  assert.match(slot.innerHTML, /<small>It may be restarting, and this page asks again by itself\.<\/small>/);
});

test('#7416 review 3: the time is said only when this page was still asking when the computer stopped answering', () => {
  // Polling every few seconds up to the outage: the first unanswered poll went out right after the last good one.
  const a = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: at(27, 20, 12), STATUS_FIRST_MISS_AT: at(27, 20, 12) + 5000 });
  a.ctx.paint(true, false);
  assert.match(a.slot.innerHTML, /We last heard from it at /, 'CONTROL: a page polling up to the outage says the time');
  // A tab put away at 9 PM and opened at 8 AM: its first unanswered poll is hours after the last answer it got, so the
  // computer may have answered all night. No time, rather than a wrong one.
  const b = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: at(27, 21, 0), STATUS_FIRST_MISS_AT: at(28, 8, 0) }, { now: at(28, 8, 0) });
  b.ctx.paint(true, false);
  assert.match(b.slot.innerHTML, /<b>Studio isn't answering<\/b>/);
  assert.doesNotMatch(b.slot.innerHTML, /We last heard/, 'a time from before this page went quiet');
  // A throttled hidden tab (about once a minute) still counts as asking.
  const c = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: at(27, 20, 12), STATUS_FIRST_MISS_AT: at(27, 20, 13) + 30000 });
  c.ctx.paint(true, false);
  assert.match(c.slot.innerHTML, /We last heard from it at /, 'a throttled tab asking once a minute lost its time');
});

test('#7416 review 1: a note left up overnight moves to "yesterday", and a name that arrives later is shown', () => {
  const h = page({ THIS_COMPUTER_NAME: '', LAST_STATUS_OK_AT: at(27, 23, 50) }, { now: at(27, 23, 55) });
  h.ctx.paint(true, false);
  assert.match(h.slot.innerHTML, /<b>Your Mac isn't answering<\/b>/);
  assert.match(h.slot.innerHTML, /We last heard from it at /);
  // The next poll, nothing changed: nothing is written (a write would re-announce the live region). Marked, so a
  // repaint of the same words shows (review 2: comparing the words could not fail).
  h.slot.innerHTML = 'MARKED';
  h.ctx.paint(true, false);
  assert.equal(h.slot.innerHTML, 'MARKED', 'an unchanged note was written again');
  h.clock.now = at(28, 8, 0);   // the morning
  h.ctx.paint(true, false);
  assert.match(h.slot.innerHTML, /We last heard from it yesterday at /, 'the time\'s words did not follow the day');
  h.slot.innerHTML = 'MARKED';
  h.ctx.paint(true, false);
  assert.equal(h.slot.innerHTML, 'MARKED', 'the new words were written again on the next poll');
  vm.runInContext('THIS_COMPUTER_NAME = "Studio"', h.ctx);   // Kosmos+ answered with the name
  h.ctx.paint(true, false);
  assert.match(h.slot.innerHTML, /<b>Studio isn't answering<\/b>/, 'a name that arrived later never showed');
});

test('#7416 review 2: the remote note paints again after a recovery and after the device was offline', () => {
  const remote = { v: true };
  const h = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: at(27, 21, 59), offlineRemoteView: () => remote.v,
    bakedVersion: () => '0.7.72', hostMachine: () => 'your Mac', onLinux: () => false, onWindows: () => false });
  const says = (want, label) => { assert.match(h.slot.innerHTML, want, label + ': ' + h.slot.innerHTML.slice(0, 160)); };
  h.ctx.paint(true, false); says(/Studio isn't answering/, 'the first outage');
  h.ctx.paint(false, false); assert.equal(h.slot.innerHTML, '', 'a recovery clears it');
  h.slot.innerHTML = 'MARKED';
  h.ctx.paint(true, false); says(/Studio isn't answering/, 'a second outage after the recovery');
  h.ctx.paint(true, true); says(/You are offline/, 'then this device went offline');
  h.ctx.paint(true, false); says(/Studio isn't answering/, 'and came back online with the computer still silent');
  // Not covered here: the remote view turning local (the local arm needs most of the page); its key is the plain
  // "which end" one the earlier offline-note tests already pin.
});

/* kosmos#7416 review 4: the page's real tick() decides STATUS_FIRST_MISS_AT, which decides whether the time is true.
   Driven here with the poll stubbed (each fetch waits until the test fails or refuses it) and a fixed clock. */
function tickWorld() {
  const clock = { now: 0 };
  const env = { offline: false, refuse: false, pending: [] };
  const D = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } };
  const el = () => ({ dataset: {}, innerHTML: '', className: '', textContent: '', hidden: true, closest: () => null, querySelector: () => null });
  const ctx = vm.createContext({
    Date: D, Math, Number, String, Error, Promise, clearTimeout() {}, setTimeout() {},
    fetch: () => (env.refuse
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'tmux could not be read' }) })
      : new Promise((res, rej) => env.pending.push(rej))),
    relaySignedOut: () => false, document: { getElementById: el }, INSTR_EPOCH: 0, setNavBadge() {},
    deviceOffline: () => env.offline, paintOfflineNote() {}, paintRestartScreen() {}, paintReconnecting() {},
  });
  vm.runInContext('var BOARD_LOOKED = true, BOARD_MISSES = 0, LAST_STATUS_OK_AT = null, STATUS_FIRST_MISS_AT = null, BOARD_LOOK_FAILED, BOARD_NEEDS_SIGNIN, BOARD_SIGNED_OUT, BOARD_DEVICE_OFFLINE, STATUS_POLL_FAILED;\n'
    + [liftConst(SCRIPT, 'HEARD_GAP_MS'), liftAll(SCRIPT, ['lastHeardTrusted', 'tick'])].join('\n'), ctx);
  const fail = async () => { const p = ctx.tick(); env.pending.shift()(new TypeError('Load failed')); await p.catch(() => {}); };
  const refuse = async () => { env.refuse = true; await ctx.tick().catch(() => {}); env.refuse = false; };
  return { ctx, clock, env, fail, refuse };
}
const at2 = (d, h, m, s = 0) => new Date(2026, 9, d, h, m, s).getTime();

test('#7416 review 4: tick() dates the first miss by when that poll went out, and a time is said for a page asking up to it', async () => {
  const w = tickWorld();
  w.ctx.LAST_STATUS_OK_AT = at2(27, 20, 12);
  w.clock.now = at2(27, 20, 12, 5); await w.fail();
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, at2(27, 20, 12, 5), 'the first miss is when that poll went out');
  w.clock.now = at2(27, 20, 12, 10); await w.fail();
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, at2(27, 20, 12, 5), 'a second miss does not move the first');
  assert.equal(w.ctx.lastHeardTrusted(), true, 'CONTROL: a page asking up to the outage says the time');
});

test('#7416 review 4: polls made while THIS device is offline are not the computer\'s misses', async () => {
  // Phone offline 8 PM to 8 AM (the computer fine), back online at 8 AM, the computer asleep since 2 AM.
  const w = tickWorld();
  w.ctx.LAST_STATUS_OK_AT = at2(27, 20, 0);
  w.clock.now = at2(27, 20, 0, 5); w.env.offline = true; await w.fail();
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, null, 'a miss while this device was offline was counted');
  w.clock.now = at2(28, 8, 0); w.env.offline = false; await w.fail();
  assert.equal(w.ctx.lastHeardTrusted(), false, 'said "yesterday at 8:00 PM" for a computer that answered until 2 AM');
});

test('#7416 review 4: a poll in flight across a sleep or a lock is dated by when it failed, not when it went out', async () => {
  const w = tickWorld();
  w.ctx.LAST_STATUS_OK_AT = at2(27, 21, 0);
  w.clock.now = at2(27, 21, 0, 5); const p = w.ctx.tick();   // out when the iPad locks
  w.clock.now = at2(28, 8, 0); w.env.pending.shift()(new TypeError('The network connection was lost.')); await p.catch(() => {});
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, at2(28, 8, 0), 'dated before the sleep');
  assert.equal(w.ctx.lastHeardTrusted(), false);
});

test('#7416 review 4: a refusal is an answer, so it clears a first miss', async () => {
  const w = tickWorld();
  w.ctx.LAST_STATUS_OK_AT = at2(27, 19, 59, 55);
  w.clock.now = at2(27, 20, 0); await w.fail();
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, at2(27, 20, 0), 'premise: one dropped poll');
  w.clock.now = at2(27, 20, 1); await w.refuse();
  assert.equal(w.ctx.STATUS_FIRST_MISS_AT, null, 'a refusal (the computer answered) left the old miss standing');
  // Refusals until 11 PM, then the computer goes down: the first miss is at 11 PM, hours after the last good answer.
  w.clock.now = at2(27, 23, 0, 5); await w.fail();
  assert.equal(w.ctx.lastHeardTrusted(), false, 'said "at 7:59 PM" for a computer answering until 11 PM');
});
