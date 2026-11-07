'use strict';
/**
 * kosmos#8213: in PowerShell an apostrophe inside plain single quotes ends the quote early. With an even count the line
 * still parses and the text reaches kosmos.ps1 cut into pieces ('I can't and won't do it' arrives as "I can", "t",
 * "and", "wont do it"), which the CLI would join and send. kosmos.ps1 now reads its own line with PowerShell's parser
 * and refuses those shapes, with a sentence naming the here-string, before anything is sent. The
 * REFUSED and ALLOWED lists below each run under every PowerShell found.
 *
 * Each arm writes the agent's command line into a driver script, runs it under every PowerShell found here (pwsh, and
 * Windows PowerShell 5.1 on Windows), and reads the exit code and stderr. kosmos.ps1 is copied into a folder with no
 * runtime beside it, so a call that passes the check stops at "the runtime is missing" (exit 1) on every OS: a refused
 * call never gets that far, which is how each arm tells "refused before sending" from "went on to send".
 * Skipped where no PowerShell exists.
 *
 *   node --test engine/win32-psquote-8213.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'windows', 'kosmos.ps1');
const REFUSAL = 'PowerShell would have changed this text before kosmos saw it';
const NO_RUNTIME = 'the runtime is missing';

function shells() {
  const found = [];
  const has = (exe) => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', windowsHide: true, timeout: 20000 }).status === 0;
  if (has('pwsh')) found.push('pwsh');
  if (process.platform === 'win32' && has('powershell.exe')) found.push('powershell.exe');
  return found;
}
const SHELLS = shells();

let dir;
let bin;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psquote-8213-'));
  bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.copyFileSync(SCRIPT, path.join(bin, 'kosmos.ps1'));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

/* Runs the agent's line from a driver file, under one PowerShell: `& '<bin>\kosmos.ps1' <rest>`, or the whole line with the call at {K}. */
function run(shell, rest, name) {
  const target = path.join(bin, 'kosmos.ps1').replace(/'/g, "''");
  const driver = path.join(dir, name + '.ps1');
  const call = "& '" + target + "'";
  const line = rest.includes('{K}') ? rest.replace('{K}', call) : call + ' ' + rest;
  // A byte-order mark, so Windows PowerShell 5.1 reads the curly quotes as UTF-8 (it reads a .ps1 without one as ANSI).
  fs.writeFileSync(driver, '\ufeff' + line + '\nWrite-Output ("RC=" + $LASTEXITCODE)\n', 'utf8');
  const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const m = /RC=(-?\d+)/.exec(r.stdout || '');
  return { rc: m ? Number(m[1]) : null, err: String(r.stderr || '') + String(r.stdout || '') };
}

const REFUSED = [
  ['two apostrophes, the quote ends at the first', "msg bob 'I can't and won't do it'"],
  ['a possessive then another apostrophe', "post fleet 'the agents' work and Bob's'"],
  ['a task title cut the same way', "task add fleet 'fix what we can't and won't'"],
  ['an option value cut by apostrophes', "post fleet --topic='a's'b' hi"],
  ['a colon option value with a word touching it (rule (a): -topic: is its own token)', "post fleet -topic:'a b'x hi"],
  // Outside quotes '' is an EMPTY quoted string, which PowerShell drops: it''s arrives as its, O''Brien as OBrien.
  ['a bare it\'\'s, the apostrophe written twice outside quotes', "msg bob it''s fine"],
  ['a bare path with an apostrophe written twice', "msg bob C:\\O''Brien\\a.txt"],
  // PowerShell takes the curly quotes as quotes too, so the same cut happens with them.
  ['curly apostrophes cutting the text', "post fleet 'the agents\u2019 work and Bob\u2019s\u2019"],
  ['a quoted part touching a double-quoted part', "msg bob 'a'\"b\""],
  ['a quoted word with a hyphenated word touching it', "msg bob 'well'-known"],
];
const ALLOWED = [
  ['an apostrophe written twice', "msg bob 'it''s fine'"],
  ['plain words', 'msg bob hello there'],
  ['an option with a quoted value', "post fleet --channel='eng' hi"],
  ['a single-quoted text with no apostrophe', "msg bob 'all good'"],
  ['a double-quoted text holding an apostrophe', 'msg bob "it\'s fine"'],
  ['a here-string holding apostrophes', "msg bob @'\nit's fine, can't and won't\n'@"],
  ['an option value with an apostrophe written twice', "post fleet --topic='Bob''s' hi"],
  ['a curly-double-quoted part holding an apostrophe', "msg bob x\u201cit's\u201d"],
  ['a backtick-escaped apostrophe in a bare word', "msg bob can`'t stop"],
  ['a call after a here-string closes on the same line', "$m = @'\nhello\n'@; {K} msg bob 'ok'"],
  // {K} is where the call goes when the arm is a whole line: a later word on the line, outside this call, is not read.
  ['inside an if, a later word holding an apostrophe', "if ({K} msg bob 'hi') { $null = 1 } else { Write-Output Bob's' }"],
  ['inside an array, a later element holding an apostrophe', "$r = @({K} msg bob 'hi'), (Write-Output Bob's')"],
];

/* With no PowerShell, every arm is still registered, as a skip, so the test count does not change between machines. */
for (const shell of (SHELLS.length ? SHELLS : ['(no PowerShell here)'])) {
  const skip = SHELLS.length ? false : 'no PowerShell on this machine';
  REFUSED.forEach(([label, rest], i) => {
    test('#8213 [' + shell + '] refused before sending: ' + label, { skip }, () => {
      const r = run(shell, rest, 'refused-' + i + '-' + shell.replace(/\W/g, ''));
      assert.equal(r.rc, 2, 'exit 2, the usage refusal: ' + r.err);
      assert.ok(r.err.includes(REFUSAL), 'the sentence names what happened: ' + r.err);
      assert.ok(r.err.includes("@'"), 'and names the here-string: ' + r.err);
      assert.ok(!r.err.includes(NO_RUNTIME), 'it stopped before reaching the runtime, so nothing could be sent: ' + r.err);
    });
  });
  ALLOWED.forEach(([label, rest], i) => {
    test('#8213 [' + shell + '] not refused: ' + label, { skip }, () => {
      const r = run(shell, rest, 'allowed-' + i + '-' + shell.replace(/\W/g, ''));
      assert.ok(!r.err.includes(REFUSAL), 'no refusal sentence: ' + r.err);
      assert.ok(r.err.includes(NO_RUNTIME), 'it went on to the runtime, as before: ' + r.err);
      assert.equal(r.rc, 1, 'the missing-runtime exit, not the refusal: ' + r.err);
    });
  });
}

