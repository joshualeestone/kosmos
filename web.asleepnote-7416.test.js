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
const { scriptOf, liftAll } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = liftAll(SCRIPT, ['lastHeardSentence', 'paintOfflineNote']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(extra = {}) {
  const slot = { dataset: {}, innerHTML: '' };
  const ctx = vm.createContext({
    Date, Number, String, esc,
    document: { getElementById: (id) => (id === 'uoffline-slot' ? slot : null) },
    location: { host: 'studio.kosmosplus.com' },
    offlineRemoteView: () => true, onCloudMachine: () => false, hostMachineCap: () => 'Your Mac',
    MAC_ASLEEP_SENTENCE: 'It may be asleep, off or offline. Wake it and make sure Kosmos is open on it.',
    CLOUD_ASLEEP_SENTENCE: 'It may be restarting, and this page asks again by itself.',
    ENGINE_RESTARTING: false,
    ...extra,
  });
  vm.runInContext(SRC + '\nthis.heard = lastHeardSentence; this.paint = paintOfflineNote;', ctx);
  return { ctx, slot };
}
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();   // local time, October 2026 (the 27th is a Tuesday)
const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

test('#7416: "we last heard from it" says the time today, "yesterday", the weekday within a week, the date before', () => {
  const { ctx } = page();
  const now = at(27, 22, 0);
  assert.equal(ctx.heard(at(27, 20, 12), now), 'We last heard from it at ' + clock(at(27, 20, 12)) + '.');
  assert.equal(ctx.heard(at(26, 20, 12), now), 'We last heard from it yesterday at ' + clock(at(26, 20, 12)) + '.');
  const tue = new Date(at(21, 20, 12)).toLocaleDateString(undefined, { weekday: 'long' });
  assert.equal(ctx.heard(at(21, 20, 12), now), 'We last heard from it on ' + tue + ' at ' + clock(at(21, 20, 12)) + '.');
  const date = new Date(at(20, 20, 12)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert.equal(ctx.heard(at(20, 20, 12), now), 'We last heard from it on ' + date + '.');
  // Calendar days, not 24-hour spans: 11 PM yesterday read at 1 AM is "yesterday", not "at 11 PM".
  assert.match(ctx.heard(at(26, 23, 0), at(27, 1, 0)), /^We last heard from it yesterday at /);
  // Nothing that is not a real past time.
  assert.equal(ctx.heard(NaN, now), '');
  assert.equal(ctx.heard(now + 10 * 60 * 1000, now), '');
});

test('#7416: the note names the computer, says it is not answering, and when it was last heard from', () => {
  const { ctx, slot } = page({ THIS_COMPUTER_NAME: 'Studio', LAST_STATUS_OK_AT: Date.now() - 60 * 1000 });
  ctx.paint(true, false);
  assert.match(slot.innerHTML, /<b>Studio isn't answering<\/b>/);
  assert.match(slot.innerHTML, /<small>It may be asleep, off or offline\. We last heard from it at [^<]+\. Wake it/);
  assert.match(slot.innerHTML, /Nothing answered at studio\.kosmosplus\.com\./, 'the rest of the remote sentence stays');
  assert.doesNotMatch(slot.innerHTML, /is asleep/, 'it never claims the computer is asleep');
});

test('#7416: with no name from Kosmos+ it says the generic one, and a name is escaped', () => {
  const plain = page({ THIS_COMPUTER_NAME: '', LAST_STATUS_OK_AT: Date.now() });
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
  const { ctx, slot } = page({ onCloudMachine: () => true, THIS_COMPUTER_NAME: 'cloud-ab12', LAST_STATUS_OK_AT: Date.now() });
  ctx.paint(true, false);
  assert.match(slot.innerHTML, /<small>It may be restarting, and this page asks again by itself\. We last heard from it at /);
});
