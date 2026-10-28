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
const SRC = liftAll(SCRIPT, ['lastHeardSentence', 'paintOfflineNote']);
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
  assert.match(slot.innerHTML, /<small>It may be asleep, off or offline\. We last heard from it at [^.<]+\. Wake it/);
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

test('#7416: the cloud machine\'s note carries the time too, after its own first sentence', () => {
  const { ctx, slot } = page({ onCloudMachine: () => true, THIS_COMPUTER_NAME: 'cloud-ab12', LAST_STATUS_OK_AT: at(27, 21, 59) });
  ctx.paint(true, false);
  assert.match(slot.innerHTML, /<small>It may be restarting, and this page asks again by itself\. We last heard from it at /);
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
