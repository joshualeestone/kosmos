'use strict';
/* kosmos#6774: the DM thread's words for a message kept while the agent's input box held text not yet sent, and no
 * Send now anyway on such a row (the same box would refuse it). dmHeldWords is lifted out of the page and run; the
 * button and the line under the box are read from their own functions, since dmRow needs most of the page to run.
 *   node --test web.inputkeep-6774.test.js */
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
{
  // The Send now anyway test installs a fleet card, so the agent roots are sandboxed (never this machine's agents).
  const os = require('node:os');
  const SANDBOX = require('node:fs').realpathSync(require('node:fs').mkdtempSync(require('node:path').join(os.tmpdir(), 'aw-webinputkeep-6774-')));
  for (const [k, n] of [['AGENT_WORKFORCE_HOME', 'home'], ['AGENT_WORKFORCE_DATA', 'data'], ['AGENT_WORKFORCE_WORKERS', 'workers'], ['AGENT_WORKFORCE_PROJECTS', 'projects'], ['AGENT_WORKFORCE_LAUNCH', 'launch']]) {
    process.env[k] = require('node:path').join(SANDBOX, n); require('node:fs').mkdirSync(process.env[k], { recursive: true });
  }
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = require('node:path').join(SANDBOX, 'claude.json');
  process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
  process.env.AGENT_WORKFORCE_DRY_RUN = '1';
}
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The page's own function, lifted out of index.html and run (not a copy of it). */
function lift(name, scope) {
  const m = PAGE.match(new RegExp('\\n(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  const keys = Object.keys(scope);
  return new Function(...keys, m[0] + '\nreturn ' + name + ';')(...keys.map((k) => scope[k]));
}
/* One function's source, from its line to the next top-level function. */
function body(name) {
  const at = PAGE.indexOf('\nfunction ' + name + '(');
  assert.ok(at > 0, 'CONTROL: ' + name + ' was not found in the page');
  return PAGE.slice(at, PAGE.indexOf('\nfunction ', at + 1) > 0 ? PAGE.indexOf('\nfunction ', at + 1) : undefined);
}

test('#6774: a row kept for the box says so, and one behind such messages says what it waits behind', () => {
  const words = lift('dmHeldWords', { quotaResetWords: undefined });
  // kosmos#7208: plain words, no "Held:".
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }), "Waiting to deliver: casey's message box has unsent text in it. Yours goes through as soon as that is cleared.");
  assert.equal(words('casey', { state: 'held', behind: true, behindFor: 'input' }), 'Queued behind earlier messages to casey.');
  // CONTROLS: the usage-limit words.
  assert.equal(words('casey', { state: 'held', behind: true }), 'Queued behind earlier messages to casey.');
  assert.equal(words('casey', { state: 'held', heldUntil: null }), 'casey is out of usage. This delivers when casey is back.');
  // kosmos#7208: the REAL reason wins: a box-held message to an agent out of usage, or not running, says that.
  // Review 1: the box still blocks it once casey is back, so the row does not promise more than that.
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }, { state: 'rate_limited' }), 'casey is out of usage. This delivers once casey is back and its message box is clear.');
  // Review 1: a queued row leads with the real reason too, and never claims the messages ahead are the person's.
  assert.equal(words('casey', { state: 'held', behind: true }, { state: 'rate_limited' }), 'casey is out of usage. This delivers after the messages ahead of it, when casey is back.');
  assert.equal(words('casey', { state: 'held', behind: true }, { running: false, state: 'stopped' }), 'casey is not running. This delivers after the messages ahead of it, when casey is running again.');
  // Review 1: a usage hold past its reset, casey running on the card: not "out of usage".
  assert.equal(words('casey', { state: 'held', heldUntil: new Date(Date.now() - 60e3).toISOString() }, { running: true, state: 'idle' }), 'casey is back. This goes through in a minute or so.');
  assert.match(words('casey', { state: 'held', heldUntil: new Date(Date.now() - 60e3).toISOString() }), /^casey is out of usage/, 'CONTROL: with no card, the hold says it');
  // Review 1: restarting is not "not running"; signed out on the card wins over the box and over a scraped limit.
  assert.match(words('casey', { state: 'held', heldFor: 'input' }, { running: false, state: 'restarting' }), /^Waiting to deliver/);
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }, { state: 'auth_failed' }), 'casey is signed out. This delivers once casey is signed in again.');
  assert.equal(words('casey', { state: 'held', heldFor: 'signin' }, { state: 'rate_limited' }), 'casey is signed out. This delivers once casey is signed in again.');
  // Review 1: a limit the card only read off the screen is said as the card says it, a guess.
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }, { state: 'rate_limited', stateConfidence: 'scraped' }), 'casey looks to be out of usage. This delivers once casey is back and its message box is clear.');
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }, { running: false, state: 'stopped' }), 'casey is not running. This delivers when casey is running again.');
  assert.match(words('casey', { state: 'held', heldFor: 'input' }, { running: true, state: 'idle' }), /^Waiting to deliver/, 'CONTROL: a running agent with room is the box');
  assert.ok(!/Held:/.test(words('casey', { state: 'held', heldFor: 'input' })), 'no "Held:" left');
});

test('#6774: Send now anyway is not offered on a row kept for the box, and the line under the box does not point at it', () => {
  const row = body('dmRow');
  const button = row.match(/m\.delivery && m\.delivery\.state === 'held' && typeof m\.at === 'string'([^?]*)\?\s*'<button type="button" class="dm-held-send"/);
  assert.ok(button, 'CONTROL: the Send now anyway button and its condition were not found in dmRow');
  assert.match(button[1], /m\.delivery\.heldFor !== 'input'/, 'the button is offered on a row kept for the box');
  assert.match(button[1], /m\.delivery\.behindFor !== 'input'/, 'the button is offered on a row kept behind messages kept for the box');
  // kosmos#7208: nothing is said under the box for a held message: the row says it once.
  // Anchored on the code, not its comment (review 1): the held arm clears the box and says nothing under it.
  const heldArm = PAGE.slice(PAGE.indexOf("if (d.state === 'held' && inThread) {"));
  assert.notEqual(PAGE.indexOf("if (d.state === 'held' && inThread) {"), -1, 'CONTROL: the held arm of sendTalk was not found');
  assert.match(heldArm.slice(0, 600), /clearSent\(\);\n\s+line = '';/, 'the held line under the box is not empty');
  assert.doesNotMatch(PAGE, /line = dmHeldWords\(/, 'a held message is still repeated under the box');
});

test('#6774: a re-send answered as the kept copy empties the box and is not worded as "could not get that to"', () => {
  const at = PAGE.indexOf('} else if (d.duplicateOf && inThread) {');
  assert.ok(at > 0, 'the page has no arm for a re-send answered as the kept copy');
  const arm = PAGE.slice(at, PAGE.indexOf('} else {', at));
  assert.match(arm, /clearSent\(\);/);
  assert.match(arm, /line = pjSentence\(d\.because\);/);
  assert.doesNotMatch(arm, /We could not get that to/);
  // It sits before the could-not arm, which would otherwise take it (and put the words back in the box).
  assert.ok(at < PAGE.indexOf("line = 'We could not get that to ' + name + ': '"), 'the could-not arm answers first');
});

test('#6774: Send now anyway refused because the box still holds text says so under the box; CONTROL: any other 409 repaints', async (t) => {
  const fleet = require('./test-support/fleet');
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);   // a real card (fixture discipline)
  t.after(() => board.restore());
  const card = board.agents.find((c) => c.sessionName === 'casey');
  assert.ok(card, 'CONTROL: the fleet card');
  const run = async (status, body) => {
    const under = { textContent: '' };
    let painted = 0;
    const send = lift('dmHeldSend', {
      CURRENT: card,
      fetch: async () => ({ ok: false, status, json: async () => body }),
      document: { getElementById: (id) => (id === 'd-say-msg' ? under : null) },
      paintTalk: async () => { painted += 1; },
    });
    const btn = { disabled: false, textContent: 'Send now anyway', dataset: { heldAt: 'x' } };
    await send(btn);
    return { under: under.textContent, painted, btn };
  };
  const held = await run(409, { inputHeld: true, error: 'its input box still holds text that has not been sent, so nothing was typed; it stays kept and Kosmos sends it later on its own' });
  assert.equal(held.painted, 0, 'repainted as if it had gone');
  assert.match(held.under, /^Not sent: its input box still holds text that has not been sent, so nothing was typed; it stays kept and Kosmos sends it later on its own\.$/);
  assert.equal(held.btn.disabled, false);
  const gone = await run(409, { error: 'that message is no longer held: it was sent or dropped, or is being sent now' });
  assert.equal(gone.painted, 1, 'CONTROL: a message sent or dropped meanwhile repaints');
});

test('#6774: a re-send row is drawn as not sent, not as "Could not deliver", on every reload', () => {
  const verdict = lift('pjVerdict', { pjWhenLive: () => '', esc: (x) => String(x), pjSentence: (x) => String(x), dmHeldWords: () => '' });
  const dup = verdict({ at: 'x', delivery: { state: 'could_not', duplicateOf: 'y', because: 'The same message was already kept above, to be sent once casey\'s input box was clear, so this copy was not sent' } }, 'casey');
  assert.equal(dup.mark, ' held');
  assert.doesNotMatch(dup.said, /Could not deliver/);
  assert.match(dup.said, /so this copy was not sent/);
  // CONTROL: a refusal that is not a re-send still reads as a failure.
  const fail = verdict({ at: 'x', delivery: { state: 'could_not', because: 'it is not running' } }, 'casey');
  assert.equal(fail.mark, ' failed');
  assert.match(fail.said, /^Could not deliver: /);
});
