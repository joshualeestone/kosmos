'use strict';

/**
 * #6173: Settings' Move sends ONE request and reads the move's record until it is done. This lifts the page's real
 * moveAccountAgents and drives it against stated answers (no board), so what is asserted is the note it writes:
 * every agent's outcome in today's words, and above all that an agent the board never confirmed is not said as moved,
 * including when the board restarted mid-move and no longer knows the move (404).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const SOURCE = page.lift(SCRIPT, 'moveAccountAgents');
const LAST = [{ sessionName: 's-al', name: 'Al' }, { sessionName: 's-bo', name: 'Bo' }, { sessionName: 's-cy', name: 'Cy' }];

/* The page's function, with fetch answered from `answers` (one per request, in order) and the 1 s pause between reads
   taken at once; the request limits (10 s and more) keep real timers, and are cleared when each request answers. */
function moveWith(answers) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
    const a = answers.shift();
    if (!a) throw new Error(`no answer scripted for ${url}`);
    if (a.abort) { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e; }
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  };
  const fastTimeout = (fn, ms) => setTimeout(fn, ms >= 10e3 ? ms : 0);
  // eslint-disable-next-line no-new-func
  const fn = new Function('fetch', 'LAST', 'setTimeout', `${SOURCE}\nreturn moveAccountAgents;`)(fetch, LAST, fastTimeout);
  return { fn, asked };
}
const agent = (name, outcome, because) => ({ name, outcome, ...(because ? { because } : {}) });

test('#6173: one request names every agent, and the note says each outcome as the board reported it', async () => {
  const { fn, asked } = moveWith([
    { status: 202, body: { id: 'm1', done: false, agents: [agent('s-al', 'pending'), agent('s-bo', 'pending'), agent('s-cy', 'refused', 'That account does not share this computer\'s memory.')] } },
    { status: 200, body: { id: 'm1', done: false, agents: [agent('s-al', 'changed', 'Al runs on spare now.'), agent('s-bo', 'pending'), agent('s-cy', 'refused', 'That account does not share this computer\'s memory.')] } },
    { status: 200, body: { id: 'm1', done: true, agents: [agent('s-al', 'changed', 'Al runs on spare now.'),
      agent('s-bo', 'partial', 'We saved spare, but could not start it again: Bo is not running, so there is nothing to restart. It is still on the old account until it restarts.'),
      agent('s-cy', 'refused', 'That account does not share this computer\'s memory.')] } },
  ]);
  const progress = [];
  const note = await fn('/acct/busy', '/acct/spare', ['s-al', 's-bo', 's-cy'], (i, n) => progress.push([i, n]), new Set(['s-bo']));
  assert.equal(asked.length, 3);
  assert.deepEqual(asked[0], { url: '/api/agents/account', method: 'POST', body: { dir: '/acct/spare', names: ['s-al', 's-bo', 's-cy'] } });
  assert.ok(asked.slice(1).every((a) => a.url === '/api/agents/account-moves/m1' && a.method === 'GET'));
  assert.equal(note, 'Moved 1 agent. It restarts on the new account. Moved Bo (stopped). It is not running now. '
    + 'Not moved (Cy): That account does not share this computer\'s memory.');
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]], 'progress counts the agents the board has answered for');
});

test('#6173: a board that restarted mid-move (the read answers 404) leaves the unfinished agents not confirmed, never moved', async () => {
  const { fn } = moveWith([
    { status: 202, body: { id: 'm2', done: false, agents: [agent('s-al', 'pending'), agent('s-bo', 'pending')] } },
    { status: 200, body: { id: 'm2', done: false, agents: [agent('s-al', 'changed', 'Al runs on spare now.'), agent('s-bo', 'pending')] } },
    { status: 404, body: { error: 'this board does not know that move; it may have restarted since' } },
  ]);
  const note = await fn('/acct/busy', '/acct/spare', ['s-al', 's-bo'], null, new Set());
  assert.equal(note, 'Moved 1 agent. It restarts on the new account. No answer yet for Bo. Check its account in a moment.');
});

test('#6173: lost before any answer, nobody reads as moved', async () => {
  const { fn } = moveWith([
    { status: 202, body: { id: 'm3', done: false, agents: [agent('s-al', 'pending'), agent('s-bo', 'pending')] } },
    { status: 404, body: {} },
  ]);
  const note = await fn('/acct/busy', '/acct/spare', ['s-al', 's-bo'], null, new Set());
  assert.equal(note, 'No answer yet for Al, Bo. Check their account in a moment.');
  assert.doesNotMatch(note, /Moved/);
});

test('#6173: reads that keep failing end in a sentence, and say nobody unconfirmed was moved', async () => {
  const { fn, asked } = moveWith([
    { status: 202, body: { id: 'm4', done: false, agents: [agent('s-al', 'pending')] } },
    { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} },
  ]);
  const note = await fn('/acct/busy', '/acct/spare', ['s-al'], null, new Set());
  assert.equal(asked.length, 6, 'it gives up after five failed reads');
  assert.equal(note, 'No answer yet for Al. Check its account in a moment.');
});

test('#6173: a move refused while another runs says the board\'s sentence for every agent', async () => {
  const { fn } = moveWith([{ status: 409, body: { outcome: 'refused', because: 'Another account move is still running. Try again when it has finished.' } }]);
  const note = await fn('/acct/busy', '/acct/spare', ['s-al', 's-bo'], null, new Set());
  assert.equal(note, 'Not moved (Al, Bo): Another account move is still running. Try again when it has finished.');
});

test('#6173: a request that never answers is not a failure (the accounts may be saved): not confirmed, not moved', async () => {
  const { fn } = moveWith([{ abort: true }]);
  const note = await fn('/acct/busy', '/acct/spare', ['s-al'], null, new Set());
  assert.equal(note, 'No answer yet for Al. Check its account in a moment.');
});
