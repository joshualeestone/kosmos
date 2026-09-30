'use strict';
/**
 * kosmos#4785 (daily feedback, two installs). `kosmos --help` printed only the command names, so a person or an
 * agent had to guess what each did; and `agent list` after kosmos, the natural guess for "who is on this
 * computer", answered with a dead end that never named `kosmos agents`.
 *
 * What is held here:
 *   - the Mac help has a row with words for EVERY verb of the dispatch (read from install/kosmos, so a verb added
 *     later is red here until it is described);
 *   - `agent list` points at `kosmos agents`, and a different unknown subcommand does not (the control: a hint
 *     printed on every unknown would pass the first arm and help nobody);
 *   - an unknown top-level command names what was typed, shows the list, and still exits 2;
 *   - the Windows command describes every verb it has, and in the SAME words as the Mac for every verb they share.
 *
 * Every Mac arm pins KOSMOS_PORT at a dead port (9, discard), as cli.help-flag-1674.test.js does, so nothing
 * here can reach a real board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cli = require('./tools/windows/kosmos-cli');

const CLI = path.join(__dirname, 'install', 'kosmos');
const MAC = fs.readFileSync(CLI, 'utf8');
const DEAD = { ...process.env, KOSMOS_PORT: '9' };

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('bash', [CLI, ...args], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

/* The verbs of the final top-level dispatch, read the way the parity test reads them. */
function dispatchVerbs() {
  const start = MAC.lastIndexOf('\ncase "${1:-}" in\n');
  assert.ok(start >= 0, 'install/kosmos has no top-level dispatch any more');
  const block = MAC.slice(start, MAC.indexOf('\nesac', start));
  return [...block.matchAll(/^ {2}([a-z]+)\)/gm)].map((m) => m[1]);
}

/* `  kosmos <verb>   <words>` rows of a help text, as { verb: words }. */
function rows(text) {
  const out = {};
  for (const m of text.matchAll(/^ {2}kosmos ([a-z]+) +(\S.*)$/gm)) out[m[1]] = m[2].trim();
  return out;
}

test('#4785: kosmos --help gives every command a line saying what it does, and exits 0', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  const got = rows(r.out);
  const verbs = dispatchVerbs();
  assert.ok(verbs.length >= 20, 'read only ' + verbs.length + ' verbs from the dispatch; the reader is broken');
  for (const v of verbs) {
    assert.ok(got[v], 'kosmos --help has no row for ' + v);
    assert.ok(got[v].split(/\s+/).length >= 2, 'the row for ' + v + ' says too little: ' + got[v]);
  }
});

test('#4785: agent list points at kosmos agents; another unknown subcommand does not', async () => {
  const r = await run(['agent', 'list']);
  assert.equal(r.code, 2);
  assert.match(r.out, /Unknown: kosmos agent list/);
  assert.match(r.out, /kosmos agents\b/, 'agent list does not name the command that lists agents');
  const control = await run(['agent', 'frobnicate']);
  assert.equal(control.code, 2);
  assert.match(control.out, /Unknown: kosmos agent frobnicate/);
  assert.doesNotMatch(control.out, /kosmos agents\b/, 'the hint is printed on every unknown subcommand, not on a listing guess');
});

test('#4785: an unknown command names what was typed, shows the list, and still exits 2; bare kosmos still exits 2', async () => {
  const r = await run(['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.out, /Unknown: kosmos frobnicate/);
  assert.ok(rows(r.out).agents, 'the unknown-command answer does not show the list');
  const bare = await run([]);
  assert.equal(bare.code, 2);
  assert.doesNotMatch(bare.out, /Unknown:/, 'bare kosmos is not an unknown command');
});

test('#4785: the Windows command describes every verb, in the Mac\'s words where they share one', async () => {
  const out = [];
  const code = await cli.main(['--help'], { env: {}, out: (s) => out.push(s), err: (s) => out.push(s) });
  assert.equal(code, 0);
  const win = rows(out.join('\n'));
  const mac = rows((await run(['--help'])).out);
  for (const v of cli.VERBS) {
    assert.ok(win[v], 'the Windows help has no row for ' + v);
    if (mac[v]) assert.equal(win[v], mac[v], v + ': the Windows and Mac help disagree');
  }
  const unknown = [];
  assert.equal(await cli.main(['frobnicate'], { env: {}, out: (s) => unknown.push(s), err: (s) => unknown.push(s) }), 2);
  assert.match(unknown.join('\n'), /Unknown: kosmos frobnicate/);
});
