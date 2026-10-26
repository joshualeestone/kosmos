'use strict';
/* kosmos#7194: when the login-expiry notices change, the board log records, per named agent, the config folder the board
 * read and the process it read it from (status.logLoginAdvReads, called by computeLoginAdvisories). Josh's board once
 * named eight agents on a login they had left, and nothing recorded what had been read.
 *   node --test engine/loginadvlog-7194.test.js
 * Pane fixtures use test-support/fleet.line (fixture-discipline). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'le-advlog-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const status = require('./status');
const fleet = require('../test-support/fleet');

const DAY = 86400000;
const NOW = 1_000_000_000_000;
const paneOf = (spec) => status.parsePanes(fleet.line(spec))[0];

function run(readDetail, logState, lines, expiresIn = 1) {
  const panes = [paneOf({ session: 'casey-discord', pane: '0.0' }), paneOf({ session: 'donnie-discord', pane: '0.1' })];
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: NOW + expiresIn * DAY } });
  return status.computeLoginAdvisories(panes, NOW, {
    readDetail, readCred, cache: { at: 0, value: [] }, log: (l) => lines.push(l), logState,
    displayName: (n) => n, emailOf: () => 'old@example.com',
  });
}

test('#7194: a raised notice logs, per named agent, the folder read and the process it came from', () => {
  const lines = [];
  const state = { sig: '' };
  const readDetail = (a) => ({ ccd: '/Users/agent1/.claude', pid: a.name === 'casey' ? '16489' : '17294' });
  const out = run(readDetail, state, lines);
  assert.equal(out.length, 1, 'CONTROL: the fixture raises one notice');
  assert.equal(lines.length, 2, 'not one line per named agent: ' + JSON.stringify(lines));
  const casey = lines.find((l) => / casey read /.test(l));
  assert.match(casey, /^\[loginadv\] #7194: casey read CLAUDE_CONFIG_DIR=\/Users\/agent1\/\.claude from ps eww of pid 16489 \(pane casey-discord:0\.0\), in the notice for old@example\.com \(Claude Code-credentials-[0-9a-f]+\), expires in 1 day$/);
  assert.ok(lines.some((l) => / donnie read .* pid 17294 /.test(l)), 'donnie\'s process is not named');
});

test('#7194: the same notices again write nothing; a change writes again; clearing says so once', () => {
  const lines = [];
  const state = { sig: '' };
  const onOld = () => ({ ccd: '/Users/agent1/.claude', pid: '1' });
  run(onOld, state, lines);
  const first = lines.length;
  run(onOld, state, lines);
  assert.equal(lines.length, first, 'an unchanged notice was logged again');
  run(onOld, state, lines, 0);   // the same agents, a day later: the notice changed
  assert.equal(lines.length, first + 2, 'a changed notice was not logged');
  const none = () => ({ ccd: undefined, pid: null });   // unreadable: nobody is named, so no notice
  run(none, state, lines);
  assert.equal(lines[lines.length - 1], '[loginadv] #7194: no login notice now');
  const after = lines.length;
  run(none, state, lines);
  assert.equal(lines.length, after, 'the cleared state was logged twice');
});

test('#7194: an agent read with no CLAUDE_CONFIG_DIR is logged as the default login, not as a folder', () => {
  const lines = [];
  run(() => ({ ccd: null, pid: '42' }), { sig: '' }, lines);
  assert.ok(lines.length >= 1, 'CONTROL: a notice was raised');
  assert.match(lines[0], /read no CLAUDE_CONFIG_DIR \(the default login\) from ps eww of pid 42 /);
});

test('#7194: nothing is logged while there is no notice at all (the board starts quiet)', () => {
  const lines = [];
  const state = { sig: '' };
  run(() => ({ ccd: '/x', pid: '1' }), state, lines, 30);   // 30 days left: outside the warning window
  assert.deepEqual(lines, [], 'a board with no notice wrote lines');
});

test('#7194 review 1: the line names the program read, says "today" at 0 days, and a changed email is a change', () => {
  const lines = [];
  const state = { sig: '' };
  const reads = new Map([['casey', { ccd: '/x', pid: '7', cmd: 'claude', target: 'casey-discord:0.0' }]]);
  const adv = (email, daysLeft) => [{ service: 's', email, daysLeft, expired: false, agents: ['casey'] }];
  status.logLoginAdvReads(adv('a@example.com', 0), reads, (l) => lines.push(l), state);
  assert.match(lines[0], / from ps eww of pid 7 \(claude\) \(pane casey-discord:0\.0\), in the notice for a@example\.com \(s\), expires today$/);
  status.logLoginAdvReads(adv('a@example.com', 0), reads, (l) => lines.push(l), state);
  assert.equal(lines.length, 1, 'CONTROL: the same notice wrote again');
  status.logLoginAdvReads(adv('b@example.com', 0), reads, (l) => lines.push(l), state);
  assert.equal(lines.length, 2, 'a notice whose email changed was not logged');
});

test('#7194 review 2: the program is the base name of `ps -o comm=`, a path with a space in it included', () => {
  const real = require('node:child_process').execFileSync('ps', ['-o', 'comm=', '-p', String(process.pid)], { encoding: 'utf8' });
  assert.equal(status.cmdFromPsComm(real), nodePath.basename(process.execPath).replace(/[^\w.@+-]/g, ''), 'not this process: ' + JSON.stringify(real));
  assert.equal(status.cmdFromPsComm('/Users/a/Library/Application Support/Kosmos/bin/claude\n'), 'claude');
  assert.equal(status.cmdFromPsComm('/opt/x/evil;name$(id)\n'), 'evilnameid', 'characters outside the name set are dropped');
  assert.equal(status.cmdFromPsComm('/x/' + 'a'.repeat(100)).length, 64);
  assert.equal(status.cmdFromPsComm(''), null);
  assert.equal(status.cmdFromPsComm(undefined), null);
});
