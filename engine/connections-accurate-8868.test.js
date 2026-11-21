'use strict';

/*
 * kosmos#8868: an installed agent reported that the "Connecting providers, plugins and services" section of its own
 * instructions flipped between versions. The bad one said there is no command for the job, sent the agent to a direct
 * API read carrying a credential, and had no warning that reading GET /api/connections bills the person. Those are
 * the features of the block before #4451 (2026-09-29): "there is no one-word verb that prints accounts, so it is a
 * direct read of" GET /api/accounts with the board token, and no Connections part at all. Current main writes neither.
 *
 * This guards what the agent actually receives, not only the source string: the block as it lands in an agent's file,
 * on every regeneration, and the repair of a file that already holds the old text. connections.test.js pins the
 * source wording; this pins the file.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connaccurate-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const connections = require('./connections');
const projects = require('./projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const fileOf = (name) => path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md');
function agentFile(name, text) {
  fs.mkdirSync(path.dirname(fileOf(name)), { recursive: true });
  fs.writeFileSync(fileOf(name), text);
}
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

/* The section between Kosmos's markers, as the agent reads it. */
function section(text) {
  const a = text.indexOf(projects.CONNECTIONS_START);
  const b = text.indexOf(projects.CONNECTIONS_END);
  assert.ok(a >= 0 && b > a, 'the file has no Kosmos connections section');
  return text.slice(a + projects.CONNECTIONS_START.length, b).replace(/\s+/g, ' ');
}

/* What an accurate section must say, and what the reported bad one said. */
function assertAccurate(flat, where) {
  assert.match(flat, /`kosmos connections`/, where + ': the command that lists connected services is not named');
  assert.match(flat, /`kosmos accounts`/, where + ': the command that lists AI providers is not named');
  assert.match(flat, /never read `GET \/api\/connections` yourself/i, where + ': the direct read is not forbidden');
  assert.match(flat, /bill the person/, where + ': the billing warning is missing');
  assert.doesNotMatch(flat, /one-word verb|no such command|there is no (?:command|kosmos)/i, where + ': it says there is no command');
  assert.doesNotMatch(flat, /board token|Authorization:|Bearer /i, where + ': it sends the agent to a read carrying a credential');
}

/* The old block's own words (engine/connections.js before #4451, 6a4741fd0b^), trimmed to the lines the report names. */
const OLD_BLOCK = [
  '## How connecting a provider works',
  '',
  'Reading it right is not a one-liner, so lean on the `kosmos` CLI as the',
  'reference rather than hardcoding anything. On a board that enforces auth the read needs',
  'the board token, sent off the command line, never in argv (argv leaks it',
  'cross-account). The CLI resolves the address and sends the token safely;',
  'there is no one-word verb that prints accounts, so it is a direct read of',
  '`GET /api/accounts`.',
].join('\n');

test('kosmos#8868: CONTROL, the checks catch the old block the report describes', () => {
  /* Without this, a check that could never fail would pass the arms below. */
  assert.throws(() => assertAccurate(OLD_BLOCK.replace(/\s+/g, ' '), 'old block'));
});

test('kosmos#8868: the section written into an agent file is accurate, and stays so on every regeneration', () => {
  agentFile('steady', '# Steady\n\nYou are Steady.\n');
  const roster = [tied('steady')];
  let first = null;
  for (let i = 0; i < 3; i++) {
    const r = connections.tellAgent('steady', roster);
    assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
    const text = fs.readFileSync(fileOf('steady'), 'utf8');
    assertAccurate(section(text), 'regeneration ' + (i + 1));
    if (first === null) first = text;
    else assert.equal(text, first, 'regeneration ' + (i + 1) + ' wrote a different file');
  }
});

test('kosmos#8868: a file holding the old block is put right by the next write, and the agent\'s own text is kept', () => {
  agentFile('stale', '# Stale\n\nYou are Stale.\n\n' + projects.CONNECTIONS_START + '\n' + OLD_BLOCK + '\n' + projects.CONNECTIONS_END + '\n\nMy own note.\n');
  const r = connections.tellAgent('stale', [tied('stale')]);
  assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
  assert.equal(r.changed, true, 'the old block was left in place');
  const text = fs.readFileSync(fileOf('stale'), 'utf8');
  assertAccurate(section(text), 'after the repair');
  assert.doesNotMatch(text, /one-word verb/, 'the old words survived outside the section');
  assert.match(text, /You are Stale\./);
  assert.match(text, /My own note\./, 'the agent\'s own text after the section was lost');
  assert.equal(text.split(projects.CONNECTIONS_START).length - 1, 1, 'the repair left two sections');
});

test('kosmos#8868: the on-demand guide keeps the billing warning and never says there is no command', () => {
  const flat = connections.guideText().replace(/\s+/g, ' ');
  assert.match(flat, /To see what is connected, run `kosmos connections`/);
  assert.match(flat, /bill the person for every check/);
  assert.doesNotMatch(flat, /one-word verb|no such command|there is no (?:command|kosmos)/i);
});
