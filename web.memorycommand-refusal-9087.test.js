'use strict';

/**
 * kosmos#9087: the board's compact and clear buttons (memoryCommand) said "Asked it to compact." for a refusal that
 * carries no delivery: the old 404 "no agent by that name", and now the 409 "unreadable" a roster outage answers. The
 * real function is lifted from the page and run against each answer.
 *
 *   node --test web.memorycommand-refusal-9087.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');
const os = require('node:os');
// The fixture's snapshot() reads the data folder: a throwaway one, set before fleet (and the engine) load.
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memcmd-9087-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const fleet = require('./test-support/fleet');

// The agent the dialog is open on: a real board card (fixture-discipline: never a hand-built one).
const CARD = fleet.install([fleet.agent('raph')]).agents.find((c) => c.sessionName === 'raph');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = page.lift(SCRIPT, 'memoryCommand');
const AS_SENTENCE = page.lift(SCRIPT, 'asSentence');   // the page's one sentence-dresser, which memoryCommand calls

async function press(status, body) {
  assert.ok(CARD, 'the fixture produced no card for raph');
  const msg = { textContent: '' };
  const said = [];
  const document = { getElementById: (id) => (id === 'd-compact-msg' ? msg : null) };
  const fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const run = new Function('document', 'fetch', 'CURRENT', AS_SENTENCE + '\nreturn (' + SRC + ');')(document, fetch, CARD);
  await run('compact', (s, ok) => said.push({ s, ok }));
  return { text: msg.textContent, said };
}

test('#9087 a 409 unreadable is shown as the route\'s words and as not done, never "Asked it to compact."', async () => {
  const r = await press(409, { error: 'we could not check which agents are running, so nothing was sent. Try again in a moment.', because: 'unreadable', retry: true });
  assert.match(r.text, /^We could not check which agents are running/);
  assert.doesNotMatch(r.text, /Asked it to/);
  assert.equal(r.said[0].ok, false);
});

test('#9087 a 404 "no agent by that name" is shown as a refusal too', async () => {
  const r = await press(404, { error: 'no agent by that name' });
  assert.equal(r.text, 'No agent by that name.');
  assert.equal(r.said[0].ok, false);
});

test('#9087 CONTROL: a placed delivery still reads "Asked it to compact."', async () => {
  const r = await press(200, { command: 'compact', delivery: { state: 'placed', paneNote: 'It is between tasks.' } });
  assert.equal(r.text, 'Asked it to compact. It is between tasks.');
  assert.equal(r.said[0].ok, true);
});

test('#9087 CONTROL: a could_not delivery keeps its own reason', async () => {
  const r = await press(409, { command: 'compact', delivery: { state: 'could_not', because: 'its window is scrolled back' } });
  assert.equal(r.text, 'its window is scrolled back');
  assert.equal(r.said[0].ok, false);
});

const ASK = page.lift(SCRIPT, 'handoffAskRefusal');
const askRefusal = new Function('return (' + ASK + ');')();

test('#9087 the handoff dialog: a 409 unreadable says the agents could not be checked, never "not running", and offers no restart', () => {
  const t = askRefusal(409, { error: 'x', because: 'unreadable', retry: true }, 'Raph', '');
  assert.match(t, /could not check which agents are running/);
  assert.doesNotMatch(t, /not running/);
  assert.doesNotMatch(t, /Restart/);
});

test('#9087 CONTROL: the handoff dialog: a 409 with no delivery and no reason is still "not running"', () => {
  assert.match(askRefusal(409, { error: 'this agent is not running, so there is no session to write a handoff' }, 'Raph', ''), /^Raph is not running/);
});

test('#9087 CONTROL: the handoff dialog: a could_not delivery keeps the generic line with its reason', () => {
  const t = askRefusal(409, { delivery: { state: 'could_not', because: 'busy' } }, 'Raph', ' (busy)');
  assert.equal(t, 'We could not ask Raph to write a handoff (busy). You can Restart without one, or leave it running.');
});
