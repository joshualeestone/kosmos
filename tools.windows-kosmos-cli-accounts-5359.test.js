'use strict';
/**
 * #5359, the Windows half: `kosmos accounts` in tools/windows/kosmos-cli.js, mirroring cli.accounts-5359.test.js for
 * install/kosmos. Driven through main() with its seams (fetch, hook, out/err); nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-accounts-5359.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

function harness({ answer = () => [200, {}], throws } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => 'agent-tok', readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers });
      if (throws) throw throws;
      const [status, json] = answer(u);
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

const ACCOUNTS = { accounts: [
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'a@example.com', authMode: 'subscription', connection: { state: 'connected', badge: 'working' } },
  // Review 1 (BLOCKER): a credential on disk is state "connected" even when its last request was refused (#874).
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'r@example.com', authMode: 'subscription', connection: { state: 'connected', badge: 'rejected' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'u@example.com', connection: { state: 'connected', badge: 'signed_in_unverified' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 's@example.com', connection: { state: 'connected', badge: 'working', loginStopsAt: Date.now() + 3 * 3600 * 1000 } },
  { provider: 'openai', providerName: 'OpenAI', email: 'b@example.com', authMode: 'chatgpt', connection: { state: 'unknown', liveCheckPending: true } },
  { provider: 'google', providerName: 'Google Gemini', authMode: 'apikey', connection: { state: 'none', because: 'the key was refused' } },
  { provider: 'xai', providerName: 'xAI Grok', email: 'c@example.com', connection: { state: 'unknown', because: 'we could not check this account just now' } },
  // Review 2: a key row with no badge (state alone), a stop time already past (falls through to the badge), and a
  // refused login whose stop time is ahead (the stop notice comes first, as on the board).
  { provider: 'google', providerName: 'Google Gemini', email: 'k@example.com', authMode: 'apikey', connection: { state: 'connected' } },
  // Review 3: a ChatGPT sign-in whose free check finished with no answer: the board shows it as signed in (amber).
  { provider: 'openai', providerName: 'OpenAI', email: 'g@example.com', authMode: 'chatgpt', connection: { state: 'unknown', because: 'not yet checked' } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'p@example.com', connection: { state: 'connected', badge: 'working', loginStopsAt: Date.now() - 3600 * 1000 } },
  { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'x@example.com', connection: { state: 'connected', badge: 'rejected', loginStopsAt: Date.now() + 3600 * 1000 } },
] };

test('#5359: kosmos accounts reads /api/accounts with the board token only, and says each account\'s state in words', async () => {
  const h = harness({ answer: () => [200, ACCOUNTS] });
  assert.equal(await cli.main(['accounts'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/accounts$/);
  assert.equal(h.sent[0].headers['x-kosmos-board-token'], 'board-tok');
  assert.ok(!('x-kosmos-agent-token' in h.sent[0].headers), 'the agent token was sent to a board-token route');
  const out = h.lines.out.join('\n');
  assert.match(out, /^Anthropic \/ Claude: a@example\.com \(subscription\): signed in$/m);
  assert.match(out, /^Anthropic \/ Claude: r@example\.com \(subscription\): not signed in: its last request was refused\./m, 'a refused login read as signed in');
  assert.match(out, /^Anthropic \/ Claude: u@example\.com: signed in by Kosmos's record, not yet confirmed by a real request$/m);
  assert.match(out, /^Anthropic \/ Claude: s@example\.com: its sign-in has run out; its agents keep working until .+, then stop\./m);
  assert.match(out, /^OpenAI: b@example\.com \(chatgpt\): being checked now; it is known on the next read$/m);
  assert.match(out, /^Google Gemini: k@example\.com \(apikey\): signed in$/m, 'a row with no badge lost its state');
  assert.match(out, /^OpenAI: g@example\.com \(chatgpt\): signed in by its own record, not yet confirmed by a real request$/m, 'a ChatGPT row read unlike the board');
  assert.match(out, /^Anthropic \/ Claude: p@example\.com: signed in$/m, 'a stop time already past still said they stop');
  assert.match(out, /^Anthropic \/ Claude: x@example\.com: its sign-in has run out; its agents keep working until /m, 'the stop notice did not come first');
  assert.match(out, /^Google Gemini: an account with no email on record \(apikey\): not signed in: the key was refused$/m);
  assert.match(out, /^xAI Grok: c@example\.com: could not be checked just now: we could not check this account just now$/m);
});

test('#5359: kosmos accounts says when there are none, and when the board is unreachable, refuses or answers something unreadable', async () => {
  const none = harness({ answer: () => [200, { accounts: [] }] });
  assert.equal(await cli.main(['accounts'], none.io), 0);
  assert.match(none.all(), /No provider accounts are set up on this board yet/);
  const down = harness({ throws: new Error('ECONNREFUSED') });
  assert.equal(await cli.main(['accounts'], down.io), 1);
  assert.match(down.all(), /could not reach Kosmos to read which accounts are set up/);
  const refused = harness({ answer: () => [401, { error: 'that needs the board token' }] });
  assert.equal(await cli.main(['accounts'], refused.io), 1);
  assert.match(refused.all(), /Kosmos refused that request/);
  // Review 1: a fault on the board is not a refusal, and is not told as one.
  const fault = harness({ answer: () => [500, { error: 'we could not read the accounts on this computer' }] });
  assert.equal(await cli.main(['accounts'], fault.io), 1);
  assert.match(fault.all(), /Kosmos could not read its accounts just now: we could not read the accounts on this computer\. Try again in a minute\./);
  assert.doesNotMatch(fault.all(), /refused/);
  // A 4xx that gives no reason is not called a refusal (the same class on both CLIs).
  const bare = harness({ answer: () => [403, {}] });
  assert.equal(await cli.main(['accounts'], bare.io), 1);
  assert.match(bare.all(), /Kosmos could not read its accounts just now\. Try again in a minute\./);
  assert.doesNotMatch(bare.all(), /refused/);
  // Review 3: an error on a 200 is not a refusal (refusals are 4xx, as on the Mac).
  const okErr = harness({ answer: () => [200, { error: 'something odd' }] });
  assert.equal(await cli.main(['accounts'], okErr.io), 1);
  assert.match(okErr.all(), /an answer we could not read about its accounts/);
  assert.doesNotMatch(okErr.all(), /refused/);
  const odd = harness({ answer: () => [200, { something: 'else' }] });
  assert.equal(await cli.main(['accounts'], odd.io), 1);
  assert.match(odd.all(), /an answer we could not read about its accounts/);
});

test('#5359: kosmos accounts --help prints its usage and never asks the board', async () => {
  const h = harness({ answer: () => [200, ACCOUNTS] });
  assert.equal(await cli.main(['accounts', '--help'], h.io), 0, h.all());
  assert.match(h.all(), /Usage: kosmos accounts /);
  assert.equal(h.sent.length, 0, '--help ran the check');
});
