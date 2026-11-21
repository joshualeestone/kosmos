'use strict';

/*
 * kosmos#8868: an installed agent reported that the "Connecting providers, plugins and services" section of its own
 * instructions flipped between versions. The bad one said there is no command for the job, sent the agent to a direct
 * API read carrying a credential, and had no warning that reading GET /api/connections bills the person. Those are
 * the features of the block before #4451 (2026-09-29): "there is no one-word verb that prints accounts, so it is a
 * direct read of" GET /api/accounts with the board token, and no Connections part at all. Current main writes neither.
 *
 * This guards the block as current Kosmos writes it into an agent's file, and the repair of a file that already holds
 * the old text; connections.test.js pins the source wording. It cannot see a writer running other code (an older
 * Kosmos, or a board started from an old checkout), which is where the reported flip most likely came from; it makes
 * sure the next write from this code puts the accurate block back, and that every writer here uses the one text.
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

/* Paraphrased from the block of 2026-09-03 to 09-29 (engine/connections.js at 6a4741fd0b^, lines 116-121), keeping the
   features the report names: no command, a direct read carrying the board token, and no billing warning. */
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

test('kosmos#8868: CONTROL, each check fails on its own bad feature, and the accurate block passes them all', () => {
  /* One control per check: a single assert.throws on the old block stops at the first check that fires, so the
     no-command and credential checks would never be shown to work (review round 1). */
  const good = connections.blockBody().replace(/\s+/g, ' ');
  assertAccurate(good, 'today\'s block');
  const cases = [
    [good.replace('`kosmos connections`', '`the connections list`'), /the command that lists connected services is not named/],
    [good.replace('`kosmos accounts`', '`the accounts list`'), /the command that lists AI providers is not named/],
    [good.replace(/never read `GET \/api\/connections` yourself/i, 'read `GET /api/connections`'), /the direct read is not forbidden/],
    [good.replace(/bill the person/, 'cost nothing'), /the billing warning is missing/],
    [good + ' There is no one-word verb that prints accounts.', /it says there is no command/],
    [good + ' Send the board token with the read.', /it sends the agent to a read carrying a credential/],
  ];
  for (const [text, why] of cases) {
    assert.notEqual(text, good, 'a control case did not change the text: ' + why);
    assert.throws(() => assertAccurate(text, 'control'), why);
  }
  assert.throws(() => assertAccurate(OLD_BLOCK.replace(/\s+/g, ' '), 'old block'));
});

test('kosmos#8868: the section written into an agent file is accurate, and stays so on every regeneration', () => {
  agentFile('steady', '# Steady\n\nYou are Steady.\n');
  const roster = [tied('steady')];
  let first = null;
  for (let i = 0; i < 3; i++) {
    const r = connections.tellAgent('steady', roster);
    assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
    assert.equal(r.changed, i === 0, 'only the first write changes the file; regeneration ' + (i + 1));
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

test('kosmos#8868: every writer of the Connections markers writes blockBody(), so no second text exists in this code', () => {
  /* The block is written by connections.tellAgent and, for an imported agent, by discover.js (review round 1). A third
     writer with its own words would bring the flip back from current code; this fails when one appears. Writers are
     found by the marker: a spliceBlock call naming the Connections markers, or a file that binds CONNECTIONS_START to a
     name of its own and calls spliceBlock (only connections.js may, and its START is checked to be that marker). */
  assert.equal(connections.START, projects.CONNECTIONS_START);
  assert.equal(connections.END, projects.CONNECTIONS_END);
  const writers = [];
  const aliasing = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js') || f === 'projects.js') continue;
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    if (/CONNECTIONS_START/.test(src) && /spliceBlock\(/.test(src)) aliasing.push(f);
    src.split('\n').forEach((line, i) => {
      if (/spliceBlock\(/.test(line) && /CONNECTIONS_START|connMod\.START|connections\.START/.test(line)) writers.push({ where: f + ':' + (i + 1), line });
    });
  }
  assert.deepEqual(aliasing, ['connections.js'], 'a file other than connections.js binds the Connections marker and splices');
  // CONTROL: the sweep sees the import writer, so an empty result can never pass for "no stray writer".
  assert.ok(writers.some((w) => w.where.startsWith('discover.js')), 'the sweep did not find the import writer: ' + JSON.stringify(writers));
  for (const w of writers) {
    assert.match(w.line, /\bblockBody\(\)/, w.where + ' writes the Connections markers without blockBody(): ' + w.line.trim());
  }
  // connections.js splices with its own START/END, bound above to the real markers: its call must pass blockBody().
  assert.match(fs.readFileSync(path.join(__dirname, 'connections.js'), 'utf8'), /spliceBlock\([^)]*blockBody\(\), START, END\)/);
});
