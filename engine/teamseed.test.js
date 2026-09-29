'use strict';
/* #4557: engine/teamseed.js builds one create spec per member of a seeded team, in the order to make
   them. Hermetic: the catalogue is a fixture in the shape agreed with #4555 on the card, injected per
   call, so nothing here depends on the real seed existing yet. */
const test = require('node:test');
const assert = require('node:assert/strict');

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

test('list: every team, ordered by rank, with its member count', () => {
  const r = teamseed.list(fixture());
  assert.equal(r.ok, true);
  assert.deepEqual(r.teams.map((t) => [t.key, t.count]), [['home', 2], ['marketing', 3], ['nolead', 1]]);
  assert.equal(r.teams[1].label, 'Marketing Team');
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
  assert.deepEqual(r.specs.map((s) => s.spec.role), ['cmo', 'copy', 'social']);
});

test('specs: instructions are the catalogue\'s, built with the CHOSEN names for every slot', () => {
  const cat = fixture();
  const r = teamseed.specs({ team: 'marketing', names: NAMES }, cat);
  assert.equal(r.specs[1].spec.instructions, 'You are **Leo**, on marketing as content.\n\nReports to Maya Okafor.');
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

test('specs refuses, naming the seat: a missing or blank name, a bad name, two seats with one name', () => {
  const cat = fixture();
  let r = teamseed.specs({ team: 'marketing', names: { lead: 'Maya', content: 'Leo' } }, cat);
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
  assert.equal(r.because, 'there is already an agent called Leo on this computer; give the Content Writer another name');
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
});
