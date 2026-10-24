'use strict';

/**
 * #6726: `kosmos reply --file <path>` sends the path to the board, which copies the file and
 * checks it is the agent's own (server.reply-file-6726.test.js covers the board). These arms
 * cover what the command adds: the flag in both spellings and in any position before `--`, a
 * relative path made absolute, no words needed, its refusals, a wrong-world board (a reply with
 * a file is not kept for later), and the usage line. Same stub-board harness as
 * cli.reply-stdin-4582.test.js; the data root is a temp folder so the CLI never reads this
 * machine's real board token, and the stub listens on a port the system picks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reply-file-')));
const HOME = path.join(DATA, 'home');
fs.mkdirSync(HOME);
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

function runCli(args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env: env, cwd: cwd || DATA, timeout: 20000 }, (err, stdout, stderr) => {   // written out: the #4796 guard reads `env:`
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/reply')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; }
        seen.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(reply || '{"kept":true}');
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

/* A minimal environment (review r6 finding 6): only what the command needs, so nothing of the machine running the
   tests (its own board token, agent token, world, or a real KOSMOS_PORT) can reach the stub or change the answer. */
const envFor = (port) => ({ PATH: process.env.PATH, HOME, TMPDIR: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', AGENT_WORKFORCE_DATA: DATA, KOSMOS_HOME: HOME });

test('#6726: --file sends an absolute path with the words, and says what was attached', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--file', '/x/Files/cut.mp4', 'Here', 'it', 'is'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].file, '/x/Files/cut.mp4');
  assert.equal(seen[0].text, 'Here it is');
  assert.match(out.stdout, /Sent, with cut\.mp4 attached\. It is in their conversation with you\./);
}));

test('#6726: a relative path is made absolute from where the command runs', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--file=Files/notes.md', 'notes'], envFor(port), DATA);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].file, path.join(DATA, 'Files', 'notes.md'));
}));

test('#6726: --file after the words is still the flag; past -- it is words', () => withStubBoard(async (port, seen) => {
  const late = await runCli(['reply', 'the cut', '--file', '/x/a.mov'], envFor(port));
  assert.equal(late.code, 0, late.stdout + late.stderr);
  assert.equal(seen[0].file, '/x/a.mov');
  assert.equal(seen[0].text, 'the cut');
  const words = await runCli(['reply', '--', 'use', '--file', 'to', 'attach'], envFor(port));
  assert.equal(words.code, 0, words.stdout + words.stderr);
  assert.equal(seen[1].file, undefined, 'a --file past -- was taken as the flag');
  assert.equal(seen[1].text, 'use --file to attach');
}));

test('#6726: --file needs no words (the board names the message after the file)', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--file', '/x/Files/report.pdf'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].text, '');
  assert.equal(seen[0].file, '/x/Files/report.pdf');
}));

test('#6726 CONTROL: with no file and no words it is still the usage, which now names --file', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply'], envFor(port));
  assert.equal(out.code, 2);
  assert.equal(seen.length, 0);
  assert.match(out.stdout, /Usage: kosmos reply \[--stdin\]/);
  assert.match(out.stdout, /kosmos reply --file <path>/);
}));

test('#6726: refusals send nothing (twice, no path, an option as the path)', () => withStubBoard(async (port, seen) => {
  const twice = await runCli(['reply', '--file', '/a', '--file', '/b', 'x'], envFor(port));
  assert.equal(twice.code, 2);
  assert.match(twice.stdout, /--file was given twice/);
  for (const args of [['reply', '--file'], ['reply', '--file='], ['reply', '--file', '--stdin'], ['reply', '--file', '--']]) {
    const r = await runCli(args, envFor(port));
    assert.equal(r.code, 2, args.join(' ') + ': ' + r.stdout);
    assert.match(r.stdout, /--file needs the path of the file to attach/, args.join(' '));
  }
  assert.equal(seen.length, 0, 'a refused --file reached the board');
}));

test('#6726: the board\'s refusal is said, and the command fails', () => withStubBoard(async (port) => {
  const out = await runCli(['reply', '--file', '/etc/hosts', 'x'], envFor(port));
  assert.equal(out.code, 1);
  assert.match(out.stdout, /That was not kept: only a file directly in your Files folder/);
}, '{"kept":false,"because":"only a file directly in your Files folder, or inside the folder of a project you are on, can be attached"}'));

test('#6726: on a wrong-world board a reply with a file is not kept for later', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--file', '/x/a.pdf', 'x'], envFor(port));
  assert.equal(out.code, 1, out.stdout);
  assert.match(out.stdout, /a reply with a file is not kept for later/);
  assert.equal(seen.length, 1);
  assert.ok(!fs.existsSync(path.join(HOME, 'outbox')) || fs.readdirSync(path.join(HOME, 'outbox')).length === 0, 'it was put in the outbox');
}, '{"wrongWorld":true,"world":"other"}'));

test('#6726 r1-7: a path with a line break, a tab or another control character is refused, and nothing is sent', () => withStubBoard(async (port, seen) => {
  for (const bad of ['/x/Files/two\nlines.txt', '/x/Files/tab\there.txt', '/x/Files/bell\u0007.txt', 'rel\u001fative.txt']) {
    const r = await runCli(['reply', '--file', bad, 'x'], envFor(port));
    assert.equal(r.code, 2, JSON.stringify(bad) + ': ' + r.stdout);
    assert.match(r.stdout, /control character in it, so it cannot be attached/, JSON.stringify(bad));
  }
  assert.equal(seen.length, 0, 'a path with a control character reached the board');
  /* CONTROL: quotes, a backslash and non-ASCII letters arrive exactly as written, as valid JSON. */
  const ok = await runCli(['reply', '--file', '/x/Files/say "hi" \\ café.txt', 'x'], envFor(port));
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(seen[0].file, '/x/Files/say "hi" \\ café.txt');
}));

test('#6726 r3-6: the command names the file as the board saved it (a link names the file it points at)', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['reply', '--file', '/x/Files/report-link.pdf', 'here'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen[0].file, '/x/Files/report-link.pdf');
  assert.match(out.stdout, /Sent, with notes-real\.txt attached\./);
  assert.doesNotMatch(out.stdout, /report-link\.pdf attached/);
}, '{"kept":true,"because":null,"attached":"notes-real.txt"}'));

test('#6726 r4-5: a saved name the board had to escape (a double quote) falls back to the given name, never cut', () => withStubBoard(async (port) => {
  const out = await runCli(['reply', '--file', '/x/Files/say "hi".txt', 'here'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Sent, with say "hi"\.txt attached\./);
}, '{"kept":true,"because":null,"attached":"say \\"hi\\".txt"}'));
