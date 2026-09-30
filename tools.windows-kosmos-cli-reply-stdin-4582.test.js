'use strict';
/**
 * #4582: `kosmos reply --stdin` on the Windows CLI (tools/windows/kosmos-cli.js), the parity half of
 * cli.reply-stdin-4582.test.js. fetch and the stdin read are injected, so no board and no pipe are
 * needed; the harness is tools.windows-kosmos-cli-570.test.js's.
 *
 *   node --test tools.windows-kosmos-cli-reply-stdin-4582.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

async function run(argv, answer, readStdin) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    readStdin,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const a = answer(route, init);
      const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      return { status: a.status || 200, text: async () => text };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const kept = () => ({ body: { kept: true } });
const piped = (text) => async () => ({ text, ended: true });
const noRead = (why) => async () => { throw new Error('stdin was read ' + why); };
function takeSaved(r) {
  const m = r.err.match(/saved at (\S+)/);
  assert.ok(m, 'the piped reply was not kept: ' + r.err);
  const body = fs.readFileSync(m[1], 'utf8');
  fs.rmSync(path.dirname(m[1]), { recursive: true });
  return body;
}

test('#4582: reply --stdin sends the piped text as written, with both tokens', async () => {
  const r = await run(['reply', '--stdin'], kept, piped('run `x` and $y\n\n- one\r\n'));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/reply');
  assert.deepEqual(r.calls[0].body, { text: 'run `x` and $y\n\n- one', from_pane: '' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
  assert.match(r.out, /Answered/);
});

test('#4582 CONTROL: without --stdin, reply takes its words from the args and never reads stdin', async () => {
  const r = await run(['reply', 'plain', 'words'], kept, noRead('without --stdin'));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.calls[0].body, { text: 'plain words', from_pane: '' });
});

test('#4582: reply --stdin refusals send nothing (args too, trailing flag, empty pipe, cut-short pipe)', async () => {
  const mixed = await run(['reply', '--stdin', 'also'], kept, noRead('alongside arguments'));
  assert.equal(mixed.code, 2); assert.equal(mixed.calls.length, 0);
  assert.match(mixed.err, /stdin OR as arguments/);
  const trailing = await run(['reply', 'hello', '--stdin'], kept, noRead('for a trailing --stdin'));
  assert.equal(trailing.code, 2); assert.equal(trailing.calls.length, 0);
  assert.match(trailing.err, /--stdin must come first/);
  const empty = await run(['reply', '--stdin'], kept, async () => ({ text: '', ended: false }));
  assert.equal(empty.code, 2); assert.equal(empty.calls.length, 0);
  assert.match(empty.err, /nothing was piped in: kosmos reply --stdin/);
  const cut = await run(['reply', '--stdin'], kept, async () => ({ text: 'half a reply', ended: false }));
  assert.equal(cut.code, 2); assert.equal(cut.calls.length, 0);
  assert.match(cut.err, /may be cut short\. Save the output to a file first, then: kosmos reply --stdin < file/);
});

test('#4582: a piped reply the board refuses, or does not keep, is saved', async () => {
  const refused = await run(['reply', '--stdin'], () => ({ status: 400, body: { error: 'a reply is at most 2000 characters' } }), piped('R'.repeat(2500)));
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refused that: a reply is at most 2000 characters/);
  assert.equal(takeSaved(refused), 'R'.repeat(2500));
  const notKept = await run(['reply', '--stdin'], () => ({ body: { kept: false, because: 'no conversation' } }), piped('NOT-KEPT'));
  assert.equal(notKept.code, 1);
  assert.equal(takeSaved(notKept), 'NOT-KEPT');
});

test('#4582: unreachable keeps the piped reply; a timeout is a "maybe" (exit 3) and keeps nothing', async () => {
  const down = await run(['reply', '--stdin'], () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }, piped('DOWN'));
  assert.equal(down.code, 1, down.err);
  assert.equal(takeSaved(down), 'DOWN');
  const slow = await run(['reply', '--stdin'], () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }, piped('SLOW'));
  assert.equal(slow.code, 3, slow.err);
  assert.match(slow.err, /may have been kept/);
  assert.doesNotMatch(slow.err, /saved at/);
});

test('#4582: a reply too large for the board is refused before sending, and kept', async () => {
  const huge = await run(['reply', '--stdin'], kept, piped('"'.repeat(3.5 * 1024 * 1024)));
  assert.equal(huge.code, 2);
  assert.equal(huge.calls.length, 0);
  assert.match(huge.err, /too large to send to the board/);
  assert.equal(takeSaved(huge).length, 3.5 * 1024 * 1024);
});

test('#4582: a wrong-world piped reply the outbox cannot keep is saved', async () => {
  const ww = await run(['reply', '--stdin'], () => ({ status: 421, body: { wrongWorld: true } }), piped('w'.repeat(200 * 1024)));
  assert.equal(ww.code, 1, 'the outbox cannot keep it here');
  assert.equal(takeSaved(ww).length, 200 * 1024);
});
