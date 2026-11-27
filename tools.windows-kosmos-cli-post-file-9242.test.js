'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9242: `kosmos post <project> --file <path>` on the Windows CLI, the parity half of cli.post-attach-1955.test.js.
 * The path is read by the same helper as reply's (takeFileArg), so its path forms are tools.windows-kosmos-cli-reply-
 * file-6726's; these arms cover what post adds. The board decides which files may go (server.post-file-9242.test.js).
 * fetch is injected, so no board is needed (the reply-file test's harness).
 *
 *   node --test tools.windows-kosmos-cli-post-file-9242.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

async function run(argv, answer, readStdin, extra) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    readStdin: readStdin || (async () => { throw new Error('stdin was read without --stdin'); }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    ...(extra || {}),
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
const replies = (r) => r.calls.filter((c) => c.route === '/api/reply');
/* Literal absolute paths for the platform running this (never path.resolve: on a runner whose folder is a network
   path it would give \\host\share\..., which the CLI refuses on purpose). */
const ON_WINDOWS = process.platform === 'win32';
const abs = (...parts) => (ON_WINDOWS ? 'C:\\' + parts.join('\\') : '/' + parts.join('/'));
const ABS = abs('x', 'Files', 'cut.mp4');
/* The folder the command runs in, injected as a literal, so a relative path's expected result does not depend on
   where this suite runs (a network folder on Windows is refused on purpose; `/` on a Mac must not give `//`). */
const HERE = ON_WINDOWS ? 'C:\\work' : '/work';
const atHere = { cwd: () => HERE };

const posted = () => ({ body: { delivery: { state: 'delivered', id: 'm1', outcomes: {} } } });
const posts = (r) => r.calls.filter((c) => c.route === '/api/post');

test('#9242: --file sends an absolute path with the words', async () => {
  const r = await run(['post', 'room', '--file', ABS, 'Here', 'it', 'is'], posted);
  assert.equal(posts(r).length, 1, r.err);
  assert.equal(posts(r)[0].body.file, ABS);
  assert.equal(posts(r)[0].body.text, 'Here it is');
  assert.equal(posts(r)[0].body.project, 'room');
});

test('#9242: --file needs no words; a relative path is made absolute; after the words it is still the flag; past -- it is words', async () => {
  const bare = await run(['post', 'room', '--file', ABS], posted);
  assert.equal(posts(bare).length, 1, bare.err);
  assert.equal(posts(bare)[0].body.text, '');
  const rel = await run(['post', 'room', 'see', '--file', 'notes.md'], posted, undefined, atHere);
  assert.equal(posts(rel)[0].body.file, ON_WINDOWS ? 'C:\\work\\notes.md' : '/work/notes.md');
  assert.equal(posts(rel)[0].body.text, 'see');
  const past = await run(['post', 'room', '--', 'use', '--file', 'x'], posted);
  assert.equal(posts(past)[0].body.file, undefined, 'past -- it was taken as the flag');
});

test('#9242: refused before any request: --attach, --file twice, --file with no path', async () => {
  for (const [argv, why] of [[['post', 'room', '--attach', ABS], /use --file/], [['post', 'room', '--file', ABS, '--file', ABS, 'x'], /given twice, so nothing was posted/],
    [['post', 'room', 'x', '--file'], /needs the path of the file to attach, so nothing was posted/]]) {
    const r = await run(argv, posted);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, why, argv.join(' '));
    assert.equal(posts(r).length, 0, argv.join(' ') + ' reached the board');
  }
});

test('#9242 CONTROL: a post without a file sends no file field', async () => {
  const r = await run(['post', 'room', 'a', 'plain', 'post'], posted);
  assert.equal(posts(r).length, 1, r.err);
  assert.equal('file' in posts(r)[0].body, false);
});
