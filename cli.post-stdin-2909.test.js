'use strict';

/**
 * #2909: `kosmos post --stdin <project>` reads the message from standard input, so backticks and $
 * reach the room as written. In a double-quoted arg the shell runs `x` and expands $y before
 * Kosmos ever sees the text; the CONTROL below reproduces that through a real /bin/sh so this test
 * can see the hazard, not just assume it. Same harness idiom as cli.post-noreply-2908.test.js: spawn
 * the real install/kosmos against a stub board that captures the /api/post body.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env, input) {
  return new Promise((resolve) => {
    const child = execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input === undefined ? '' : input);
  });
}

function runShell(line, env) {
  return new Promise((resolve) => {
    const child = execFile('/bin/sh', ['-c', line], { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

/** Stub board: answer the health GET, capture the /api/post body, return a placed delivery. */
function withStubBoard(fn, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/post')) {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(reply || '{"delivery":{"state":"placed"}}');
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

const RICH = 'Run `echo PWNED` then check $HOME and "quotes" \\ backslash\n\n- one\n- two';

test('#2909: kosmos post --stdin delivers backticks, $, quotes, backslashes and newlines verbatim', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, RICH + '\n');
  assert.equal(out.code, 0, 'the post should succeed: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'exactly one post reached the board');
  assert.equal(seen[0].text, RICH, 'the piped message must arrive unchanged (trailing newline trimmed)');
  assert.equal(seen[0].project, 'proj');
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'reply_expected'), false, '--stdin alone must not imply --no-reply');
}));

test('#2909 CONTROL: the same text as a double-quoted arg is mangled by the shell (the hazard --stdin exists for)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42', HOME: '/home/control' };
  const out = await runShell(`"${CLI}" post proj "Run \`echo PWNED\` then check $HOME"`, env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, 'Run PWNED then check /home/control',
    'the shell ran the backticks and expanded $HOME before Kosmos saw the text; if this ever arrives verbatim, the premise of --stdin changed');
}));

test('#2909: --stdin and --no-reply are leading flags in either order', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const a = await runCli(['post', '--no-reply', '--stdin', 'proj'], env, 'ack one');
  const b = await runCli(['post', '--stdin', '--no-reply', 'proj'], env, 'ack two');
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.deepEqual(seen.map((s) => [s.project, s.text, s.reply_expected]), [['proj', 'ack one', false], ['proj', 'ack two', false]]);
}));

test('#2909: --stdin with text args, or with nothing piped in, is refused and posts nothing', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const mixed = await runCli(['post', '--stdin', 'proj', 'also', 'args'], env, 'piped');
  assert.equal(mixed.code, 2, 'stdin AND args is ambiguous');
  assert.match(mixed.stdout + mixed.stderr, /stdin OR as arguments/);
  const empty = await runCli(['post', '--stdin', 'proj'], env, '');
  assert.equal(empty.code, 2, 'an empty pipe is a usage error');
  assert.match(empty.stdout + empty.stderr, /nothing was piped in/, 'the stdin-specific refusal, not the generic usage line');
  const blank = await runCli(['post', '--stdin', 'proj'], env, '  \n\t\n');
  assert.equal(blank.code, 2, 'a whitespace-only pipe is refused, as on Windows');
  assert.match(blank.stdout + blank.stderr, /nothing was piped in/);
  const noProject = await runCli(['post', '--stdin'], env, 'a message with no project');
  assert.equal(noProject.code, 2, 'no project is a usage error');
  assert.match(noProject.stdout + noProject.stderr, /Usage: kosmos post/);
  assert.equal(seen.length, 0, 'no refusal may reach the board');
}));

test('#2909: a CRLF pipe loses only its trailing line endings; inner CRs and tabs are kept, as on Windows', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, 'line one\r\n\tindented\r\n\r\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'line one\r\n\tindented', 'tab and inner CR survive; the trailing CR/LF run is removed');
}));

test('#2909: control characters (ESC colors) and a leading BOM are dropped, so the body stays valid JSON', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, '\ufeff\u001b[31mred\u001b[0m done\u0007');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]._unparsable, undefined, 'the board must receive valid JSON');
  assert.equal(seen[0].text, '[31mred[0m done', 'ESC and BEL removed, BOM removed, printable text kept');
}));

test('#2909: a 2 MB piped body is sent to the board without hitting the argv limit (the stub has no text cap; the real room refuses long text with its own reason)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const big = 'x'.repeat(2 * 1024 * 1024);
  const out = await runCli(['post', '--stdin', 'proj'], env, big);
  assert.equal(out.code, 0, 'a long body must not fail to send as "could not reach": ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text.length, big.length);
}));

test('#2909: bytes that are not UTF-8 are posted (decoded by the board), not an abort', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  assert.equal(out.code, 0, 'a Latin-1 byte must not kill the command: ' + out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]._unparsable, undefined, 'the body must still be valid JSON');
  assert.equal(seen[0].text, 'caf\ufffd', 'the stray byte arrives as a replacement character, as on Windows');
}));

test('#2909: control-only input and a body over the board limit are refused and post nothing', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const ctl = await runCli(['post', '--stdin', 'proj'], env, '\u001b\u0007\n');
  assert.equal(ctl.code, 2, 'nothing left after dropping control characters is nothing piped in');
  assert.match(ctl.stdout + ctl.stderr, /nothing was piped in/);
  const quotes = await runCli(['post', '--stdin', 'proj'], env, '"'.repeat(3.5 * 1024 * 1024));
  assert.equal(quotes.code, 2, '3.5 MB of quotes escapes to about 7 MB, over the board limit, and is refused with the real reason');
  assert.match(quotes.stdout + quotes.stderr, /too large to send to the board/);
  const saved = (quotes.stdout + quotes.stderr).match(/saved at (\S+)/);
  assert.ok(saved, 'a refused piped message must be kept in a file: ' + quotes.stdout.slice(0, 300));
  const fs = require('node:fs');
  assert.equal(fs.readFileSync(saved[1], 'utf8'), '"'.repeat(3.5 * 1024 * 1024), 'the saved copy is the whole piped message');
  assert.equal(fs.statSync(saved[1]).mode & 0o777, 0o600, 'the saved copy is private');
  fs.rmSync(saved[1]);
  assert.equal(seen.length, 0);
}));

test('#2909: a long trailing run of CRLF lines is trimmed quickly (linear, not a per-character loop)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const t0 = Date.now();
  const out = await runCli(['post', '--stdin', 'proj'], env, 'c'.repeat(100) + '\r\n'.repeat(30000));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'c'.repeat(100));
  assert.ok(Date.now() - t0 < 15000, 'a quadratic trim takes over a minute on this input');
}));

test('#2909: argument-mode posts also drop control characters now (same escaper), and keep tabs', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'proj', 'a\u001bb\tc'], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'ab\tc');
}));

test('#2909: the body bound is the board request-read limit (MAX_UPLOAD) in install/kosmos, the Windows CLI and server.js', () => {
  const fs = require('node:fs');
  const bash = fs.readFileSync(CLI, 'utf8').match(/^POST_BODY_MAX_BYTES=(\d+)/m);
  const win = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8').match(/^const POST_BODY_MAX_BYTES = 6 \* 1024 \* 1024;/m);
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').match(/^const MAX_UPLOAD = 6 \* 1024 \* 1024;/m);
  assert.ok(bash && win && server, 'all three must define the 6 MB bound (bash ' + !!bash + ', windows ' + !!win + ', server ' + !!server + ')');
  assert.equal(Number(bash[1]), 6 * 1024 * 1024);
});

// A pseudo-terminal the harness never writes to: without the terminal guard, `cat` would block
// on it until the deadline. The CLI is run as `/bin/bash <cli>` (its shebang) because executing a
// script by path from pty.fork's child hung on this Mac even for a two-line script.
const PTY_HARNESS = [
  'import os, pty, sys, select, time',
  'pid, fd = pty.fork()',
  'if pid == 0:',
  '    os.execv(sys.argv[1], sys.argv[1:])',
  'out = b""',
  'deadline = time.time() + 15',
  'status = None',
  'while time.time() < deadline:',
  '    r, _, _ = select.select([fd], [], [], 0.2)',
  '    if r:',
  '        try:',
  '            out += os.read(fd, 4096)',
  '        except OSError:',
  '            pass',
  '    done, st = os.waitpid(pid, os.WNOHANG)',
  '    if done:',
  '        status = st',
  '        break',
  'if status is None:',
  '    os.kill(pid, 9); os.waitpid(pid, 0)',
  '    sys.stdout.write("TIMEOUT " + out.decode("utf8", "replace")); sys.exit(124)',
  'sys.stdout.write(out.decode("utf8", "replace"))',
  'sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 125)',
].join('\n');

function hasPython3() {
  try { require('node:child_process').execFileSync('python3', ['-c', 'import pty'], { stdio: 'ignore', timeout: 20000 }); return true; } catch { return false; }
}

test('#2909: --stdin at a terminal is refused at once instead of waiting on a silent prompt', { skip: !hasPython3() && 'needs python3 for a pseudo-terminal' }, () => withStubBoard((port, seen) => new Promise((resolve, reject) => {
  const env = { ...process.env, KOSMOS_PORT: String(port) };
  execFile('python3', ['-c', PTY_HARNESS, '/bin/bash', CLI, 'post', '--stdin', 'proj'], { env, timeout: 40000 }, (err, stdout) => {
    try {
      const code = err && typeof err.code === 'number' ? err.code : 0;
      assert.notEqual(code, 124, 'still waiting on the terminal after 15 s: ' + stdout);
      assert.equal(code, 2, stdout);
      assert.match(stdout, /nothing was piped in/);
      assert.equal(seen.length, 0);
      resolve();
    } catch (e) { reject(e); }
  });
})));

test('#2909: with Kosmos not running, a piped message is read and kept in a file, not lost', async () => {
  const env = { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, 'LIVE-PIPE-BODY');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Kosmos is not running/);
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.ok(saved, 'a live pipe cannot be replayed, so the message must be kept: ' + out.stdout);
  const fs = require('node:fs');
  assert.equal(fs.readFileSync(saved[1], 'utf8'), 'LIVE-PIPE-BODY');
  fs.rmSync(saved[1]);
});

test('#2909: the post usage line is the same sentence in install/kosmos and the Windows CLI', () => {
  const fs = require('node:fs');
  const bash = fs.readFileSync(CLI, 'utf8').match(/say "(Usage: kosmos post \[--no-reply\][^"]*)"/);
  assert.ok(bash, 'install/kosmos must carry the post usage line');
  assert.equal(bash[1].replace(/\\\$/g, '$'), require('./tools/windows/kosmos-cli').USAGE.post);
});

test('#2909: --stdin combines with --in-reply-to (#3224), in either order', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const a = await runCli(['post', '--in-reply-to', 'm9', '--stdin', 'proj'], env, 'the `answer`\n');
  const b = await runCli(['post', '--stdin', '--in-reply-to=m10', 'proj'], env, 'another $one');
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.deepEqual(seen.map((s) => [s.project, s.text, s.in_reply_to]), [['proj', 'the `answer`', 'm9'], ['proj', 'another $one', 'm10']]);
}));

test('#2909: a --stdin after the project is refused instead of posting the word and dropping the pipe', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'proj', '--stdin'], env, 'the real message');
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stdout + out.stderr, /--stdin must come before the project id/);
  assert.equal(seen.length, 0);
}));

test('#2909: a post the board declines keeps a piped message in a file instead of dumping it', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, 'PIPED-BODY-2909');
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /Not posted: there is no project by that name/);
  assert.doesNotMatch(out.stdout, /PIPED-BODY-2909/, 'the piped text is not dumped to the screen');
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.ok(saved, out.stdout);
  const fs = require('node:fs');
  assert.equal(fs.readFileSync(saved[1], 'utf8'), 'PIPED-BODY-2909');
  fs.rmSync(saved[1]);
  const arg = await runCli(['post', 'proj', 'typed words'], env);
  assert.match(arg.stdout, /here it is to keep/, 'CONTROL: argument mode still echoes the text (#2710)');
}, '{"delivery":{"state":"could_not","because":"there is no project by that name."}}'));

test('#2909: a wrong-world post whose outbox keep fails still keeps the piped message', () => withStubBoard(async (port) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_HOME: '/nonexistent-kosmos-home-2909' };
  const out = await runCli(['post', '--stdin', 'proj'], env, 'WRONG-WORLD-BODY');
  const saved = out.stdout.match(/saved at (\S+)/);
  assert.equal(out.code, 1, 'KOSMOS_HOME points nowhere, so the outbox cannot keep it: ' + out.stdout);
  assert.ok(saved, 'an outbox that could not keep it must leave the piped message in a file: ' + out.stdout);
  const fs = require('node:fs');
  assert.equal(fs.readFileSync(saved[1], 'utf8'), 'WRONG-WORLD-BODY');
  fs.rmSync(saved[1]);
}, '{"wrongWorld":true,"world":"other"}'));

test('#2909: a raw pipe over the board limit is refused at the read, not held whole or truncated', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', '--stdin', 'proj'], env, 'z'.repeat(6 * 1024 * 1024 + 10));
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /over the 6 MB the board accepts/);
  assert.doesNotMatch(out.stdout, /saved at/, 'only the start was read, so no misleading partial copy is kept');
  assert.equal(seen.length, 0);
}));

test('#2909: the dropped control-character range is one fact in both bash copies and the Windows CLI', () => {
  const fs = require('node:fs');
  const bash = fs.readFileSync(CLI, 'utf8');
  const post = bash.slice(bash.indexOf('cmd_post() {'), bash.indexOf('\n}\n', bash.indexOf('cmd_post() {')));
  const ranges = [...post.matchAll(/tr -d '(\\001[^']*)'/g)].map((m) => m[1]);
  assert.equal(ranges.length, 2, 'cmd_post drops controls at the --stdin read and in the escaper');
  assert.deepEqual(ranges, ["\\001-\\010\\013\\014\\016-\\037\\177", "\\001-\\010\\013\\014\\016-\\037\\177"]);
  const win = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  assert.ok(win.includes('/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/g'), 'the Windows CLI drops the same range (plus NUL, which bash $() drops on its own)');
});

test('#2909: an argument made only of control characters is refused, not posted empty', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'proj', '\u001b\u0007'], env);
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /empty once control characters are removed/);
  assert.equal(seen.length, 0);
}));

test('#2909: a piped message with many embedded newlines is escaped quickly', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const body = 'line\n'.repeat(300000) + 'end';
  const t0 = Date.now();
  const out = await runCli(['post', '--stdin', 'proj'], env, body);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, body, 'every embedded newline survives the escaper');
  assert.ok(Date.now() - t0 < 15000, 'the newline join is linear on 300k lines');
}));

test('#2909: without --stdin, piped input is ignored and the args are the message (unchanged behavior)', () => withStubBoard(async (port, seen) => {
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
  const out = await runCli(['post', 'proj', 'plain', 'words'], env, 'this must not be read');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, 'plain words');
}));
