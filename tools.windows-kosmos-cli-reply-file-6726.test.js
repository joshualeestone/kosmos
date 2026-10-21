'use strict';
/**
 * #6726: `kosmos reply --file <path>` on the Windows CLI (tools/windows/kosmos-cli.js), the parity half of
 * cli.reply-file-6726.test.js, arm for arm. The board decides which files may go (server.reply-file-6726.test.js);
 * these arms cover what the command adds. fetch is injected, so no board is needed; the harness is
 * tools.windows-kosmos-cli-reply-stdin-4582.test.js's.
 *
 *   node --test tools.windows-kosmos-cli-reply-file-6726.test.js
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
const ABS = path.resolve('/x/Files/cut.mp4');   // absolute on whichever platform runs this

test('#6726: --file sends an absolute path with the words, and says what was attached', async () => {
  const r = await run(['reply', '--file', ABS, 'Here', 'it', 'is'], kept);
  assert.equal(r.code, 0, r.err);
  assert.equal(replies(r).length, 1);
  assert.deepEqual(replies(r)[0].body, { text: 'Here it is', from_pane: '', file: ABS });
  assert.equal(replies(r)[0].headers['x-kosmos-agent-token'], AGENT);
  assert.match(r.out, /Sent, with cut\.mp4 attached\. It is in their conversation with you\./);
});

test('#6726: a relative path is made absolute from where the command runs', async () => {
  const r = await run(['reply', '--file=Files/notes.md', 'notes'], kept);
  assert.equal(r.code, 0, r.err);
  assert.equal(replies(r)[0].body.file, path.join(process.cwd(), 'Files', 'notes.md'));
});

test('#6726: --file after the words is still the flag; past -- it is words', async () => {
  const late = await run(['reply', 'the cut', '--file', ABS], kept);
  assert.equal(late.code, 0, late.err);
  assert.equal(replies(late)[0].body.file, ABS);
  assert.equal(replies(late)[0].body.text, 'the cut');
  const words = await run(['reply', '--', 'use', '--file', 'to', 'attach'], kept);
  assert.equal(words.code, 0, words.err);
  assert.equal(replies(words)[0].body.file, undefined, 'a --file past -- was taken as the flag');
  assert.equal(replies(words)[0].body.text, 'use --file to attach');
});

test('#6726: --file needs no words (the board names the message after the file)', async () => {
  const r = await run(['reply', '--file', ABS], kept);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(replies(r)[0].body, { text: '', from_pane: '', file: ABS });
});

test('#6726: --file goes with --stdin, the words from the pipe', async () => {
  const r = await run(['reply', '--file', ABS, '--stdin'], kept, async () => ({ text: 'piped `words`', ended: true }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(replies(r)[0].body, { text: 'piped `words`', from_pane: '', file: ABS });
});

test('#6726 CONTROL: with no file and no words it is still the usage, which now names --file', async () => {
  const r = await run(['reply'], kept);
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /Usage: kosmos reply \[--stdin\]/);
  assert.match(r.err, /kosmos reply --file <path>/);
});

test('#6726: the --file usage line is word for word the one install/kosmos prints', () => {
  const src = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  const m = src.match(/say "( {7}kosmos reply --file <path> .*)"\s+# #6726/);
  assert.ok(m, 'install/kosmos no longer prints the --file usage line this pins');
  assert.equal(m[1].replace(/\\"/g, '"'), cli.USAGE_REPLY_FILE);
});

test('#6726: refusals send nothing (twice, no path, an option as the path)', async () => {
  const twice = await run(['reply', '--file', ABS, '--file', ABS, 'x'], kept);
  assert.equal(twice.code, 2);
  assert.match(twice.err, /--file was given twice/);
  for (const args of [['reply', '--file'], ['reply', '--file='], ['reply', '--file', '--stdin'], ['reply', '--file', '--']]) {
    const r = await run(args, kept);
    assert.equal(r.code, 2, args.join(' ') + ': ' + r.err);
    assert.match(r.err, /--file needs the path of the file to attach/, args.join(' '));
    assert.equal(replies(r).length, 0, args.join(' ') + ' reached the board');
  }
  assert.equal(replies(twice).length, 0, 'a refused --file reached the board');
});

test('#6726: the board\'s refusal is said, and the command fails', async () => {
  const r = await run(['reply', '--file', ABS, 'x'], () => ({ body: { kept: false, because: 'only a file directly in your Files folder, or inside the folder of a project you are on, can be attached' } }));
  assert.equal(r.code, 1);
  assert.match(r.err, /That was not kept: only a file directly in your Files folder/);
});

test('#6726: on a wrong-world board a reply with a file is not kept for later', async () => {
  const keptForLater = [];
  const outbox = { keepFromClient: (x) => { keptForLater.push(x); return { ok: true }; }, WRONG_WORLD_SENTENCES: { kept: 'Kept for later.' } };
  const wrongWorld = () => ({ status: 421, body: { wrongWorld: true, serving: 'default' } });
  const r = await run(['reply', '--file', ABS, 'x'], wrongWorld, undefined, { outbox });
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /a reply with a file is not kept for later/);
  assert.equal(keptForLater.length, 0, 'it was put in the outbox');
  /* CONTROL: the same board keeps a reply with no file, through the same injected outbox. */
  const plain = await run(['reply', 'x'], wrongWorld, undefined, { outbox });
  assert.equal(plain.code, 0, plain.err);
  assert.equal(keptForLater.length, 1, 'the control reply was not kept, so the arm above proves nothing');
});

test('#6726 r1-7: a path with a line break, a tab or another control character is refused, and nothing is sent', async () => {
  for (const bad of ['/x/Files/two\nlines.txt', '/x/Files/tab\there.txt', '/x/Files/bell\u0007.txt', 'rel\u001fative.txt']) {
    const r = await run(['reply', '--file', bad, 'x'], kept);
    assert.equal(r.code, 2, JSON.stringify(bad) + ': ' + r.err);
    assert.match(r.err, /control character in it, so it cannot be attached/, JSON.stringify(bad));
    assert.equal(replies(r).length, 0, 'a path with a control character reached the board');
  }
  /* CONTROL: quotes, a backslash and non-ASCII letters arrive exactly as written. */
  const name = path.resolve('/x/Files/say "hi" \\ café.txt');
  const ok = await run(['reply', '--file', name, 'x'], kept);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(replies(ok)[0].body.file, name);
});

test('#6726 r3-6: the command names the file as the board saved it (a link names the file it points at)', async () => {
  const r = await run(['reply', '--file', path.resolve('/x/Files/report-link.pdf'), 'here'], () => ({ body: { kept: true, because: null, attached: 'notes-real.txt' } }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sent, with notes-real\.txt attached\./);
  assert.doesNotMatch(r.out, /report-link\.pdf attached/);
});

test('#6726 r4-5: a saved name with a double quote arrives whole (the JSON is parsed, never cut)', async () => {
  const r = await run(['reply', '--file', path.resolve('/x/Files/say "hi".txt'), 'here'], () => ({ body: '{"kept":true,"because":null,"attached":"say \\"hi\\".txt"}' }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sent, with say "hi"\.txt attached\./);
});
