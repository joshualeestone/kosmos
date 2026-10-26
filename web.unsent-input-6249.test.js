'use strict';
/* #6249: an agent whose input box has held unsent text for a few minutes says so on its card (engine
   status.unsentInputOf sets a.unsentInput.since). Lifts the page's own stateReason. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function src(name) {
  const m = PAGE.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  return m[0];
}
const stateReason = new Function(src('quotaResetWords') + src('waitingLine') + src('stateReason') + '\nreturn stateReason;')();

test('#6249: an idle card with text left in its box says so, with the minutes and what to do', () => {
  const since = new Date(Date.now() - 7 * 60e3).toISOString();
  assert.equal(stateReason({ state: 'idle', unsentInput: { since } }),
    'Text has been sitting unsent in its message box for about 7 minutes, and Kosmos\'s messages to it may wait behind it. Open it to send it with Enter.');
  assert.doesNotMatch(String(stateReason({ state: 'idle', unsentInput: null })), /input box/, 'CONTROL: nothing about the box when it is empty');
  assert.match(stateReason({ state: 'idle', unsentInput: { since: 'not a time' } }), /for about 3 minutes/, 'an unreadable time says the floor');
});

test('#6249: a crash loop still comes first, and the unsent line is said for an idle agent only', () => {
  const since = new Date(Date.now() - 5 * 60e3).toISOString();
  assert.match(stateReason({ state: 'idle', unsentInput: { since }, crashLoop: { looping: true, count: 4 } }), /^Kosmos has restarted it 4 times/);
  // Round 2: idle only; a limited agent keeps its own sentence.
  assert.equal(stateReason({ state: 'rate_limited', stateConfidence: 'scraped', unsentInput: { since } }), 'Looks like a usage limit');
});

test('#6249 round 5: a wake line held by text in the box says so, not that a Google quota is out', () => {
  const wakeHeldLine = new Function('quotaResetWords', src('wakeHeldLine') + '\nreturn wakeHeldLine;')(() => 'later');
  const said = wakeHeldLine('Kosmos restarted it.', { state: 'could_not', held: true, heldBy: 'input' });
  assert.equal(said, 'Kosmos restarted it. Its input box holds text that has not been sent, so Kosmos sent nothing; send or clear that in its window first.');
  assert.doesNotMatch(said, /quota/);
  assert.match(wakeHeldLine('x', { held: true, heldBy: 'menu' }), /waiting for an answer/, 'CONTROL: the menu hold keeps its words');
});

test('#6249 round 5: a person\'s room post refused by text in the box does not say the agent could not be reached', () => {
  const at = PAGE.indexOf("input box already holds text/.test(why)");
  assert.ok(at > 0, 'the room post sentence does not know the input-box refusal');
  const seg = PAGE.slice(at - 300, at + 300);
  assert.match(seg, /input box held text that had not been sent, so it was not told\./);
  // The pattern matches the engine's own sentences, so the branch is reachable from a real refusal.
  const engine = fs.readFileSync(nodePath.join(__dirname, 'engine', 'chat.js'), 'utf8');
  for (const said of ['its input box already holds text that was not sent']) {
    assert.ok(engine.includes(said), 'the engine no longer says: ' + said);
  }
});

test('#6249 round 5: every place that words a hold has words for the input hold (never the quota fallback)', () => {
  const read = (f) => fs.readFileSync(nodePath.join(__dirname, f), 'utf8');
  for (const f of ['engine/agentnudge.js', 'engine/firstreply-nudge.js', 'engine/replynudge.js']) {
    const t = read(f);
    assert.match(t, /heldBy === 'input' \? 'input-held'/, f + ': no act for the input hold');
    assert.match(t, /heldBy === 'input' \? '; held while its input box holds text not yet sent \(#6249\)'/, f + ': no words for it');
  }
  assert.match(read('engine/communityready.js'), /input: 'not sent: its input box held text that had not been sent'/);
  assert.match(read('server.js'), /delivery\.heldBy === 'input'[^\n]*\n\s*\? 'held: nothing was typed while its input box holds text not yet sent, so nothing was kept'/);
});
