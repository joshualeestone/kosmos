'use strict';
/*
 * kosmos#8905: on the Mac, `kosmos community post`, `comment`, `edit` and `endorse` with no words, and `kosmos feedback
 * triage --cards -`, read stdin by a bare $(cat), so an open pipe nobody writes to waited for ever. Now each reads it
 * through #8899's _read_stdin_quiet with its Windows twin's limit: 3 s for the four community verbs
 * (STDIN_QUIET_LIMIT_MS), 120 s for the card list (CARDS_STDIN_QUIET_LIMIT_MS). On a refusal nothing is sent.
 * CONTROLS: a body piped in whole is never refused.
 *
 * The real CLI against a throwaway data folder and a dead loopback port, as cli.feedback-quiet-stdin-8899.test.js does.
 * The 120 s limit is tested on a COPY of the CLI with that one constant set to 1, so the test needs no seam in the CLI
 * and no limit is ever taken from the caller's environment (#8899 review 1); a separate test pins the real constants to
 * the Windows CLI's, so the copy cannot drift from what ships.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const WIN_CLI = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');
const ID = '11111111-1111-4111-8111-111111111111';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cmquiet-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cmquiet-data-'));
  return { home, data };
}

/* stdin: a string is written and the pipe closed; { partial } is written and the pipe left OPEN; { open: true } writes
   nothing and leaves the pipe open. The pipe is closed after the CLI exits, so an open case can never leak. */
function run(cli, args, { home, data }, stdin) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const started = Date.now();
    const child = spawn('bash', [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let both = '';
    child.stdout.on('data', (d) => { both += d; });
    child.stderr.on('data', (d) => { both += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      clearTimeout(killer);
      try { child.stdin.destroy(); } catch {}
      const res = { code: exitCode, both, ms: Date.now() - started };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + ') after ' + res.ms + ' ms: it hung')); return; }
      resolve(res);
    });
    child.stdin.on('error', () => {});
    if (typeof stdin === 'string') child.stdin.end(stdin);
    else if (stdin && typeof stdin.partial === 'string') child.stdin.write(stdin.partial);
    else if (!(stdin && stdin.open)) child.stdin.end();
  });
}

const VERBS = [
  { args: ['community', 'post'], verbed: 'posted', noun: 'post' },
  { args: ['community', 'comment', ID], verbed: 'sent', noun: 'comment' },
  { args: ['community', 'edit', 'post', ID], verbed: 'changed', noun: 'text' },
  { args: ['community', 'endorse', 'someagent', '4'], verbed: 'sent', noun: 'review' },
];

for (const v of VERBS) {
  const name = 'kosmos ' + v.args.slice(0, 2).join(' ');
  test('#8905 ' + name + ': an open pipe with nothing on it is refused within its 3 s, and nothing is sent', async () => {
    const h = makeHome();
    const r = await run(CLI, v.args, h, { open: true });
    assert.equal(r.code, 2, r.both);
    assert.match(r.both, new RegExp('Nothing was ' + v.verbed + ': nothing arrived on stdin for 3 seconds'));
    assert.doesNotMatch(r.both, /Kosmos is not running, so nothing was/, 'it reached the send: ' + r.both);
    assert.ok(r.ms >= 2500 && r.ms < 15000, 'it waited ' + r.ms + ' ms');
  });
  test('#8905 ' + name + ': words that stop without the pipe ending are refused as maybe cut short', async () => {
    const h = makeHome();
    const r = await run(CLI, v.args, h, { partial: 'half of a ' + v.noun });
    assert.equal(r.code, 2, r.both);
    assert.match(r.both, new RegExp('Nothing was ' + v.verbed + ': the piped ' + v.noun + ' stopped arriving for 3 seconds without ending, so it may be cut short'));
    assert.doesNotMatch(r.both, /Kosmos is not running, so nothing was/, 'it reached the send: ' + r.both);
  });
  test('#8905 ' + name + ': CONTROL, a body piped in whole is read and reaches the send', async () => {
    const h = makeHome();
    const r = await run(CLI, v.args, h, 'a whole ' + v.noun + ', piped in and ended\n');
    assert.doesNotMatch(r.both, /Nothing was \w+: (nothing arrived on stdin|the piped)/, r.both);
    /* A body lost on its way would be refused as empty ("Nothing to post: ..."); one that arrived goes on to the send,
       which the dead port answers. */
    assert.doesNotMatch(r.both, /Nothing to (post|send|change|review)|needs some (text|words)/, r.both);
    assert.match(r.both, new RegExp('Kosmos is not running, so nothing was ' + v.verbed), r.both);
    assert.ok(r.ms < 15000, 'a whole body must not hang (' + r.ms + ' ms)');
  });
}

/* The triage card list, on a copy of the CLI whose card-list limit is 1 s. 1 s, not the default 3 s, so a triage line
   that forgot to pass its own constant (and used the 3 s default) says "for 3 seconds" and fails the match below. */
function cliWithCardsLimit(seconds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cmquiet-cli-'));
  const src = fs.readFileSync(CLI, 'utf8');
  const out = src.replace(/^KOSMOS_STDIN_CARDS_QUIET_S=120$/m, 'KOSMOS_STDIN_CARDS_QUIET_S=' + seconds);
  assert.notEqual(out, src, 'the CLI no longer sets KOSMOS_STDIN_CARDS_QUIET_S=120 on a line of its own');
  const copy = path.join(dir, 'kosmos');
  fs.writeFileSync(copy, out, { mode: 0o755 });
  return copy;
}

test('#8905 kosmos feedback triage --cards -: an open, silent pipe is refused within the card-list limit (its own, not the 3 s one)', async () => {
  const h = makeHome();
  const r = await run(cliWithCardsLimit(1), ['feedback', 'triage', '--cards', '-'], h, { open: true });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was triaged: nothing arrived on stdin for 1 seconds\. Part of a list would show filed items as new/);
  assert.ok(r.ms >= 700 && r.ms < 15000, 'it waited ' + r.ms + ' ms');   // the "for 1 seconds" above, not the clock, proves its own limit was used (review: a tight bound flakes under load)
});

test('#8905 kosmos feedback triage --cards -: a card list that stops without ending is refused, nothing triaged', async () => {
  const h = makeHome();
  const r = await run(cliWithCardsLimit(1), ['feedback', 'triage', '--cards', '-'], h, { partial: '#1234 a card\n' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was triaged: the piped card list stopped arriving for 1 seconds without ending, so it may be cut short/);
});

test('#8905 review 4: kosmos feedback triage --cards -: white space then quiet is refused, never triaged as an empty list', async () => {
  const h = makeHome();
  const r = await run(cliWithCardsLimit(1), ['feedback', 'triage', '--cards', '-'], h, { partial: '\n  \n' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was triaged: the piped card list stopped arriving for 1 seconds without ending/);
  assert.doesNotMatch(r.both, /triage read this computer's own reports/, r.both);
});

test('#8905 kosmos feedback triage --cards -: CONTROL, a card list piped in whole is read and triage goes on', async () => {
  const h = makeHome();
  const r = await run(CLI, ['feedback', 'triage', '--cards', '-'], h, '#1234 a card\n');
  assert.doesNotMatch(r.both, /Nothing was triaged/, r.both);
  /* It got past the reader and ran. With no reports there is nothing to match the list against, so this cannot show
     the list's own effect; the refusal tests above are what pin the reading. */
  assert.equal(r.code, 0, r.both);
  assert.match(r.both, /triage read this computer's own reports/, r.both);
  assert.ok(r.ms < 15000, 'a whole list must not hang (' + r.ms + ' ms)');
});

test('#8905 the Mac limits are the Windows CLI\'s: 3 s for a body, 120 s for a card list', () => {
  const mac = fs.readFileSync(CLI, 'utf8');
  const win = fs.readFileSync(WIN_CLI, 'utf8');
  const macBody = Number((/^KOSMOS_STDIN_QUIET_S=(\d+)/m.exec(mac) || [])[1]);
  const macCards = Number((/^KOSMOS_STDIN_CARDS_QUIET_S=(\d+)$/m.exec(mac) || [])[1]);
  const winBody = Number((/^const STDIN_QUIET_LIMIT_MS = (\d+);/m.exec(win) || [])[1]);
  const winCards = Number((/^const CARDS_STDIN_QUIET_LIMIT_MS = (\d+);/m.exec(win) || [])[1]);
  assert.ok(macBody > 0 && macCards > 0 && winBody > 0 && winCards > 0, 'a limit was not found: ' + [macBody, macCards, winBody, winCards]);
  assert.equal(macBody * 1000, winBody);
  assert.equal(macCards * 1000, winCards);
});

test('#8905 the literal $(cat) appears in no Mac CLI command line any more, except the terminal read', () => {
  const lines = fs.readFileSync(CLI, 'utf8').split('\n');
  const bare = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\$\(cat\)/.test(l) && !/^\s*#/.test(l) && !/\[ -t 0 \]/.test(l));   // the reader's own terminal read
  assert.deepEqual(bare.map(([n, l]) => n + ': ' + l.trim().slice(0, 120)), []);
});

test('#8905 review: with no node at all (no bundled one, none on PATH), a silent pipe is refused at once, never waited on', async (t) => {
  const h = makeHome();
  fs.rmSync(path.join(h.home, 'runtime'), { recursive: true, force: true });   // no bundled node
  /* The CLI puts the chosen tmux's folder first on PATH (a system tmux in /opt/homebrew/bin brings that folder's node
     with it), so give it a stand-in bundled tmux, which it keeps off PATH, and no known system ones. */
  const tmuxStub = path.join(h.home, 'tmux', 'bin', 'tmux');
  fs.mkdirSync(path.dirname(tmuxStub), { recursive: true });
  fs.writeFileSync(tmuxStub, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const bare = '/usr/bin:/bin';
  if (fs.existsSync('/usr/bin/node') || fs.existsSync('/bin/node')) { t.skip('this machine has a node on the bare PATH, so the case cannot be made here'); return; }
  const r = await new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: bare, KOSMOS_TMUX_KNOWN: '', AGENT_WORKFORCE_TMUX_BIN: tmuxStub, KOSMOS_HOME: h.home, AGENT_WORKFORCE_DATA: h.data, KOSMOS_PORT: '9', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const started = Date.now();
    const child = spawn('/bin/bash', [CLI, 'community', 'post'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let both = '';
    child.stdout.on('data', (d) => { both += d; });
    child.stderr.on('data', (d) => { both += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      try { child.stdin.destroy(); } catch {}
      const res = { code, both, ms: Date.now() - started };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + ') after ' + res.ms + ' ms: it hung')); return; }
      resolve(res);
    });
    child.stdin.on('error', () => {});
  });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was posted: the piped post could not be read/);
  assert.ok(r.ms < 10000, 'it waited ' + r.ms + ' ms for a pipe it could never read');
});
