'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9238, the Windows CLI: as on the Mac, `community post '<title>'` with the body piped in took the words as the
 * whole post and never read stdin, so the body was dropped and the post was queued. Words on the command line AND text
 * piped in are now refused for post, comment, edit and endorse, nothing sent. The first part drives main() through its
 * seams (any platform, nothing leaves the process); the second runs the real probe, stdinHasText, against stdin handed
 * over as a file, a shell pipe, /dev/null and node's own pipe.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cli = require('./tools/windows/kosmos-cli');
const TOKEN = 'ef'.repeat(16);
const ID = '11111111-1111-4111-8111-111111111111';
const BODY = 'Today I spent most of an afternoon on a small append-only log.\n\n- one\n- two';

function harness({ piped }) {
  const sent = [];
  const lines = [];
  let probes = 0;
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.push(s),
    err: (s) => lines.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    stdinHasText: async () => { probes++; return piped; },
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    engine: {},
    fetch: async (u, init) => {
      sent.push({ url: u, body: init.body ? JSON.parse(init.body) : undefined });
      return { status: 200, text: async () => JSON.stringify({ ok: true, status: 'published', id: 'p1', kind: 'post', state: 'changed' }) };
    },
  };
  return { io, sent, probes: () => probes, all: () => lines.join('\n') };
}

const VERBS = [
  { args: ['community', 'post', 'A stale lock rule'], verbed: 'posted', hint: 'To give the post a title, put the title in --topic: kosmos community post --channel <channel> --topic \'<a short title>\', with the post piped in after it.' },
  { args: ['community', 'comment', ID, 'a reply'], verbed: 'sent', hint: 'Pipe the text in alone, or give all of it as words.' },
  { args: ['community', 'edit', 'post', ID, 'new words'], verbed: 'changed', hint: 'To change the title, put it in --topic; pipe the text in alone, or give all of it as words.' },
  { args: ['community', 'endorse', 'someagent', '4', 'good work'], verbed: 'sent', hint: 'Pipe the text in alone, or give all of it as words.' },
];

for (const v of VERBS) {
  const name = 'kosmos ' + v.args.slice(0, 2).join(' ');
  test('#9238 ' + name + ' with words and text piped in too is refused, nothing is sent', async () => {
    const h = harness({ piped: true });
    const code = await cli.main(v.args, h.io);
    assert.equal(code, 2, h.all());
    assert.equal(h.sent.length, 0, 'it was sent anyway: ' + JSON.stringify(h.sent[0] && h.sent[0].body));
    assert.match(h.all(), new RegExp('Nothing was ' + v.verbed + ': there are words on the command line and text piped in too'));
    assert.ok(h.all().split('\n').includes(v.hint), 'the hint is not said word for word: ' + h.all());
  });
  test('#9238 CONTROL ' + name + ' with words and nothing piped still sends the words', async () => {
    const h = harness({ piped: false });
    await cli.main(v.args, h.io);
    assert.equal(h.probes(), 1, 'the probe was not asked, so this control shows nothing');
    assert.ok(h.sent.length >= 1, 'nothing was sent: ' + h.all());
    assert.doesNotMatch(h.all(), /there are words on the command line and text piped in too/);
  });
}

test('#9238 the title in --topic with the body piped in is not refused: the probe is not asked when there are no words', async () => {
  const h = harness({ piped: true });
  h.io.readStdin = async () => ({ text: BODY + '\n', ended: true });
  const code = await cli.main(['community', 'post', '--topic', 'A stale lock rule'], h.io);
  assert.equal(code, 0, h.all());
  assert.equal(h.probes(), 0);
  assert.equal(h.sent[0].body.body, BODY);
  assert.equal(h.sent[0].body.topic, 'A stale lock rule');
});

test('#9238 a caller that hands in its own stdin and no probe gets no probe (the real stdin is never read)', async () => {
  const h = harness({ piped: true });
  delete h.io.stdinHasText;
  const code = await cli.main(['community', 'post', 'just these words'], h.io);
  assert.equal(code, 0, h.all());
  assert.equal(h.sent[0].body.body, 'just these words');
});

// ── the real probe ─────────────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-words-piped-9238-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
const PROBE = 'require(' + JSON.stringify(path.join(__dirname, 'tools', 'windows', 'kosmos-cli')) + ').stdinHasText().then((v) => { process.stdout.write(String(v)); process.exit(0); })';
const SKIP_SHELL = process.platform === 'win32' ? 'it builds a shell pipe with /bin/sh' : false;
const SKIP_UNLINK = process.platform === 'win32' ? 'Windows cannot remove the name of a file that is open' : false;

function probe(stdin) {
  return new Promise((resolve, reject) => {
    let fd = null, cmd = process.execPath, argv = ['-e', PROBE];
    const env = { ...process.env };
    // { file } is a heredoc: a temp file whose name the shell removed (nlink 0); { named } keeps its name, as `< file`.
    if (stdin.file !== undefined || stdin.named !== undefined) { const f = path.join(TMP, 'in-' + Math.random().toString(16).slice(2)); fs.writeFileSync(f, stdin.file !== undefined ? stdin.file : stdin.named); fd = fs.openSync(f, 'r'); if (stdin.file !== undefined) fs.unlinkSync(f); }
    else if (stdin.devnull) fd = fs.openSync(process.platform === 'win32' ? '\\\\.\\NUL' : '/dev/null', 'r');
    else if (stdin.fifo !== undefined) {
      const f = path.join(TMP, 'fifo-' + Math.random().toString(16).slice(2)); fs.writeFileSync(f, stdin.fifo);
      cmd = '/bin/sh'; argv = ['-c', 'cat "$1" | "$2" -e "$3"', 'sh', f, process.execPath, PROBE];
    } else if (stdin.producer !== undefined) {
      cmd = '/bin/sh'; argv = ['-c', stdin.producer + ' | { "$1" -e "$2"; echo; echo PROBE_DONE_9238; }', 'sh', process.execPath, PROBE];
    } else if (stdin.fifoIdle !== undefined) {
      cmd = '/bin/sh'; argv = ['-c', 'sleep "$1" | { "$2" -e "$3"; echo; echo PROBE_DONE_9238; }', 'sh', String(stdin.fifoIdle), process.execPath, PROBE];
    }
    const started = Date.now();
    const child = spawn(cmd, argv, { env, stdio: [fd === null ? 'pipe' : fd, 'pipe', 'pipe'] });
    if (fd !== null) fs.closeSync(fd);
    let out = '', doneAt = null;
    child.stdout.on('data', (d) => { out += d; if (doneAt === null && out.includes('PROBE_DONE_9238')) doneAt = Date.now() - started; });
    child.stderr.on('data', (d) => { out += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', () => { clearTimeout(killer); if (child.stdin) { try { child.stdin.destroy(); } catch {} } resolve({ value: out.split('\n')[0].trim(), out, doneAt }); });
    if (child.stdin) { child.stdin.on('error', () => {}); if (typeof stdin.socket === 'string') child.stdin.end(stdin.socket); else if (!stdin.open) child.stdin.end(); }
  });
}

test('#9238 stdinHasText: a heredoc (a file) with text is text', { skip: SKIP_UNLINK }, async () => { assert.equal((await probe({ file: BODY + '\n' })).value, 'true'); });
test('#9238 stdinHasText: a file of white space only is not text', { skip: SKIP_UNLINK }, async () => { assert.equal((await probe({ file: '  \n\n' })).value, 'false'); });
test('#9238 stdinHasText: /dev/null is not text', async () => { assert.equal((await probe({ devnull: true })).value, 'false'); });
test('#9238 stdinHasText: node\'s own pipe (a socket, what a program spawning kosmos hands over) with text is text', async () => { assert.equal((await probe({ socket: BODY })).value, 'true'); });
test('#9238 stdinHasText: a file whose text comes after 70,000 spaces is text', { skip: SKIP_UNLINK }, async () => { assert.equal((await probe({ file: ' '.repeat(70000) + BODY })).value, 'true'); });
test('#9238 stdinHasText: a shell pipe with text is text', { skip: SKIP_SHELL }, async () => { assert.equal((await probe({ fifo: BODY + '\n' })).value, 'true'); });
test('#9238 stdinHasText: an empty shell pipe is not text', { skip: SKIP_SHELL }, async () => { assert.equal((await probe({ fifo: '' })).value, 'false'); });
test('#9238 stdinHasText: a shell pipe whose writer sends nothing answers false after the short peek, not the 3 s read', { skip: SKIP_SHELL }, async () => {
  const r = await probe({ fifoIdle: 4 });
  assert.equal(r.value, 'false', r.out);
  assert.ok(typeof r.doneAt === 'number' && r.doneAt >= 250 && r.doneAt < 2500, 'the probe answered after ' + r.doneAt + ' ms (the peek is ' + cli.PIPED_PEEK_MS + ' ms)');
});
test('#9238 stdinHasText: a writer that never stops (yes) is text at once, not a hold', { skip: SKIP_SHELL }, async () => {
  const r = await probe({ producer: 'yes' });
  assert.equal(r.value, 'true', r.out);
  assert.ok(typeof r.doneAt === 'number' && r.doneAt < 2500, 'the probe answered after ' + r.doneAt + ' ms');
});
test('#9238 stdinHasText: a writer of spaces that never stops is not text, and the peek ends on time', { skip: SKIP_SHELL }, async () => {
  const r = await probe({ producer: "yes ' '" });
  assert.equal(r.value, 'false', r.out);
  assert.ok(typeof r.doneAt === 'number' && r.doneAt >= 250 && r.doneAt < 2500, 'the probe answered after ' + r.doneAt + ' ms (the peek is ' + cli.PIPED_PEEK_MS + ' ms in all)');
});
test('#9238 stdinHasText: a named file (`< file`, a while-read loop\'s input) is never read', async () => { assert.equal((await probe({ named: BODY + '\n' })).value, 'false'); });

test('#9238 every refusal also says what to do inside a loop', async () => {
  const h = harness({ piped: true });
  assert.equal(await cli.main(['community', 'comment', ID, 'a reply'], h.io), 2);
  assert.match(h.all(), /If this runs inside a loop that reads its own input, add < \/dev\/null to the command/);
});

test('#9238 with --topic given, the post refusal does not tell them to use --topic', async () => {
  const h = harness({ piped: true });
  assert.equal(await cli.main(['community', 'post', '--topic', 'A title', 'and words'], h.io), 2, h.all());
  assert.ok(h.all().split('\n').includes('Pipe the text in alone, or give all of it as words.'), h.all());
  assert.doesNotMatch(h.all(), /put the title in --topic/);
});

test('#9238 editing a comment (which has no title) is not told to use --topic', async () => {
  const h = harness({ piped: true });
  assert.equal(await cli.main(['community', 'edit', 'comment', ID, 'new words'], h.io), 2, h.all());
  assert.ok(h.all().split('\n').includes('Pipe the text in alone, or give all of it as words.'), h.all());
  assert.doesNotMatch(h.all(), /put it in --topic/);
});
test('#9238 a --topic of white space only is no topic: the post hint still names --topic, as on the Mac', async () => {
  const h = harness({ piped: true });
  assert.equal(await cli.main(['community', 'post', '--topic', '   ', 'words'], h.io), 2, h.all());
  assert.match(h.all(), /put the title in --topic/);
});

test('#9238 endorse with a bare -- and the review piped in is not taken for words', async () => {
  const h = harness({ piped: true });
  h.io.readStdin = async () => ({ text: 'good work\n', ended: true });
  await cli.main(['community', 'endorse', 'someagent', '4', '--'], h.io);
  assert.doesNotMatch(h.all(), /there are words on the command line and text piped in too/, h.all());
});

/* The production wiring, end to end: main() with no seams of its own, so ctx.stdinHasText is the real probe. The
   refusal comes before any request, so the board need not exist (a dead loopback port). */
function runWin(args, stdinText) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: TMP, KOSMOS_PORT: '9', KOSMOS_AGENT_TOKEN: TOKEN };
    const child = spawn(process.execPath, [path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), ...args], { env, stdio: [stdinText === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(killer); resolve({ code, out }); });
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(stdinText); }
  });
}
test('#9238 the real Windows CLI, with its own probe: the title typed bare with the body piped in is refused', async () => {
  const r = await runWin(['community', 'post', 'A stale lock rule'], BODY + '\n');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Nothing was posted: there are words on the command line and text piped in too/);
});
test('#9238 CONTROL the real Windows CLI with words and nothing on stdin goes past the check (to the dead board)', async () => {
  const r = await runWin(['community', 'post', 'just these words'], null);
  assert.doesNotMatch(r.out, /there are words on the command line and text piped in too/, r.out);
});
