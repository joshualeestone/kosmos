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

test('#6726: a relative path is made absolute from where the command runs, joined as text', async () => {
  const r = await run(['reply', '--file=Files/notes.md', 'notes'], kept);
  assert.equal(r.code, 0, r.err);
  assert.equal(replies(r)[0].body.file, process.cwd().replace(/[\\/]+$/, '') + path.sep + 'Files/notes.md');
});

test('#6726 review 1: a .. in the path reaches the board as given (the board refuses it there, as on a Mac)', async () => {
  const rel = await run(['reply', '--file', 'Files/sub/../x.txt', 'x'], kept);
  assert.equal(rel.code, 0, rel.err);
  assert.equal(replies(rel)[0].body.file, process.cwd().replace(/[\\/]+$/, '') + path.sep + 'Files/sub/../x.txt', 'the .. was rewritten before it was sent');
  const abs = process.platform === 'win32' ? 'C:\\a\\Files\\sub\\..\\x.txt' : '/a/Files/sub/../x.txt';
  const given = await run(['reply', '--file', abs, 'x'], kept);
  assert.equal(given.code, 0, given.err);
  assert.equal(replies(given)[0].body.file, abs, 'an absolute path was rewritten before it was sent');
});

test('#6726 review 1: the Windows path forms, with the Windows path rules on any machine', () => {
  const W = path.win32;
  const cwd = 'C:\\Users\\a\\';
  assert.equal(cli.replyFileAbsolute('C:\\a\\..\\x.txt', cwd, W), 'C:\\a\\..\\x.txt');
  assert.equal(cli.replyFileAbsolute('c:/a/x.txt', cwd, W), 'c:/a/x.txt');
  assert.equal(cli.replyFileAbsolute('\\\\srv\\share\\x.txt', cwd, W), null, 'a network path was sent (review 3)');
  assert.equal(cli.replyFileAbsolute('//srv/share/x.txt', cwd, W), null, 'a network path was sent (review 3)');
  assert.equal(cli.replyFileAbsolute('\\\\?\\C:\\x.txt', cwd, W), null, 'a device path was sent (review 3)');
  assert.equal(cli.replyFileAbsolute('x.txt', '\\\\srv\\share\\dir', W), null, 'a relative path from a network folder was sent');
  assert.equal(cli.replyFileAbsolute('Files\\x.txt', cwd, W), 'C:\\Users\\a\\Files\\x.txt');
  assert.equal(cli.replyFileAbsolute('C:foo.txt', cwd, W), null, 'a drive with no folder was sent');
  assert.equal(cli.replyFileAbsolute('\\foo.txt', cwd, W), null, 'a folder with no drive was sent');
  assert.equal(cli.replyFileAbsolute('/foo.txt', cwd, W), null, 'a folder with no drive was sent');
  /* CONTROL: the posix rules take /foo as absolute and join a relative one onto the folder. */
  assert.equal(cli.replyFileAbsolute('/foo.txt', '/w', path.posix), '/foo.txt');
  assert.equal(cli.replyFileAbsolute('a/../b', '/w', path.posix), '/w/a/../b');
});

test('#6726 review 3: under the Windows path rules, reply refuses a path with no drive and sends one on a drive', async () => {
  const win = { pathRules: path.win32 };
  for (const bad of ['C:foo.txt', '\\\\host\\share\\x.txt', '/c/Users/a/Files/x.txt', '\\foo.txt']) {
    const r = await run(['reply', '--file', bad, 'x'], kept, undefined, win);
    assert.equal(r.code, 2, bad + ': ' + r.err);
    assert.match(r.err, /Give the file's full path on this computer, starting with its drive/, bad);
    assert.equal(replies(r).length, 0, bad + ' reached the board');
  }
  /* CONTROL: a path on a drive is sent as given, and the file is named by the Windows rules (posix would name it whole). */
  const ok = await run(['reply', '--file', 'C:\\a\\Files\\cut.mp4', 'x'], kept, undefined, win);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(replies(ok)[0].body.file, 'C:\\a\\Files\\cut.mp4');
  assert.match(ok.out, /Sent, with cut\.mp4 attached\./);
});

test('#6726 review 1: kosmos reply --help names --file, as install/kosmos\'s help does', async () => {
  const r = await run(['reply', '--help'], kept);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 0, '--help sent something');
  assert.match(r.out, /Usage: kosmos reply \[--stdin\]/);
  assert.ok(r.out.includes(cli.USAGE_REPLY_FILE), 'reply --help does not show the --file line');
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
  /* path.resolve gives each an absolute form on the platform running this, so the control character is what is refused (review 3). */
  for (const bad of [path.resolve('/x/Files/two\nlines.txt'), path.resolve('/x/Files/tab\there.txt'), path.resolve('/x/Files/bell\u0007.txt'), 'rel\u001fative.txt']) {
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

/* #6726 review 3: the Git Bash shim (tools/windows/kosmos.sh) turns MSYS path conversion off for every argument, so
   it converts --file's value for reply itself, as it does --body-file's: /c/Users/... typed in Git Bash would
   otherwise reach Windows node unconverted and be refused. Run on any machine with a stand-in cygpath (marks what it
   converted) and a stand-in node (prints the arguments it got); the real cygpath runs in the Windows-only arms of
   tools.windows-kosmos-cli-body-file-5946.test.js. */
test('#6726 review 3: the Git Bash shim converts reply --file\'s value, and nothing else', () => {
  const cp = require('node:child_process');
  const os = require('node:os');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-shim-6726-')));
  try {
    for (const d of ['bin', 'runtime', 'fakebin']) fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, 'bin', 'kosmos'), fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos.sh'), 'utf8').replace(/\r/g, ''));
    fs.writeFileSync(path.join(root, 'bin', 'kosmos-cli.js'), '');
    fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), '#!/bin/sh\nshift\nfor a do printf "[%s]\\n" "$a"; done\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'fakebin', 'cygpath'), '#!/bin/sh\n[ "$1" = -w ] && shift\n[ "$1" = -- ] && shift\ncase $1 in */runtime/node.exe|*/kosmos-cli.js) printf "%s\\n" "$1" ;; *) printf "CONV:%s\\n" "$1" ;; esac\n', { mode: 0o755 });
    const sh = (args) => cp.execFileSync('/bin/sh', [path.join(root, 'bin', 'kosmos'), ...args], { env: { PATH: path.join(root, 'fakebin') + ':/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(sh(['reply', '--file', '/c/Users/a/Files/x.txt', 'see /c/y']), '[reply]\n[--file]\n[CONV:/c/Users/a/Files/x.txt]\n[see /c/y]\n');
    assert.equal(sh(['reply', 'the cut', '--file=/tmp/a.mov']), '[reply]\n[the cut]\n[--file=CONV:/tmp/a.mov]\n');
    /* CONTROLS: past -- it is words; a relative path is left for the CLI; another verb's --file is not touched; and
       --body-file is still converted for community. */
    assert.equal(sh(['reply', '--', '--file', '/c/z']), '[reply]\n[--]\n[--file]\n[/c/z]\n');
    assert.equal(sh(['reply', '--file', 'Files/x.txt']), '[reply]\n[--file]\n[Files/x.txt]\n');
    assert.equal(sh(['post', 'p1', '--file', '/c/q']), '[post]\n[p1]\n[--file]\n[/c/q]\n');
    assert.equal(sh(['community', 'post', '--body-file', '/tmp/b']), '[community]\n[post]\n[--body-file]\n[CONV:/tmp/b]\n');
    assert.equal(sh(['reply', '--body-file', '/tmp/b', 'x']), '[reply]\n[--body-file]\n[/tmp/b]\n[x]\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
