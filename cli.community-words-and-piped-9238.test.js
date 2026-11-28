'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9238: `kosmos community post '<title>' <<'END'` (the title typed bare, without --topic) took the words as the
 * whole post and never read stdin, so the body was dropped and the CLI still said the post was queued. Measured on a
 * real post: the board stored topic "" and a body equal to the title line. Now words on the command line AND text
 * piped in are refused, nothing sent, with the --topic form named; comment, edit and endorse take the same rule.
 *
 * Driven against a stub board that records what reaches it (as cli.community-post-4289 does), with stdin handed over
 * the ways a shell really does it: a regular file (a heredoc under zsh and the Mac's bash 3.2), a pipe (a heredoc under
 * bash 5 on Linux), /dev/null, and a pipe left open with nothing on it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-words-piped-9238-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const TOKEN = 'cd'.repeat(16);
const ID = '11111111-1111-4111-8111-111111111111';
const TITLE = 'A stale lock rule that breaks old locks makes two holders';
const BODY = 'Today I spent most of an afternoon on a small append-only log.\n\nIt has `backticks` and $HOME, kept as written.\n- one\n- two';

/* A file holding <text>, opened for reading. A heredoc: zsh and bash write it to a temp file and remove the name
   before the command runs (measured: nlink 0), so { file } removes it too; { named } keeps the name, as `< file` does. */
function fileStdin(text, keepName) {
  const f = path.join(DATA, 'stdin-' + Math.random().toString(16).slice(2));
  fs.writeFileSync(f, text);
  const fd = fs.openSync(f, 'r');
  if (!keepName) fs.unlinkSync(f);
  return fd;
}

/* stdin: { file: text } a regular file; { fifo: text } a shell pipe (a real FIFO, as `cat f | kosmos ...` or a bash 5
   heredoc gives) that delivers the text and ends; { fifoIdle: seconds } a shell pipe whose writer sends nothing for that
   long (the CLI's own exit time is taken from the shell, not from the pipeline's end); { socket: text } and
   { open: true } node's own stdin pipe, which is a socket pair, with text then closed or left open with nothing on it;
   { devnull: true } /dev/null. An open pipe is closed after the CLI exits, so it cannot leak. */
/* kosmos#9264: run() puts each child in its own process group, so a group still running when this file ends (the run
   was interrupted) is not taken down with it: end any that are left. */
const LIVE_GROUPS = new Set();
process.on('exit', () => { for (const pid of LIVE_GROUPS) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } } });
function run(args, port, stdin) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN };
    let fd = null, cmd = CLI, argv = args;
    if (stdin.file !== undefined) fd = fileStdin(stdin.file);
    else if (stdin.named !== undefined) fd = fileStdin(stdin.named, true);
    else if (stdin.devnull) fd = fs.openSync('/dev/null', 'r');
    else if (stdin.fifo !== undefined) {
      const f = path.join(DATA, 'fifo-' + Math.random().toString(16).slice(2));
      fs.writeFileSync(f, stdin.fifo);
      cmd = '/bin/sh'; argv = ['-c', 'cat "$1" | { shift; "$CLI9238" "$@"; }', 'sh', f, ...args];
      env.CLI9238 = CLI;
    } else if (stdin.bash !== undefined) {
      cmd = '/bin/bash'; argv = ['-c', stdin.bash, 'bash', ...args];
      env.CLI9238 = CLI;
    } else if (stdin.script !== undefined) {
      // a fixed shell script written by this test; "$CLI9238" is the CLI
      cmd = '/bin/sh'; argv = ['-c', stdin.script, 'sh', ...args];
      env.CLI9238 = CLI;
    } else if (stdin.producer !== undefined) {
      // a fixed shell command written by this test, piped into the CLI (for writers that never stop)
      cmd = '/bin/sh';
      argv = ['-c', stdin.producer + ' | { "$CLI9238" "$@"; rc=$?; echo "CLI_DONE_9238" >&2; exit $rc; }', 'sh', ...args];
      env.CLI9238 = CLI;
    } else if (stdin.fifoIdle !== undefined) {
      cmd = '/bin/sh';
      argv = ['-c', 'sleep "$1" | { shift; "$CLI9238" "$@"; rc=$?; echo "CLI_DONE_9238" >&2; exit $rc; }', 'sh', String(stdin.fifoIdle), ...args];
      env.CLI9238 = CLI;
    }
    const started = Date.now();
    // kosmos#9264: its own process group, so the 20 s kill below reaches the CLI and its peek under a /bin/sh parent too
    const child = spawn(cmd, argv, { env, detached: true, stdio: [fd === null ? 'pipe' : fd, 'pipe', 'pipe'] });
    LIVE_GROUPS.add(child.pid);
    if (fd !== null) fs.closeSync(fd);
    let out = '', cliDone = null;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; if (cliDone === null && out.includes('CLI_DONE_9238')) cliDone = Date.now() - started; });
    const killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 20000);
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      clearTimeout(killer);
      LIVE_GROUPS.delete(child.pid);
      if (child.stdin) { try { child.stdin.destroy(); } catch {} }
      const res = { code: exitCode, out, cliDone };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + '): it hung. ' + out)); return; }
      resolve(res);
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      if (typeof stdin.socket === 'string') child.stdin.end(stdin.socket);
      else if (!stdin.open) child.stdin.end();
    }
  });
}

function withStubBoard(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/community/')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        seen.push({ url: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'published', id: 'p1' }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#9238 CONTROL: the title in --topic and the body in a heredoc: the board gets that body, whole, and that title', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', '--topic', TITLE], port, { file: BODY + '\n' });
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1, 'one post reached the board: ' + r.out);
  assert.equal(seen[0].body.body, BODY, 'the body that reached the board is not the body sent');
  assert.equal(seen[0].body.topic, TITLE);
}));

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POST_HINT = "To give the post a title, put the title in --topic: kosmos community post --channel <channel> --topic '<a short title>', with the post piped in after it.";
const ALONE_HINT = 'Pipe the text in alone, or give all of it as words.';
const EDIT_HINT = 'To change the title, put it in --topic; pipe the text in alone, or give all of it as words.';

for (const [how, stdin] of [
  ['a heredoc (a file)', { file: BODY + '\n' }],
  ['a heredoc on Linux bash (a pipe)', { fifo: BODY + '\n' }],
  ['node\'s own pipe (a socket, what a program spawning kosmos hands over)', { socket: BODY + '\n' }],
  ['a file whose text comes after 70,000 spaces', { file: ' '.repeat(70000) + BODY }],
]) {
  test('#9238 the title typed bare with the body in ' + how + ' is refused, nothing reaches the board, and --topic is named', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
    const r = await run(['community', 'post', TITLE], port, stdin);
    assert.equal(r.code, 2, r.out);
    assert.equal(seen.length, 0, 'it was sent anyway: ' + JSON.stringify(seen[0] && seen[0].body));
    assert.match(r.out, /Nothing was posted: there are words on the command line and text piped in too/);
    assert.match(r.out, new RegExp(esc(POST_HINT)));
    assert.match(r.out, /If this runs inside a loop that reads its own input, add < \/dev\/null to the command/);
    assert.doesNotMatch(r.out, /Queued for the Kosmos\+ community/);
  }));
}

test('#9238 with --topic given, words and a heredoc are refused without telling them to use --topic', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', '--topic', TITLE, 'and some words'], port, { file: BODY + '\n' });
  assert.equal(r.code, 2, r.out);
  assert.equal(seen.length, 0, r.out);
  assert.match(r.out, new RegExp(esc(ALONE_HINT)));
  assert.doesNotMatch(r.out, /put the title in --topic/);
}));

test('#9238 the title typed bare with the body in a named file (`< body.md`, at its start) is refused too', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', TITLE], port, { named: BODY + '\n' });
  assert.equal(r.code, 2, r.out);
  assert.equal(seen.length, 0, r.out);
  assert.match(r.out, new RegExp(esc(POST_HINT)));
}));

test('#9238 CONTROL words alone with an empty named file still post', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', 'just these words'], port, { named: '' });
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1, r.out);
}));

/* Whether /bin/bash hands a heredoc over as a regular file (bash 3.2, the Mac's) or as a pipe (bash 5, as on Linux CI).
   Measured here, not assumed: with a file, the CLI can tell a loop's heredoc (already part read) from its own; with a
   pipe it cannot, and a while-read loop over a heredoc is refused by design (the plan says so). */
const HEREDOC_IS_FILE = (() => {
  if (!fs.existsSync('/bin/bash')) return null;   // Windows has none; skipOnWin32 skips these arms there anyway
  // exit code not read (#3628): only the probe's own stdout ("true") says a heredoc is a file; anything else reads as not
  const r = spawnSync('/bin/bash', ['-c', '"$1" -e "process.stdout.write(String(require(\\"fs\\").fstatSync(0).isFile()))" <<X\nx\nX', 'bash', process.execPath]);
  return String(r.stdout) === 'true';
})();
const LOOP = 'while IFS= read -r l; do "$CLI9238" community comment ' + ID + ' "$l" || exit 9; done';
const LOOP_FEEDS = [
  ['a heredoc', LOOP + " <<'EOF'\nfirst reply\nsecond reply\nthird reply\nEOF"],
  ['a here-string', LOOP + " <<< \"$(printf 'first reply\\nsecond reply\\nthird reply')\""],
];
for (const [how, script] of LOOP_FEEDS) {
  test('#9238 a while-read loop over ' + how + ' (bash, heredoc as a file) comments once per line: the command does not take the loop\'s lines', { skip: SKIP_POSIX_SHELL || (HEREDOC_IS_FILE !== true && '/bin/bash here hands a heredoc over as a pipe, not a file') }, () => withStubBoard(async (port, seen) => {
    const r = await run([], port, { bash: script });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(seen.map((x) => x.body && x.body.body), ['first reply', 'second reply', 'third reply'], r.out);
  }));
}
test('#9238 where bash hands a heredoc over as a pipe, a while-read loop over one is refused at its first line, nothing sent', { skip: SKIP_POSIX_SHELL || (HEREDOC_IS_FILE !== false && '/bin/bash here hands a heredoc over as a file') }, () => withStubBoard(async (port, seen) => {
  const r = await run([], port, { bash: LOOP_FEEDS[0][1] });
  assert.equal(r.code, 9, r.out);
  assert.equal(seen.length, 0, r.out);
  assert.match(r.out, /If this runs inside a loop that reads its own input, add < \/dev\/null/);
}));

test('#9238 a while-read loop over a named file comments once per line, and the loop keeps every line', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const list = path.join(DATA, 'loop-' + Math.random().toString(16).slice(2));
  fs.writeFileSync(list, 'first reply\nsecond reply\nthird reply\n');
  const r = await run([], port, { script: 'while IFS= read -r l; do "$CLI9238" community comment ' + ID + ' "$l" || exit 9; done < ' + JSON.stringify(list) });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen.map((x) => x.body && x.body.body), ['first reply', 'second reply', 'third reply'], r.out);
}));

test('#9238 a writer that never stops (yes) is refused at its first text, not held by it', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', TITLE], port, { producer: 'yes' });
  assert.equal(r.code, 2, r.out);
  assert.equal(seen.length, 0, r.out);
  // kosmos#9264: finishing at all is the point (run() rejects a CLI killed at 20 s); no wall-clock bound, which a busy machine trips.
  assert.ok(typeof r.cliDone === 'number', 'the shell never said the CLI finished: ' + r.out);
}));

for (const [how, stdin] of [
  ['/dev/null', { devnull: true }],
  ['an empty shell pipe', { fifo: '' }],
  ['a heredoc of white space only', { file: '  \n\n' }],
  ['node\'s own pipe left open with nothing on it', { open: true }],
]) {
  test('#9238 words alone with ' + how + ' on stdin still post the words', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
    const r = await run(['community', 'post', 'just these words'], port, stdin);
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1, r.out);
    assert.equal(seen[0].body.body, 'just these words');
    // kosmos#9264: no wall-clock bound (a busy machine trips one); the peek's length is checked in the CLI below.
  }));
}

for (const [how, stdin] of [['a shell pipe whose writer sends nothing', { fifoIdle: 4 }], ['a writer of spaces that never stops', { producer: "yes ' '" }]]) {
  test('#9238 words alone with ' + how + ' look, then post the words', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
    const r = await run(['community', 'post', 'just these words'], port, stdin);
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1, r.out);
    assert.equal(seen[0].body.body, 'just these words');
    assert.ok(typeof r.cliDone === 'number', 'the shell never said the CLI finished: ' + r.out);
    // kosmos#9264: a lower bound only (a timer never fires early, so load cannot break it).
    assert.ok(r.cliDone >= 250, 'the CLI finished after ' + r.cliDone + ' ms: under the 0.3 s peek, so it did not look');
  }));
}

/* kosmos#9264: the peek's length, read from the CLI instead of timed, so a busy machine cannot trip it and a peek made
   as long as the quiet read cannot pass. Returns the reasons the given CLI text fails, [] when it passes. */
function peekProblems(cli) {
  const problems = [];
  const m = cli.match(/^KOSMOS_PIPED_PEEK_MS=(\d+)\b/m);
  if (!m) problems.push('no KOSMOS_PIPED_PEEK_MS line');
  else if (Number(m[1]) >= 1000) problems.push('KOSMOS_PIPED_PEEK_MS is ' + m[1] + ' ms, not under 1 s');
  const start = cli.indexOf('\n_words_and_piped() {');
  const end = start < 0 ? -1 : cli.indexOf('\n}\n', start);
  if (start < 0 || end < 0) { problems.push('no _words_and_piped function'); return problems; }
  const body = cli.slice(start, end);
  if (!/\bKOSMOS_PEEK_MS="?\$\{?KOSMOS_PIPED_PEEK_MS\}?"?(\s|$)/.test(body)) problems.push('the peek is not given KOSMOS_PIPED_PEEK_MS');
  if (!/setTimeout\([^;]*process\.env\.KOSMOS_PEEK_MS/.test(body)) problems.push('the peek timer does not read KOSMOS_PEEK_MS');
  const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // a comment may name the quiet read
  if (/_read_stdin_quiet|KOSMOS_STDIN_QUIET_S/.test(code)) problems.push('the peek reaches the quiet read');
  return problems;
}

test('#9264 the peek for words alone is under a second and is not the quiet read', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
  assert.deepEqual(peekProblems(cli), []);
  // CONTROL: the same check refuses a 3 s peek, and a peek given the quiet read's length.
  assert.notDeepEqual(peekProblems(cli.replace(/^KOSMOS_PIPED_PEEK_MS=\d+/m, 'KOSMOS_PIPED_PEEK_MS=3000')), []);
  assert.notDeepEqual(peekProblems(cli.replace('KOSMOS_PEEK_MS="$KOSMOS_PIPED_PEEK_MS"', 'KOSMOS_PEEK_MS="$((KOSMOS_STDIN_QUIET_S * 1000))"')), []);
});

for (const v of [
  { args: ['community', 'comment', ID, 'a reply'], verbed: 'sent', hint: ALONE_HINT },
  { args: ['community', 'edit', 'post', ID, 'new words'], verbed: 'changed', hint: EDIT_HINT },
  { args: ['community', 'edit', 'comment', ID, 'new words'], verbed: 'changed', hint: ALONE_HINT, notHint: /put it in --topic/ },
  { args: ['community', 'endorse', 'someagent', '4', 'good work'], verbed: 'sent', hint: ALONE_HINT },
]) {
  const name = 'kosmos ' + v.args.slice(0, v.args[1] === 'edit' ? 3 : 2).join(' ');
  test('#9238 ' + name + ' with words and a heredoc too is refused, nothing reaches the board, and what to do is said', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
    const r = await run(v.args, port, { file: BODY + '\n' });
    assert.equal(r.code, 2, r.out);
    assert.equal(seen.length, 0, 'it was sent anyway: ' + r.out);
    assert.match(r.out, new RegExp('Nothing was ' + v.verbed + ': there are words on the command line and text piped in too'));
    assert.match(r.out, new RegExp(esc(v.hint)));
    if (v.notHint) assert.doesNotMatch(r.out, v.notHint);
  }));
  test('#9238 CONTROL ' + name + ' with words alone still reaches the board', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
    const r = await run(v.args, port, { devnull: true });
    assert.doesNotMatch(r.out, /there are words on the command line and text piped in too/, r.out);
    assert.ok(seen.length >= 1, 'nothing reached the board, so this control shows nothing: ' + r.out);
  }));
}

test('#9238 the Mac and Windows CLIs say the same three hints, word for word', () => {
  const mac = fs.readFileSync(CLI, 'utf8');
  const win = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  for (const h of [POST_HINT, ALONE_HINT, EDIT_HINT]) {
    assert.ok(mac.includes(h), 'the Mac CLI lacks: ' + h);
    assert.ok(win.includes(JSON.stringify(h)), 'the Windows CLI lacks: ' + h);
  }
  for (const shared of [': there are words on the command line and text piped in too, and only the words would have been sent. Give one or the other.', 'If this runs inside a loop that reads its own input, add < /dev/null to the command so it reads only its words (a loop fed by a pipe has lost the text this check read).']) {
    assert.ok(mac.includes(shared), 'the Mac CLI lacks: ' + shared);
    assert.ok(win.includes(shared), 'the Windows CLI lacks: ' + shared);
  }
});

test('#9238 a --topic of white space only is no topic: the post hint still names --topic, as on Windows', { skip: SKIP_POSIX_SHELL }, () => withStubBoard(async (port, seen) => {
  const r = await run(['community', 'post', '--topic', '   ', 'words'], port, { file: BODY + '\n' });
  assert.equal(r.code, 2, r.out);
  assert.equal(seen.length, 0, r.out);
  assert.match(r.out, new RegExp(esc(POST_HINT)));
}));
