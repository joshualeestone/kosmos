'use strict';
/* #4557: engine/teamseed.js builds one create spec per member of a seeded team, in the order to make
   them. Hermetic: the catalogue is a fixture in the shape agreed with #4555 on the card, injected per
   call, so nothing here depends on the real seed existing yet. */
const test = require('node:test');
const assert = require('node:assert/strict');

/* #4632: the real catalogue is downloaded, not shipped. The one test below that reads it needs the
   published fixture stored in a sandboxed data root, before anything from engine/ loads. */
require('../test-support/catalogue-fixture').sandboxWithCatalogue('teamseed');
const teamseed = require('./teamseed');

function fixture() {
  const teams = [
    {
      key: 'marketing', kind: 'business', rank: 2, label: 'Marketing Team', blurb: 'b', purpose: 'Grow the business.', caution: 'The lead briefs the rest.',
      project: { name: 'Marketing', goal: 'g' },
      members: [
        { slot: 'content', role: 'copy', title: 'Content Writer', name: 'Leo', reportsTo: 'lead', focus: [], avatar: { id: 'm-content', image: null } },
        { slot: 'lead', role: 'cmo', title: 'Chief Marketing Officer', name: 'Maya', reportsTo: null, focus: [], avatar: { id: 'm-lead', image: 'web/avatars/teams/m-lead.webp' } },
        { slot: 'social', role: 'social', title: 'Social Media Manager', name: 'Ana', reportsTo: 'lead', focus: [], avatar: { id: 'm-social' } },
      ],
    },
    {
      key: 'home', kind: 'personal', rank: 1, label: 'Home Team', blurb: 'h', purpose: 'Run the house.',
      members: [
        { slot: 'lead', role: 'ea', title: 'House Manager', name: 'Sam', reportsTo: null, avatar: {} },
        { slot: 'meals', role: 'chef', title: 'Meal Planner', name: 'Rosa', reportsTo: 'lead', avatar: {} },
      ],
    },
    { key: 'nolead', label: 'Broken', rank: 9, members: [{ slot: 'a', role: 'x', title: 'A', name: 'A1', reportsTo: 'b' }] },
  ];
  const calls = [];
  return {
    calls,
    teams: () => teams,
    team: (k) => teams.find((t) => t.key === k) || null,
    memberInstructions: (teamKey, slot, names) => {
      calls.push({ teamKey, slot, names: { ...names } });
      return 'You are **' + names[slot] + '**, on ' + teamKey + ' as ' + slot + '.\n\nReports to ' + names.lead + '.';
    },
  };
}

test('list: every team in the catalogue\'s order (business, then personal, each by rank), with its member count', () => {
  const r = teamseed.list(fixture());
  assert.equal(r.ok, true);
  // home is personal rank 1 and marketing business rank 2: rank alone would put home first.
  assert.deepEqual(r.teams.map((t) => [t.key, t.count]), [['marketing', 3], ['home', 2], ['nolead', 1]]);
  assert.equal(r.teams[0].label, 'Marketing Team');
});

test('a catalogue that throws (a bad generated build) is unavailable, never a throw', () => {
  const broken = { teams() { throw new Error('catalogue-teams.js: bad build'); }, team() { throw new Error('bad build'); } };
  const quiet = console.error; console.error = () => {};
  try {
    for (const r of [teamseed.list(broken), teamseed.detail('marketing', broken), teamseed.specs({ team: 'marketing', names: {} }, broken)]) {
      assert.equal(r.ok, false);
      assert.equal(r.because, teamseed.BROKEN);
      assert.equal(r.unavailable, true);
    }
  } finally { console.error = quiet; }
});

test('not installed: every entry point says so in words and never throws', () => {
  for (const r of [teamseed.list(null), teamseed.detail('marketing', null), teamseed.specs({ team: 'marketing', names: {} }, null)]) {
    assert.equal(r.ok, false);
    assert.equal(r.because, teamseed.NOT_INSTALLED);
  }
});

test('#4632 not downloaded: a catalogue that holds nothing says so at every entry point; one that holds some is read', () => {
  const held = { ...fixture(), status: () => ({ loaded: true }) };
  const empty = { ...fixture(), status: () => ({ loaded: false }) };
  for (const r of [teamseed.list(empty), teamseed.detail('marketing', empty), teamseed.specs({ team: 'marketing', names: {} }, empty)]) {
    assert.equal(r.ok, false);
    assert.equal(r.because, teamseed.NOT_DOWNLOADED);
    assert.equal(r.unavailable, true, 'unavailable (503), never "no such team" (404)');
  }
  assert.equal(teamseed.list(held).ok, true, 'control: the same catalogue, holding a copy, lists');
  assert.equal(teamseed.detail('marketing', held).ok, true);
});

test('#4632 not downloaded: the catalogue\'s own reason stays off the screen, and a REFUSED copy is not blamed on being offline', () => {
  const offline = { ...fixture(), status: () => ({ loaded: false, error: 'fetch failed' }) };
  // Read from the catalogue's `refused` flag, not from its words: the same words without the flag are
  // not a refusal, and the flag with other words is.
  const refused = { ...fixture(), status: () => ({ loaded: false, refused: true, error: 'its signature does not verify' }) };
  const onlyWords = { ...fixture(), status: () => ({ loaded: false, error: 'the downloaded catalogue was refused: x' }) };
  assert.equal(teamseed.list(onlyWords).because, teamseed.NOT_DOWNLOADED);
  // Review 22: the raw reason can be an address and a status code, or a serial. It is logged, not shown.
  const http = { ...fixture(), status: () => ({ loaded: false, error: 'https://example.invalid/catalogue.json answered 503' }) };
  assert.equal(teamseed.list(offline).because, teamseed.NOT_DOWNLOADED);
  assert.equal(teamseed.list(http).because, teamseed.NOT_DOWNLOADED);
  const r = teamseed.list(refused);
  assert.equal(r.because, teamseed.REFUSED);
  assert.doesNotMatch(r.because, /online/, 'being online would not help');
  assert.equal(r.unavailable, true);
});

test('#4632 specs: rows from another version of the team are refused as such, not as a missing name', () => {
  const names = { lead: 'Maya', content: 'Leo', social: 'Ana' };
  assert.equal(teamseed.specs({ team: 'marketing', names: { ...names, design: 'Dee' } }, fixture()).because, teamseed.CHANGED, 'a seat this team does not have');
  assert.equal(teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo' } }, fixture()).because, teamseed.CHANGED, 'a seat the page never named');
  // Controls: a BLANK name is still asked for by its title, and the full set builds.
  assert.match(teamseed.specs({ team: 'marketing', names: { ...names, social: ' ' } }, fixture()).because, /give the Social Media Manager a name/);
  assert.match(teamseed.specs({ team: 'marketing', names: {} }, fixture()).because, /give the .* a name/);
  assert.equal(teamseed.specs({ team: 'marketing', names }, fixture(), { taken: () => false }).ok, true);
});

test('#4632 refresh: asks the catalogue to download, and a failure there never rejects', async () => {
  let asked = 0;
  await teamseed.refresh({ refresh: async () => { asked += 1; } });
  assert.equal(asked, 1);
  // A board holding none really tries (force); one holding a copy leaves the pacing to the catalogue.
  const how = [];
  await teamseed.refresh({ status: () => ({ loaded: false }), refresh: async (o) => { how.push(o); } });
  await teamseed.refresh({ status: () => ({ loaded: true }), refresh: async (o) => { how.push(o); } });
  // A copy that arrived and was refused keeps the catalogue's pacing: asking again cannot change it.
  await teamseed.refresh({ status: () => ({ loaded: false, refused: true }), refresh: async (o) => { how.push(o); } });
  assert.deepEqual(how, [{ force: true }, { force: false }, { force: false }]);
  const quiet = console.error; console.error = () => {};
  try {
    await teamseed.refresh({ refresh: async () => { throw new Error('offline'); } });
    await teamseed.refresh({ refresh: () => { throw new Error('sync throw'); } });
  } finally { console.error = quiet; }
  await teamseed.refresh({});      // a catalogue with nothing to refresh (a test fixture)
  await teamseed.refresh(null);    // not installed
});

test('detail: lead first, suggested names, and whether a portrait ships', () => {
  const r = teamseed.detail('marketing', fixture());
  assert.equal(r.ok, true);
  assert.equal(r.team.lead, 'lead');
  assert.equal(r.team.caution, 'The lead briefs the rest.');
  assert.equal(teamseed.detail('home', fixture()).team.caution, null, 'a team with no caution says none');
  assert.deepEqual(r.members.map((m) => m.slot), ['lead', 'content', 'social']);
  assert.deepEqual(r.members.map((m) => m.name), ['Maya', 'Leo', 'Ana']);
  assert.deepEqual(r.members.map((m) => m.portrait), [true, false, false]);
  assert.equal(teamseed.detail('nope', fixture()).ok, false);
});

const NAMES = { lead: 'Maya Okafor', content: 'Leo', social: 'Ana' };

test('specs: lead first; reports report to the lead by its machine name, however the person renamed it', () => {
  const r = teamseed.specs({ team: 'marketing', names: NAMES }, fixture());
  assert.equal(r.ok, true);
  assert.deepEqual(r.specs.map((s) => s.slot), ['lead', 'content', 'social']);
  assert.equal(r.specs[0].spec.reportsTo, null);
  assert.equal(r.specs[1].spec.reportsTo, 'maya-okafor');
  assert.equal(r.specs[2].spec.reportsTo, 'maya-okafor');
  assert.deepEqual(r.specs.map((s) => s.spec.name), ['Maya Okafor', 'Leo', 'Ana']);
  assert.deepEqual(r.specs.map((s) => s.spec.label), ['Chief Marketing Officer', 'Content Writer', 'Social Media Manager']);
  // The catalogue's own role; a role this version lacks is refused by memberProblem (tested below).
  assert.deepEqual(r.specs.map((s) => s.spec.role), ['cmo', 'copy', 'social']);
});

test('specs: the team brief is the catalogue\'s, built with the CHOSEN names for every slot', () => {
  const cat = fixture();
  const r = teamseed.specs({ team: 'marketing', names: NAMES }, cat);
  // #4557 (Josh): the brief rides as teamInstructions, layered into the role's template; never raw `instructions`.
  assert.equal(r.specs[1].spec.teamInstructions, 'You are **Leo**, on marketing as content.\n\nReports to Maya Okafor.');
  assert.equal(r.specs[1].spec.instructions, undefined);
  assert.equal(cat.calls.length, 3);
  for (const c of cat.calls) assert.deepEqual(c.names, NAMES);
});

test('specs: a project id rides on every member; none means no projects field at all', () => {
  const withP = teamseed.specs({ team: 'marketing', names: NAMES, project: ' p-123 ' }, fixture());
  for (const s of withP.specs) assert.deepEqual(s.spec.projects, ['p-123']);
  const without = teamseed.specs({ team: 'marketing', names: NAMES, project: null }, fixture());
  for (const s of without.specs) assert.equal('projects' in s.spec, false);
});

test('specs: the portrait path rides along, null when the seed has none yet', () => {
  const r = teamseed.specs({ team: 'marketing', names: NAMES }, fixture());
  assert.deepEqual(r.specs.map((s) => s.avatar.image), ['web/avatars/teams/m-lead.webp', null, null]);
});

test('specs refuses, naming the seat: a blank name, a bad name, two seats with one name', () => {
  const cat = fixture();
  // A seat with NO entry at all is another matter (#4632: rows from another version of the team), below.
  let r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo', social: '' } }, cat);
  assert.equal(r.ok, false); assert.match(r.because, /Social Media Manager a name/);
  r = teamseed.specs({ team: 'marketing', names: { ...NAMES, content: '   ' } }, cat);
  assert.equal(r.ok, false); assert.match(r.because, /Content Writer a name/);
  r = teamseed.specs({ team: 'marketing', names: { ...NAMES, content: 'x' } }, cat);
  assert.equal(r.ok, false); assert.match(r.because, /Content Writer's name: use at least two characters/);
  // Same name as create compares names: case and a space vs a hyphen do not make two names.
  r = teamseed.specs({ team: 'marketing', names: { ...NAMES, social: 'maya-OKAFOR' } }, cat);
  assert.equal(r.ok, false); assert.match(r.because, /Chief Marketing Officer and the Social Media Manager have the same name/);
  assert.equal(cat.calls.length, 0, 'nothing is built when a name is refused');
});

test('specs with checkTaken refuses a name already taken on this computer, naming the seat; without it, it does not', () => {
  const takenNames = new Set(['leo']);
  const deps = { taken: (slug) => takenNames.has(slug) };
  const cat = fixture();
  const r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo', social: 'Ana' }, checkTaken: true }, cat, deps);
  assert.equal(r.ok, false);
  assert.equal(r.because, 'there is already an agent called Leo on this computer; give the Content Writer another name. If you were making this team a moment ago, those agents are already on your board');
  assert.equal(cat.calls.length, 0, 'nothing is built when a name is taken');
  const retry = teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo', social: 'Ana' } }, cat, deps);
  assert.equal(retry.ok, true, 'a retry re-reads specs without the check, since this team took some of the names itself');
});

test('specs refuses an unknown team and a team with no single lead', () => {
  assert.match(teamseed.specs({ team: 'nope', names: {} }, fixture()).because, /no prebuilt team called "nope"/);
  assert.match(teamseed.specs({ team: 'nolead', names: { a: 'Ann' } }, fixture()).because, /no single lead/);
});

test('the injected catalogue is what catalogue() returns, and null restores the lazy load', () => {
  const cat = fixture();
  teamseed.setCatalogue(cat);
  try { assert.equal(teamseed.catalogue(), cat); } finally { teamseed.setCatalogue(null); }
  // The other half of the title (round 1): null really restores the lazy load, whether or not the seed is installed.
  assert.notEqual(teamseed.catalogue(), cat, 'setCatalogue(null) left the injected catalogue in place');
});

test('specs refuses with the catalogue\'s own reason (memberProblem) before making anything, and never sends a member with no brief', () => {
  const cat = fixture();
  cat.memberProblem = (teamKey, slot) => (slot === 'social' ? 'the Social Media Manager needs the role "social", which this version does not have' : null);
  const r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya Okafor', content: 'Leo', social: 'Ana' } }, cat);
  assert.equal(r.ok, false);
  assert.match(r.because, /needs the role "social"/);
  const nullBrief = fixture();
  nullBrief.memberInstructions = () => null;
  const r2 = teamseed.specs({ team: 'marketing', names: { lead: 'Maya Okafor', content: 'Leo', social: 'Ana' } }, nullBrief);
  assert.equal(r2.ok, false, 'a member with no brief is not handed to create');
  assert.match(r2.because, /instructions could not be made/);
});

test('specs against the REAL seeded catalogue: every prebuilt team makes one spec per member, each with a brief', () => {
  teamseed.setCatalogue(null);
  const cat = teamseed.catalogue();
  assert.ok(cat, 'the seed is installed on this build (#4555)');
  const all = cat.teams();
  assert.ok(all.length >= 1);
  for (const t of all) {
    const names = {};
    for (const m of t.members) names[m.slot] = m.name;
    const r = teamseed.specs({ team: t.key, names }, cat, { taken: () => false });
    assert.equal(r.ok, true, t.key + ': ' + r.because);
    assert.equal(r.specs.length, t.members.length, t.key);
    for (const s of r.specs) assert.ok(typeof s.spec.teamInstructions === 'string' && s.spec.teamInstructions.length > 0, t.key + '/' + s.slot);
  }
});

test('specs with checkTaken names EVERY taken seat in one answer (making the same team twice takes them all)', () => {
  const r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo', social: 'Ana' }, checkTaken: true },
    fixture(), { taken: () => true });
  assert.equal(r.ok, false);
  for (const who of ['Maya', 'Leo', 'Ana']) assert.match(r.because, new RegExp(who), r.because);
});

test('detail refuses a team with no single lead, as specs does, so the confirm screen never shows one', () => {
  const r = teamseed.detail('nolead', fixture());
  assert.equal(r.ok, false);
  assert.match(r.because, /no single lead/);
});

test('each spec carries the session name its agent will have (the page adopts a member whose create landed before the connection dropped)', () => {
  const r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya Okafor', content: 'Leo', social: 'Ana' } }, fixture());
  assert.deepEqual(r.specs.map((s) => s.session), ['maya-okafor', 'leo', 'ana']);
});
