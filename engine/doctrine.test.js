'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-doctrine-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');
const projects = require('./projects');
const doctrine = require('./doctrine');
const instructions = require('./instructions');
const store = require('./store');

const NOW = new Date(2026, 7, 24);

/* ── the composition, Mona Lisa's ruling ─────────────────────────────────── */

test('the span is her sentences around the sections, dated the day of the click, inside constant markers', () => {
  const span = doctrine.spanBody(defaults.missingFrom('# Mine\n'), NOW);
  assert.match(span, /^<!-- Kosmos added the working rules below on 24 Aug 2026, with your OK\./);
  assert.ok(span.endsWith('<!-- end of the working rules -->'));
  assert.ok(span.includes('## How you work, whatever the job'),
    'the heading must match a role-made agent’s file, so the two kinds of agent read the same');
  /* The DATED sentence must never be the marker: exact-match findBlock
     could not re-find it tomorrow, and the next refresh would append a
     second block. */
  assert.ok(!/\d/.test(doctrine.START) && !/\d/.test(doctrine.END));
  assert.ok(!span.includes(doctrine.START), 'the span nests its own markers');
});

test('constraint 1: the pair is registered, so neutralise knows it and a typed marker cannot mis-pair', () => {
  assert.ok(projects.ALL_MARKERS().includes(projects.DOCTRINE_START));
  assert.ok(projects.ALL_MARKERS().includes(projects.DOCTRINE_END));
  const typed = projects.neutralise('my words <!-- kosmos:doctrine:start --> more words');
  assert.ok(!typed.includes(projects.DOCTRINE_START), 'a person typing the marker keeps a live marker');
});

test('the no-em-dash rule holds for the whole span, sentences included', () => {
  const span = doctrine.spanBody(defaults.sections(), NOW);
  assert.ok(!span.includes('—') && !span.includes('–'));
});

/* ── planFor: the pure heart, one composition for dialog and write ───────── */

test('constraint 8: an old agent carrying every section as PLAIN text gets NOTHING appended', () => {
  const bornWithBlock = defaults.appendTo('# My agent\n\nMy own words.\n');
  assert.equal(doctrine.planFor(bornWithBlock, NOW).state, 'current');
});

test('a born-before agent is offered exactly its absent sections, and the file outside the span is byte-for-byte', () => {
  const file = '# My agent\n\nMy own words, which I shaped.\n\n### Never wait silently\n\nMy own version of this rule.\n';
  const plan = doctrine.planFor(file, NOW);
  assert.equal(plan.state, 'refresh');
  assert.ok(!plan.sections.some((s) => s.heading === '### Never wait silently'),
    'a section the person carries as their own text was offered anyway');
  assert.ok(plan.fileNext.startsWith(file.replace(/\n$/, '')),
    'a byte before the span moved');
  assert.ok(plan.fileNext.includes(doctrine.START) && plan.fileNext.includes(doctrine.END));
  /* One composition, two readers: what the dialog lists is what lands. */
  for (const s of plan.sections) assert.ok(plan.spanNext.includes(s.text));
});

test('constraint 4: an up-to-date span composed YESTERDAY is current TODAY; the date alone is never a change', () => {
  const yesterday = new Date(2026, 7, 23);
  const first = doctrine.planFor('# Mine\n', yesterday);
  assert.equal(first.state, 'refresh');
  const today = doctrine.planFor(first.fileNext, NOW);
  assert.equal(today.state, 'current',
    'a refresh with nothing new re-dated the sentence, which rotates the person’s .previous undo for a non-change');
});

test('a span from a smaller doctrine is brought current: span sections update, the person’s own copies outside are never duplicated', () => {
  const subset = defaults.sections().slice(0, 3);
  const oldSpan = doctrine.spanBody(subset, new Date(2026, 7, 20));
  const file = '# Mine\n\n### Never wait silently\n\nmy own version\n\n'
    + doctrine.START + '\n' + oldSpan + '\n' + doctrine.END + '\n';
  const plan = doctrine.planFor(file, NOW);
  assert.equal(plan.state, 'refresh');
  assert.ok(!plan.sections.some((s) => s.heading === '### Never wait silently'),
    'the person’s own section outside the span was pulled into ours');
  assert.ok(plan.sections.length > subset.length, 'the span did not gain the sections the doctrine grew');
  assert.ok(plan.fileNext.includes('my own version'), 'the person’s own text was lost');
  assert.equal((plan.fileNext.match(/### Never wait silently/g) || []).length, 1, 'their section got duplicated');
});

test('constraint 5: two well-formed spans refuse with a reason, and the text is untouched', () => {
  const span = doctrine.spanBody(defaults.sections().slice(0, 2), NOW);
  const file = doctrine.START + '\n' + span + '\n' + doctrine.END + '\n\nmine\n\n'
    + doctrine.START + '\n' + span + '\n' + doctrine.END + '\n';
  const plan = doctrine.planFor(file, NOW);
  assert.equal(plan.state, 'could_not');
  assert.match(plan.because, /cannot tell which is ours/);
});

/* ── refresh: the write path, driven against real files ──────────────────── */

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return path.join(dir, 'CLAUDE.md');
}
/* Rosters come from the REAL producer (test-support/fleet), never hand-built
   rows: the fixture-discipline lint enforces it, and it caught the first
   version of this file. */
const fleet = require('../test-support/fleet');
function rosterOf(name, opts) {
  const board = fleet.install([opts && opts.stranger ? fleet.stranger(name) : fleet.agent(name, { state: 'idle' })]);
  const roster = board.agents;
  board.restore();
  return roster;
}

test('refresh writes the planned composition, records the version, and a second click is a true no-op', () => {
  const file = agentFile('pena', '# Pena\n\nMy own words.\n');
  const got = doctrine.refresh('pena', rosterOf('pena'), { now: NOW });
  assert.equal(got.state, 'added', JSON.stringify(got));
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.startsWith('# Pena\n\nMy own words.'), 'a byte the person owns moved');
  assert.ok(after.includes('with your OK'));
  assert.equal(store.readProfile('pena').doctrineVersion, defaults.DOCTRINE_VERSION);
  const again = doctrine.refresh('pena', rosterOf('pena'), { now: new Date(2026, 7, 25) });
  assert.equal(again.state, 'current');
  assert.equal(fs.readFileSync(file, 'utf8'), after, 'the no-op wrote bytes anyway');
});

test('constraint 3, across the gap: a file that changed since the dialog refuses with look-again, and writes nothing', () => {
  const file = agentFile('quill', '# Quill\n');
  const plan = doctrine.planFor(fs.readFileSync(file, 'utf8'), NOW);
  fs.appendFileSync(file, '\nAn edit the person made while the dialog sat open.\n');
  const before = fs.readFileSync(file, 'utf8');
  const got = doctrine.refresh('quill', rosterOf('quill'), { now: NOW, expectHash: plan.hash });
  assert.equal(got.state, 'could_not');
  assert.match(got.because, /changed since you looked/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the refusal wrote anyway');
});

test('the roster gate holds: an untied name is refused in a sentence, nothing written', () => {
  agentFile('runa', '# Runa\n');
  const got = doctrine.refresh('runa', rosterOf('runa', { stranger: true }), { now: NOW });
  assert.equal(got.state, 'could_not');
});

test('Not now is remembered per agent, keyed on the version so a future bump un-hides the banner', () => {
  agentFile('sova', '# Sova\n');
  assert.equal(doctrine.decline('sova').declined, true);
  assert.equal(store.readProfile('sova').doctrineDeclined, defaults.DOCTRINE_VERSION);
  const st = doctrine.status('sova', NOW);
  assert.equal(st.declined, true);
  assert.equal(st.state, 'refresh', 'declining must not hide the FACT that sections are missing, only the banner');
});
