'use strict';
/**
 * Smart triage for the daily product-feedback reports (kosmos#2246). The module
 * is pure -- it takes reports and open-card titles as arguments and returns a
 * draft digest -- so these tests need no disk or network sandbox.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const triage = require('./feedback-triage');

test('parseItems splits a real report shape into items, dropping headings and folding continuations', () => {
  const body = [
    '## What did not work',
    '',
    '- The create form hangs when I pick GPT and there is no key saved.',
    '- Model picker showed snapshots twice',
    '  extra detail on the second line about the duplicate rows',
    '',
    'The dock icon is easy to lose among other apps.',
    '',
    '### Suggestions',
    '* Add a confirm before the big download',
  ].join('\n');
  const items = triage.parseItems(body);
  assert.equal(items.length, 4, 'expected 4 items (2 bullets, 1 paragraph, 1 suggestion), got ' + JSON.stringify(items));
  assert.match(items[0], /create form hangs/);
  // The wrapped continuation folded into the bullet it belongs to.
  assert.match(items[1], /snapshots twice extra detail on the second line/);
  assert.match(items[2], /dock icon is easy to lose/);
  assert.match(items[3], /confirm before the big download/);
  // No heading text leaked in as an item.
  assert.ok(!items.some((i) => /^What did not work$/i.test(i) || /^Suggestions$/i.test(i)));
});

test('parseItems folds a bullet only when it is MORE indented than the current item, not by an absolute depth', () => {
  // A whole list that happens to be indented (every bullet at 4 spaces) must
  // stay N items, not collapse into one with the rest folded in.
  const indentedList = [
    '    - first indented point',
    '    - second indented point',
    '    - third indented point',
  ].join('\n');
  assert.equal(triage.parseItems(indentedList).length, 3, 'a uniformly-indented list collapsed into one item');

  // A genuine sub-bullet (more indented than its parent) folds into the parent.
  const nested = [
    '- parent point about the export',
    '    - a detail under the parent',
    '- second top-level point',
  ].join('\n');
  const items = triage.parseItems(nested);
  assert.equal(items.length, 2, 'a nested sub-bullet should fold into its parent, leaving 2 items');
  assert.match(items[0], /parent point about the export a detail under the parent/);
});

test('classify scores an actionable specific high and pure sentiment as noise', () => {
  const actionable = triage.classify('The create form hangs when I pick GPT and no key is saved');
  assert.ok(actionable.score >= 1, 'an actionable bug report should clear the bar: ' + JSON.stringify(actionable));
  assert.ok(actionable.reasons.some((r) => /change or fix/.test(r)));

  const sentiment = triage.classify('I really love this, it is great and awesome');
  assert.equal(sentiment.score, 0, 'pure sentiment must be below the bar');
  assert.ok(sentiment.reasons.some((r) => /sentiment/.test(r)));

  const fragment = triage.classify('nice');
  assert.equal(fragment.score, 0, 'a one-word fragment is noise');
  assert.ok(fragment.reasons.some((r) => /too short/.test(r)));

  // A visual/layout bug is a real report even without the classic error words.
  const visual = triage.classify('the export button label overlaps the icon');
  assert.ok(visual.score >= 1, 'a layout bug (overlaps) should clear the bar, not land in noise: ' + JSON.stringify(visual));
});

test('similar phrasings of one issue cluster together; unrelated ones do not', () => {
  const a = 'the model picker shows the same model twice as duplicate rows';
  const b = 'model picker is showing duplicate rows for the same model twice';
  const c = 'the dock icon is hard to find among other applications';
  assert.ok(triage.similarity(a, b) >= 0.6, 'two phrasings of the duplicate-rows issue should be similar: ' + triage.similarity(a, b));
  assert.ok(triage.similarity(a, c) < 0.3, 'unrelated items should not be similar: ' + triage.similarity(a, c));

  const entries = [{ text: a, date: '2026-09-01' }, { text: b, date: '2026-09-02' }, { text: c, date: '2026-09-02' }];
  const clusters = triage.groupDuplicates(entries, 0.6);
  assert.equal(clusters.length, 2, 'the two duplicate-rows items should collapse to one cluster, leaving 2 total');
});

test('groupDuplicates is true single-linkage: a transitive chain clusters regardless of input order', () => {
  // A~B and B~C but A!~C (B is the bridge). A forward-only pass leaves C in its
  // own cluster when the input arrives as [A,C,B], because C is only compared
  // to A. True single-linkage must give ONE cluster in either order.
  const A = 'export button missing its label';
  const B = 'export button label overlaps the icon';
  const C = 'the icon overlaps the timestamp';
  assert.ok(triage.similarity(A, B) >= 0.3 && triage.similarity(B, C) >= 0.3, 'chain links must hold');
  assert.ok(triage.similarity(A, C) < 0.3, 'the chain ends must NOT be directly similar, or the test is not testing single-linkage');
  const mk = (arr) => arr.map((t, i) => ({ text: t, date: '2026-09-0' + (i + 1) }));
  assert.equal(triage.groupDuplicates(mk([A, B, C]), 0.3).length, 1, '[A,B,C] should be one cluster');
  assert.equal(triage.groupDuplicates(mk([A, C, B]), 0.3).length, 1, '[A,C,B] must ALSO be one cluster (order-independence)');
});

test('matchOpenCard flags a duplicate of an open card and passes a novel item', () => {
  const cards = ['Model picker shows duplicate model rows for snapshots', 'Install copy for the Dock'];
  const dup = triage.matchOpenCard('the model picker is showing duplicate rows for a model', cards, 0.4);
  assert.ok(dup && /duplicate model rows/.test(dup.title), 'a near-duplicate of an open card should be flagged: ' + JSON.stringify(dup));

  const novel = triage.matchOpenCard('the create form hangs when I pick GPT with no key', cards, 0.4);
  assert.equal(novel, null, 'a novel item must not be flagged against an unrelated card');
});

test('triage end-to-end splits candidates, open-card duplicates, and noise, and ranks recurring first', () => {
  const reports = [
    { date: '2026-09-01', body: [
      '- The create form hangs when I pick GPT and there is no key saved.',
      '- Model picker shows the same model twice as duplicate rows.',
      '- Love it, works great!',
    ].join('\n') },
    { date: '2026-09-02', body: [
      '- Model picker is showing duplicate rows for the same model twice.',
      '- The dock icon is easy to lose among other apps.',
    ].join('\n') },
  ];
  const openCards = ['The dock icon is easy to lose among other applications'];
  const r = triage.triage(reports, { openCards, cardThreshold: 0.4 });

  // The recurring duplicate-rows issue is the top candidate (raised twice).
  assert.ok(r.candidates.length >= 2, 'expected the hang and the duplicate-rows candidates: ' + JSON.stringify(r.summary));
  assert.match(r.candidates[0].text, /duplicate rows/, 'the twice-raised issue should rank first');
  assert.equal(r.candidates[0].count, 2, 'the duplicate-rows issue was raised in both reports');
  assert.deepEqual(r.candidates[0].dates, ['2026-09-01', '2026-09-02']);

  // The dock item resembles an open card, so it is flagged, not a fresh candidate.
  assert.equal(r.duplicatesOfOpenCards.length, 1, 'the dock item should be flagged as an open-card duplicate');
  assert.match(r.duplicatesOfOpenCards[0].matchesCard.title, /dock icon/);
  assert.ok(!r.candidates.some((c) => /dock icon/.test(c.text)), 'an open-card duplicate must not also be a fresh candidate');

  // The sentiment line is noise, and nothing about a card was created.
  assert.ok(r.noise.some((n) => /love it/i.test(n.text)), 'the sentiment line should be noise');
  assert.equal(r.summary.reports, 2);
});

test('renderDigest states plainly that no card was opened and lists the candidate', () => {
  const r = triage.triage([{ date: '2026-09-01', body: '- The create form hangs when I pick GPT with no key saved.' }], {});
  const md = triage.renderDigest(r, { range: '2026-09-01' });
  assert.match(md, /No card was opened and nothing was changed/);
  assert.match(md, /Candidates for review/);
  assert.match(md, /create form hangs/);
});

test('the module has no card-creation surface -- triage cannot open a card by construction', () => {
  // A structural guard against scope creep: the safeguard is that nothing here
  // can write to GitHub. If a future edit adds such a method, this test fails
  // and forces a deliberate decision.
  // Anchored to the start of the name so an ACTION verb (createCard, openCard,
  // fileCard, postCard, submitCard, writeIssue) is caught while a read-only
  // matcher like matchOpenCard is not (its "Open" is a noun, not the verb).
  const surface = Object.keys(triage);
  const writeVerbs = surface.filter((k) => /^(create|open|file|post|submit|write|issue)/i.test(k));
  assert.deepEqual(writeVerbs, [], 'feedback-triage must expose no card-writing verb, found: ' + writeVerbs.join(', '));
});

/* kosmos#4415: measured on the 39 live reports (2026-09-28), the digest's top "candidate" was "Nothing appears broken
   in the interactions checked", raised 7 times: a clean report, flagged for the word "broken". */
test('#4415: a negated action word is not an action; a report that nothing went wrong is below the bar', () => {
  const t = require('./feedback-triage');
  for (const clean of ['Nothing appears broken in the interactions checked.', 'No errors today in any of the flows I ran.',
    'Everything worked as expected across the three rooms.', 'The update ran without any issues on this Mac.',
    'The queue is completely idle and ready for work rather than stuck or blocked.']) {
    assert.equal(t.classify(clean).score, 0, clean + ' scored as a candidate');
  }
  assert.ok(t.classify('The room scroll is broken: it lands higher up on every return.').score > 0, 'control: a real report still scores');
  assert.ok(t.classify('Nothing loads: the Files panel is broken on a fresh install.').score > 0,
    'control: "broken" four words after "nothing" is outside the negation reach, so a real report is not silenced');
});

test('#4415: the report form\'s own questions are not items, and frontmatter is not glued onto the first one', () => {
  const t = require('./feedback-triage');
  assert.equal(t.classify('Is anything broken?').score, 0);
  assert.equal(t.classify('What would make it better:').score, 0);
  const r = t.triage([{ date: '2026-09-28', body: '---\ndate: 2026-09-28\ninstall: aad22250-b483-4e07\ngenerated_at: x\n---\n\nBug: the weekly limit never records a reset, so the board stays stale for days.\n' }], {});
  const all = JSON.stringify(r);
  assert.ok(!all.includes('aad22250'), 'the install id from the frontmatter reached the digest');
  assert.ok(all.includes('weekly limit never records a reset'), 'control: the report itself is still read');
});

test('#4415: freshSince keeps only reports that arrived after the last post, and never guesses an undated one', () => {
  const t = require('./feedback-triage');
  const f = (name, at) => ({ name, body: '---\ndate: x\n' + (at ? 'generated_at: ' + at + '\n' : '') + '---\n- a line\n' });
  const since = Date.parse('2026-09-28T12:00:00Z') / 1000;
  const got = t.freshSince([f('2026-09-28-a.md', '2026-09-28T13:00:00Z'), f('2026-09-27-b.md', '2026-09-27T13:00:00Z'), f('2026-09-28-c.md', null)], since);
  assert.deepEqual(got.map((r) => r.date), ['2026-09-28'], 'the old and the undated report were kept');
  assert.equal(t.freshSince([f('2026-09-28-a.md', '2026-09-28T13:00:00Z')], 'not a number').length, 0, 'a bad watermark reads nothing, not everything');
});

test('#4415: adminSummary is empty with nothing new, and shows five candidates then a count', () => {
  const t = require('./feedback-triage');
  assert.equal(t.adminSummary([], '', 'https://x/admin'), '', 'nothing new must post nothing');
  const lines = ['Room scroll jumps upward whenever messages arrive, broken', 'Updater silently fails overnight', 'Export crashes Kosmos instantly',
    'Dock icon vanishes after reboot, a bug', 'Weekly quota never resets, error', 'Windows codex TOML path wrong, fails to load',
    'Login button unresponsive, does not work', 'Settings pane crashes on open', 'Voice microphone errors out constantly'];
  const body = '---\ndate: 2026-09-28\n---\n' + lines.map((l) => '- ' + l + '.').join('\n') + '\n';
  const out = t.adminSummary([{ date: '2026-09-28', body }], '', 'https://x/admin');
  const res = t.triage([{ date: '2026-09-28', body }], { openCards: [] });
  assert.ok(res.candidates.length > 5, 'fixture must exceed five candidates, got ' + res.candidates.length);
  const shown = out.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(shown.length, 5);
  assert.match(out, new RegExp('\\.\\.\\.and ' + (res.candidates.length - 5) + ' more\\.'));
  assert.match(out, /https:\/\/x\/admin \(Reports\)\. No card was opened\.$/);
});
