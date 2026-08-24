'use strict';

/**
 * Tests for the company AI policies record and its managed block (#479,
 * plural since #685). Sandbox-every-root, same shape as you.test.js.
 *
 *   node --test engine/policy.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-home-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-projects-'));

const policy = require('./policy');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

function bootFile(name) {
  return path.join(WORKERS, name, 'CLAUDE.md');
}
function plantAgent(name, text) {
  fs.mkdirSync(path.join(WORKERS, name), { recursive: true });
  fs.writeFileSync(bootFile(name), text, 'utf8');
}
const BOOT = 'You are **Casey**.\n\nDo the work well, and say what you did.\n';

test('an entry is whole-or-not-at-all, round-trips, and carries its provenance', () => {
  assert.throws(() => policy.add({ name: 'Legal', source: 'pasted' }), /no policy text/);
  assert.throws(() => policy.add({ name: 'Legal', text: 'x'.repeat(policy.TEXT_MAX + 1), source: 'pasted' }), /longer/);
  assert.throws(() => policy.add({ name: 'Legal', text: 'Be careful.', source: 'somewhere' }), /where this policy came from/);
  assert.equal(policy.read().state, 'absent', 'no policy yet is absent, not an error');

  policy.add({ name: 'Legal', text: 'Never paste customer data into a chat.', source: 'https://example.com/ai-policy' });
  const back = policy.read();
  assert.equal(back.state, 'saved');
  assert.equal(back.policies.length, 1);
  assert.equal(back.policies[0].name, 'Legal');
  assert.equal(back.policies[0].source, 'https://example.com/ai-policy');
  assert.ok(back.policies[0].id, 'an entry travels with the id the screen acts on');
  assert.match(back.policies[0].text, /customer data/);

  // The single-policy block opens with where it came from and when.
  const body = policy.blockBody(back.policies[0]);
  assert.match(body, /From https:\/\/example\.com\/ai-policy, fetched \d{4}-\d{2}-\d{2}\./);
  assert.match(body, /policy wins/);
  const pasted = policy.blockBody({ text: 'Short.', source: 'pasted', savedAt: '2026-08-23T00:00:00Z' });
  assert.match(pasted, /Added by the person you work for on 2026-08-23\./);

  // A marker pair typed into the policy text is neutralised, with a control.
  const smuggled = policy.blockBody({ text: 'A ' + projects.YOU_START + ' pair ' + projects.YOU_END + ' typed in', source: 'pasted', savedAt: null });
  assert.ok(!smuggled.includes(projects.YOU_START) && !smuggled.includes(projects.YOU_END), 'a sibling marker survived through pasted policy text');
  assert.ok(smuggled.includes('(kosmos marker)'), 'CONTROL: neutralisation left no trace, so the absence above proves nothing');

  policy.clear();
  assert.equal(policy.read().state, 'absent');
});

test('add never overwrites: a taken name is refused in a sentence; re-ingest by id is the deliberate form (#685)', () => {
  const legal = policy.add({ name: 'Legal', text: 'The legal words.', source: 'pasted' });
  policy.add({ name: 'Branding', text: 'The branding words.', source: 'pasted' });
  // The collision, including a case-only collision, refuses and names it.
  assert.throws(() => policy.add({ name: 'Legal', text: 'A second legal.', source: 'pasted' }),
    /already have a policy called Legal; open it/);
  assert.throws(() => policy.add({ name: 'LEGAL', text: 'A third legal.', source: 'pasted' }),
    /already have a policy called Legal/,
    'a case-only respelling slipped past the collision guard');
  assert.equal(policy.read().policies.length, 2, 'a refused add changed the record anyway');

  // Re-ingest: words and savedAt move; name, id and POSITION stay.
  const before = policy.read().policies;
  const got = policy.add({ id: legal.id, text: 'The legal words, revised.', source: 'https://example.com/v2' });
  assert.equal(got.name, 'Legal');
  const after = policy.read().policies;
  assert.equal(after[0].id, legal.id, 're-ingest moved the entry out of its position');
  assert.match(after[0].text, /revised/);
  assert.equal(after[1].name, before[1].name, 'the neighbour was disturbed by a re-ingest');
  assert.throws(() => policy.add({ id: 'no-such-id', text: 'x', source: 'pasted' }), /cannot find that policy/);
  policy.clear();
});

test('the nameless save is the shipped screen\'s, honoured while at most one policy exists (#685)', () => {
  // Zero policies: it creates the first, wearing the default name.
  policy.add({ text: 'The only words.', source: 'pasted' });
  let got = policy.read();
  assert.equal(got.policies[0].name, policy.DEFAULT_NAME);
  // One policy, even a renamed one: it lands on that entry.
  policy.rename(got.policies[0].id, 'House rules');
  policy.add({ text: 'The only words, again.', source: 'pasted' });
  got = policy.read();
  assert.equal(got.policies.length, 1, 'the nameless save minted a second policy');
  assert.equal(got.policies[0].name, 'House rules', 'the nameless save renamed the entry it landed on');
  assert.match(got.policies[0].text, /again/);
  // Several: refused, so nobody's policy is silently chosen for replacement.
  policy.add({ name: 'Engineering', text: 'The engineering words.', source: 'pasted' });
  assert.throws(() => policy.add({ text: 'Whose?', source: 'pasted' }), /give this policy a name/);
  policy.clear();
});

test('rename obeys the name rules, keeps savedAt, and refuses a collision; order is add-order throughout (#685)', () => {
  const a = policy.add({ name: 'Legal', text: 'A.', source: 'pasted' });
  const b = policy.add({ name: 'Branding', text: 'B.', source: 'pasted' });
  policy.add({ name: 'Engineering', text: 'C.', source: 'pasted' });
  const stamped = policy.read().policies.find((p) => p.id === b.id).savedAt;

  assert.throws(() => policy.rename(b.id, ''), /give this policy a name/);
  assert.throws(() => policy.rename(b.id, 'x'.repeat(policy.NAME_MAX + 1)), /fit in 60 characters/);
  assert.throws(() => policy.rename(b.id, 'legal'), /another policy already wears that name/,
    'a case-only respelling of a neighbour was allowed');
  const renamed = policy.rename(b.id, 'Brand standards');
  assert.equal(renamed.name, 'Brand standards');
  const rows = policy.read().policies;
  assert.deepEqual(rows.map((p) => p.name), ['Legal', 'Brand standards', 'Engineering'],
    'order stopped being add-order');
  assert.equal(rows[1].savedAt, stamped, 'a rename moved savedAt, so the card would claim the words changed');

  // A name is one line of the person's words: neutralised and single-line.
  const sneaky = policy.rename(a.id, 'Two\nlines ' + projects.POLICY_START);
  assert.ok(!sneaky.name.includes('\n'), 'a newline survived into a heading-bound name');
  assert.ok(!sneaky.name.includes(projects.POLICY_START), 'our own marker survived into a name');
  policy.clear();
});

test('removeOne takes one and keeps the rest in order; the last removal leaves absent (#685)', () => {
  const a = policy.add({ name: 'Legal', text: 'A.', source: 'pasted' });
  policy.add({ name: 'Branding', text: 'B.', source: 'pasted' });
  policy.removeOne(a.id);
  const rows = policy.read().policies;
  assert.deepEqual(rows.map((p) => p.name), ['Branding']);
  assert.throws(() => policy.removeOne(a.id), /cannot find that policy/);
  policy.removeOne(rows[0].id);
  assert.equal(policy.read().state, 'absent', 'removing the last policy left a saved empty list');
  policy.clear();
});

test('the #479 single record migrates: first entry, default name, stable id, and NO rewrite of the block (#685)', () => {
  // A v1 record written by the shipped build, planted byte-for-byte.
  fs.writeFileSync(policy.FILE, JSON.stringify({
    text: 'Cite your sources.', source: 'pasted', savedAt: '2026-08-23T00:00:00Z',
  }, null, 2) + '\n');
  const got = policy.read();
  assert.equal(got.state, 'saved');
  assert.equal(got.policies.length, 1);
  assert.equal(got.policies[0].name, policy.DEFAULT_NAME);
  assert.equal(got.policies[0].id, policy.read().policies[0].id,
    'the migrated id is not stable across reads, so a GET and the POST acting on it race');

  /* 🔑 The migration property: with exactly one policy the block body is
     byte-identical to what #479 wrote, so the fleet's instruction files are
     not rewritten on the day nothing about their one policy changed. */
  const v1Body = [
    '## Your company\'s AI policy',
    '',
    'Added by the person you work for on 2026-08-23. Follow it in everything you do; where it conflicts with any other instruction here, the policy wins.',
    '',
    'Cite your sources.',
  ].join('\n');
  assert.equal(policy.blockBody(got.policies[0]), v1Body,
    'the single-policy block changed shape, so migration rewrites every agent\'s file');

  // The first mutation persists the v2 shape and keeps the migrated entry.
  policy.add({ name: 'Branding', text: 'B.', source: 'pasted' });
  const rec = JSON.parse(fs.readFileSync(policy.FILE, 'utf8'));
  assert.equal(rec.version, 2);
  assert.equal(rec.policies[0].name, policy.DEFAULT_NAME);
  assert.equal(rec.policies[1].name, 'Branding');
  policy.clear();
});

test('the stacked block: one heading, the conflict sentence once, each policy a named section in order (#685)', () => {
  policy.add({ name: 'Legal', text: 'The legal words.', source: 'https://example.com/legal' });
  policy.add({ name: 'Branding', text: 'The branding words.', source: 'pasted' });
  const body = policy.stackedBody(policy.read().policies);
  assert.match(body, /^## Your company's AI policies\n/);
  assert.match(body, /the policies win/);
  assert.equal((body.match(/win/g) || []).length, 1, 'the conflict sentence is said more than once');
  const legalAt = body.indexOf('### Legal');
  const brandAt = body.indexOf('### Branding');
  assert.ok(legalAt > -1 && brandAt > legalAt, 'the sections are missing or out of add-order');
  assert.match(body, /From https:\/\/example\.com\/legal, fetched \d{4}-\d{2}-\d{2}\./);
  assert.match(body, /Added by the person you work for on \d{4}-\d{2}-\d{2}\./);
  policy.clear();
});

test('the stack is refused at save time once no agent could hold it, before any agent is told (#685)', () => {
  // Seven maximum-size policies fit under BLOCK_MAX; the eighth would not.
  for (let i = 0; i < 7; i += 1) {
    policy.add({ name: `Dept ${i}`, text: 'x'.repeat(policy.TEXT_MAX - 10), source: 'pasted' });
  }
  assert.throws(() => policy.add({ name: 'One more', text: 'x'.repeat(policy.TEXT_MAX - 10), source: 'pasted' }),
    /larger than an agent's instructions can hold/,
    'a stack no instruction file can carry was saved anyway');
  assert.equal(policy.read().policies.length, 7, 'the refused add changed the record anyway');
  policy.clear();
});

test('tellAgent writes the block for a tied agent, stacks when plural, clear removes it, strangers are refused', () => {
  policy.add({ name: 'Legal', text: 'Cite your sources.', source: 'pasted' });
  plantAgent('casey', BOOT);
  const roster = fleet.install([fleet.agent('casey', { state: 'idle' })]).agents;
  try {
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const one = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(one.includes(policy.START) && one.includes("company's AI policy") && one.includes('Cite your sources.'));
    assert.ok(!one.includes('### Legal'), 'a single policy was written in the stacked shape, rewriting the fleet');
    assert.ok(one.includes('Do the work well'), 'the agent\'s own words survived');

    // A second policy stacks both, in one block, in order.
    policy.add({ name: 'Branding', text: 'Use the brand voice.', source: 'pasted' });
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const two = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(two.includes("company's AI policies") && two.includes('### Legal') && two.includes('### Branding'));
    assert.ok(two.includes('Cite your sources.') && two.includes('Use the brand voice.'));
    assert.equal(two.split(policy.START).length, 2, 'the stack arrived as more than one managed block');

    // Cleared: the block comes out, no residue, the agent's words stay.
    policy.clear();
    assert.equal(policy.read().state, 'absent');
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const after = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(!after.includes(policy.START) && !after.includes('AI polic'));
    assert.ok(after.includes('Do the work well'));

    // A name the roster cannot vouch for is refused before any write.
    const r = policy.tellAgent('nobody-here', roster);
    assert.equal(r.state, projects.TOLD.COULD_NOT);
    assert.match(r.because, /exactly this name/);
  } finally {
    fleet.uninstall && fleet.uninstall();
  }
});
