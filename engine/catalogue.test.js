'use strict';
/**
 * #4555: the seeded catalogue of roles and prebuilt teams (engine/catalogue.js,
 * engine/catalogue-roles.js, engine/catalogue-teams.js), and what team creation (#4557) relies on.
 *
 *   node --test engine/catalogue.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every root sandboxed BEFORE the first require (create.test.js does the same): create,
// status and store resolve their roots at require time, and nothing here may reach the
// operator's real folders even if a later test calls further into create.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const catalogue = require('./catalogue');
// #4632: the catalogue is downloaded, not shipped; store the signed fixture as a download would.
require('../test-support/catalogue-fixture').install(SANDBOX);
const roles = require('./roles');
const create = require('./create');
const instructions = require('./instructions');

const REPO = path.join(__dirname, '..');

test('every catalogue role reached ROLES, once, as the catalogue wrote it (none skipped by a key collision)', () => {
  const raw = catalogue.rawRoles();
  assert.equal(raw.length, 69);
  for (const r of raw) {
    const hits = roles.ROLES.filter((x) => x.key === r.key);
    assert.equal(hits.length, 1, `${r.key} is in ROLES ${hits.length} times`);
    // roles.js appends the rhythm, so the merged text STARTS with the catalogue's.
    assert.ok(hits[0].instructions.startsWith(r.instructions), `${r.key} in ROLES is not the catalogue's role (a collision kept the older one)`);
    assert.equal(hits[0].menu, undefined, `${r.key} is hidden from the picker`);
  }
  // PREMISE (the collision itself is planted in the skip test further down): pm is an original key.
  assert.ok(roles.ROLES.some((x) => x.key === 'pm') && !raw.some((r) => r.key === 'pm'), 'the control premise changed');
});

test('the picker groups follow the catalogue order, every group is known, and the personal group stays last', () => {
  const order = catalogue.groupOrder();
  const seen = [];
  for (const r of roles.ROLES.filter((x) => x.menu !== false)) {
    assert.ok(order.includes(r.group), `${r.key} has a group the order does not list: ${r.group}`);
    if (!seen.includes(r.group)) seen.push(r.group);
  }
  assert.deepEqual(seen, order, 'a group appears out of order, or a listed group is empty');
  assert.equal(order[order.length - 1], 'Personal and family');
  // Hidden roles stay after every menu role.
  const firstHidden = roles.ROLES.findIndex((r) => r.menu === false);
  assert.ok(roles.ROLES.slice(firstHidden).every((r) => r.menu === false), 'a menu role sits after a hidden one');
  assert.equal(roles.ROLES.filter((x) => x.menu !== false).length, 102);
});

test('every catalogue role opens with the line the board reads, and carries no em dash in any field', () => {
  for (const r of catalogue.rawRoles()) {
    assert.match(r.instructions, /^You are \*\*\{\{NAME\}\}\*\*, (a|an) [^\n]+\.\n/, `${r.key} does not open "You are **{{NAME}}**, a ..."`);
    for (const [field, value] of Object.entries(r)) {
      assert.ok(!String(value).includes('\u2014'), `${r.key}.${field} has an em dash`);
    }
  }
});

test('teams: unique keys, a lead plus 4 or 5 reports, unique slots and names as create compares them', () => {
  const all = catalogue.teams();
  assert.equal(all.length, 21);
  assert.equal(new Set(all.map((t) => t.key)).size, all.length, 'two teams share a key');
  for (const kind of ['business', 'personal']) {
    const ranks = all.filter((t) => t.kind === kind).map((t) => t.rank);
    assert.equal(new Set(ranks).size, ranks.length, `two ${kind} teams share a rank`);
  }
  assert.ok(all.every((t) => ['business', 'personal'].includes(t.kind)));
  const avatarIds = new Set();
  for (const t of all) {
    const leads = t.members.filter((m) => m.reportsTo === null);
    assert.equal(leads.length, 1, `${t.key} has ${leads.length} leads`);
    assert.equal(leads[0].slot, 'lead');
    const reports = t.members.filter((m) => m.reportsTo !== null);
    assert.ok(reports.length >= 4 && reports.length <= 5, `${t.key} has ${reports.length} reports`);
    assert.ok(reports.every((m) => m.reportsTo === 'lead'), `${t.key} has a report that does not report to the lead`);
    assert.equal(new Set(t.members.map((m) => m.slot)).size, t.members.length, `${t.key} repeats a slot`);
    const slugs = t.members.map((m) => create.slugFor(m.name));
    assert.equal(new Set(slugs).size, slugs.length, `${t.key} has two members create would call the same name`);
    for (const m of t.members) {
      assert.equal(create.nameProblem(m.name), null, `${t.key}/${m.slot}: create refuses the name "${m.name}"`);
      const role = roles.byKey(m.role);
      assert.ok(role && role.menu !== false, `${t.key}/${m.slot}: role "${m.role}" is not a menu role`);
      assert.ok(m.title && Array.isArray(m.focus), `${t.key}/${m.slot}: no title or focus`);
      const a = m.avatar;
      for (const f of ['id', 'apparentAge', 'presentation', 'heritage', 'hair', 'attire', 'expression', 'prompt']) {
        assert.ok(typeof a[f] === 'string' && a[f], `${t.key}/${m.slot}: avatar.${f} missing`);
      }
      assert.equal(a.image, null, `${t.key}/${m.slot}: avatar.image is set before any portrait exists`);
      assert.ok(!avatarIds.has(a.id), `avatar id ${a.id} repeats`);
      avatarIds.add(a.id);
    }
    assert.ok(t.label && t.blurb && t.purpose && t.project && t.project.name && t.project.goal, `${t.key}: missing text`);
    assert.match(t.caution, /lead briefs the rest of the team/, `${t.key}: the team screen has no caution about the lead's reach`);
  }
  // CONTROL: the name check can fail (Kitty's ask 3 on #4557).
  assert.equal(create.slugFor('Maya'), create.slugFor('maya'));
  assert.notEqual(create.nameProblem('x'), null);
});

test('memberInstructions: the full file for every member, {{NAME}} filled, within what create accepts', () => {
  for (const t of catalogue.teams()) {
    for (const m of t.members) {
      const text = catalogue.memberInstructions(t.key, m.slot);
      assert.ok(text, `${t.key}/${m.slot} has no instructions`);
      assert.ok(text.startsWith(`You are **${m.name}**, `), `${t.key}/${m.slot} does not open with its own name`);
      assert.ok(!text.includes('{{'), `${t.key}/${m.slot} still has a template marker`);
      assert.ok(!text.includes('\u2014'), `${t.key}/${m.slot} has an em dash`);
      assert.ok(text.trim().length >= instructions.MIN_CHARS, `${t.key}/${m.slot} is shorter than create accepts`);
      assert.ok(Buffer.byteLength(text, 'utf8') <= instructions.MAX_BYTES, `${t.key}/${m.slot} is larger than create accepts`);
      assert.match(text, /## On this team/);
      assert.match(text, /## Your running record/, `${t.key}/${m.slot} lost the summary rhythm`);
      const lead = catalogue.leadOf(t);
      const flat = text.replace(/\s+/g, ' '); // lines wrap at 76, so a phrase can span a break
      if (m === lead) {
        for (const x of t.members.filter((y) => y !== m)) assert.ok(flat.includes(`**${x.name}** (message them as \`${create.slugFor(x.name)}\`), ${x.title}`), `${t.key} lead does not name ${x.name} with the command that reaches them`);
      } else {
        assert.ok(flat.includes(`You report to **${lead.name}**`), `${t.key}/${m.slot} does not name its lead`);
      }
    }
  }
  assert.equal(catalogue.memberInstructions('no-such-team', 'lead'), null);
  assert.equal(catalogue.memberInstructions('marketing', 'no-such-slot'), null);
});

test('memberInstructions uses the names the person chose, for the member and for the people it names', () => {
  const names = { lead: 'Nova', seo: 'Scout' };
  const seo = catalogue.memberInstructions('marketing', 'seo', names);
  assert.ok(seo.startsWith('You are **Scout**, '));
  const flatSeo = seo.replace(/\s+/g, ' ');
  assert.match(flatSeo, /You report to \*\*Nova\*\*/);
  assert.ok(flatSeo.includes('addressed to `nova`'));
  const lead = catalogue.memberInstructions('marketing', 'lead', names);
  assert.ok(lead.startsWith('You are **Nova**, '));
  assert.ok(lead.replace(/\s+/g, ' ').includes('**Scout** (message them as `scout`), SEO Specialist'));
  // CONTROL: without the names, the seed's names are used, so the assertions above were about `names`.
  const seed = catalogue.team('marketing');
  assert.match(catalogue.memberInstructions('marketing', 'seo').replace(/\s+/g, ' '), new RegExp(`You report to \\*\\*${catalogue.leadOf(seed).name}\\*\\*`));
  assert.doesNotMatch(catalogue.memberInstructions('marketing', 'seo'), /Nova/);
});

// The command as this machine teaches it (bare `kosmos` is not on every PATH): engine/clipath.js.
const CLI = require('./clipath').kosmosCliShown();
// Child processes load roles.js as a board would: not as a node --test process.
// Its own data root inside the sandbox, so a child's stored catalogue never replaces this process's.
const CHILD_ENV = { ...process.env, NODE_TEST_CONTEXT: '', AGENT_WORKFORCE_DATA: path.join(SANDBOX, 'child-support') };
const FIXTURE = path.join(REPO, 'test-support', 'catalogue-fixture.js');
// The spellings of the em dash the fleet's house rule names, assembled here so this file holds none.
const DASH = String.fromCharCode(0x2014);
const EM_DASHES = [DASH, '&' + 'mdash;', '&#' + '8212;', '&#x' + '2014;', '&#X' + '2014;', '\\' + 'u2014', '\\' + 'u{2014}'];

test('no em dash in any spelling, in any role or team field', () => {
  const blob = JSON.stringify([catalogue.rawRoles(), catalogue.teams()]);
  for (const d of EM_DASHES) assert.ok(!blob.includes(d), `found ${JSON.stringify(d)}`);
  assert.doesNotMatch(blob, /&#0*8212;|&#x0*2014;/i);
  // CONTROL: the scan sees each spelling when one is there.
  for (const d of EM_DASHES) assert.ok(JSON.stringify([`a ${d} b`]).includes(d));
});

test('a chosen name with spaces or periods is written as typed, and every command carries the machine name', () => {
  const lead = 'Dr. Maya Okafor';
  const slug = create.slugFor(lead);
  assert.ok(slug && !/[ .]/.test(slug), 'the premise changed: slugFor no longer folds spaces and periods');
  const seo = catalogue.memberInstructions('marketing', 'seo', { lead });
  const flat = seo.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`You report to **${lead}**`), 'the display name is not what the person typed');
  assert.ok(flat.includes(`addressed to \`${slug}\``), 'the lead is not addressed by the machine name');
  // CONTROL: the display name never appears inside a command, where its space would split it.
  assert.ok(!flat.includes(`msg ${lead}`), 'a command carries the display name');
  // No command is broken across a line: every line has an even number of backticks.
  for (const t of catalogue.teams()) for (const m of t.members) {
    for (const l of catalogue.memberInstructions(t.key, m.slot, { lead }).split('\n')) {
      assert.equal((l.match(/`/g) || []).length % 2, 0, `${t.key}/${m.slot}: a code span is split: ${l}`);
    }
  }
});

test('a name create would refuse makes memberInstructions refuse too, whichever member it belongs to', () => {
  for (const bad of ['a**b', 'x', 'line\nbreak', 'angel-discord']) {
    assert.notEqual(create.nameProblem(bad), null, `the premise changed: create now accepts ${JSON.stringify(bad)}`);
    assert.equal(catalogue.memberInstructions('marketing', 'seo', { seo: bad }), null, `accepted ${JSON.stringify(bad)} for the member itself`);
    assert.equal(catalogue.memberInstructions('marketing', 'seo', { lead: bad }), null, `accepted ${JSON.stringify(bad)} for its lead`);
  }
  // CONTROL: a good name is accepted, so the refusals above are about the names.
  assert.ok(catalogue.memberInstructions('marketing', 'seo', { lead: 'Nova' }));
});

test('suggested names are unique across the whole catalogue, so two seeded teams can share a board', () => {
  const seen = new Map();
  for (const t of catalogue.teams()) for (const m of t.members) {
    const k = create.slugFor(m.name);
    assert.ok(!seen.has(k), `${m.name} is suggested in both ${seen.get(k)} and ${t.key}`);
    seen.set(k, t.key);
  }
  assert.equal(seen.size, 112);
});

test('teams() and team() hand out copies: editing one does not change the catalogue', () => {
  const a = catalogue.team('marketing');
  a.members[0].name = 'Changed';
  catalogue.teams()[0].label = 'Changed';
  assert.notEqual(catalogue.team('marketing').members[0].name, 'Changed');
  assert.ok(!catalogue.teams().some((t) => t.label === 'Changed'));
});

test('the original 33 menu roles keep their order relative to each other (the merge only interleaves)', () => {
  // Their order on origin/main before #4555, pinned: the page draws the picker in ROLES order.
  const before = ['pm', 'director', 'ea', 'email', 'ops', 'meet', 'process', 'researcher', 'writer', 'copy',
    'marketing', 'social', 'seo', 'design', 'sales', 'accounts', 'support', 'ecom', 'data', 'finance', 'books',
    'product', 'productdir', 'engineer', 'qa', 'security', 'legal', 'recruiting', 'vendors', 'household',
    'family', 'personal', 'travel'];
  const now = roles.ROLES.map((r) => r.key).filter((k) => before.includes(k));
  assert.deepEqual(now, before);
});

test('memberProblem says why memberInstructions refuses, and is null exactly when it does not', () => {
  assert.match(catalogue.memberProblem('nope', 'lead'), /no prebuilt team/);
  assert.match(catalogue.memberProblem('marketing', 'nope'), /has no member/);
  assert.match(catalogue.memberProblem('marketing', 'seo', { lead: 'a**b' }), /Chief Marketing Officer cannot be used/);
  for (const t of catalogue.teams()) for (const m of t.members) {
    assert.equal(catalogue.memberProblem(t.key, m.slot), null, `${t.key}/${m.slot}`);
    assert.ok(catalogue.memberInstructions(t.key, m.slot));
  }
});

test('a long chosen name on a report never breaks the command beside it in the lead\'s roster', () => {
  // The roster line is `**Name** (\`kosmos msg name\`), Title: ...`: the span sits right after "(".
  // CONTROL: the seed names are short enough that the old tokenizer never had to wrap there, so the
  // long names below are what makes this able to fail.
  for (let n = 20; n <= 32; n++) {
    const name = ('Q' + 'abcdefghijklmnopqrstuvwxyzabcdef').slice(0, n);
    assert.equal(create.nameProblem(name), null, `premise: create accepts a ${n}-character name`);
    for (const t of catalogue.teams()) for (const m of t.members.filter((x) => x.reportsTo !== null)) {
      const text = catalogue.memberInstructions(t.key, 'lead', { [m.slot]: name });
      for (const l of text.split('\n')) assert.equal((l.match(/`/g) || []).length % 2, 0, `${t.key}/${m.slot} at ${n} chars: ${l}`);
    }
  }
});

test('two seats that create would call the same agent are refused up front, naming both seats', () => {
  assert.match(catalogue.memberProblem('marketing', 'seo', { lead: 'Nova', seo: 'nova' }), /Chief Marketing Officer and the SEO Specialist have the same name/);
  assert.match(catalogue.memberProblem('marketing', 'seo', { lead: 'Dr Nova', content: 'Dr. Nova' }), /same name/);
  assert.match(catalogue.memberProblem('marketing', 'seo', { content: catalogue.leadOf(catalogue.team('marketing')).name }), /same name/);
  assert.equal(catalogue.memberInstructions('marketing', 'seo', { lead: 'Nova', seo: 'nova' }), null);
  // A blank chosen name is a refusal, not a silent swap back to the seed name.
  assert.match(catalogue.memberProblem('marketing', 'seo', { seo: '   ' }), /cannot be used/);
  // A name present but not text is refused too, not swapped for the seed name.
  for (const v of [null, 7, {}]) assert.match(catalogue.memberProblem('marketing', 'seo', { seo: v }), /must be text/);
  // A key that names no seat is refused, not ignored (a misspelt slot would keep the seed name).
  assert.match(catalogue.memberProblem('marketing', 'seo', { SEO: 'Scout' }), /no seat "SEO"/);
  // CONTROL: distinct names pass.
  assert.equal(catalogue.memberProblem('marketing', 'seo', { lead: 'Nova', seo: 'Scout' }), null);
});

test('#4632: the catalogue is not shipped in the app, only downloaded; the fixture lives outside engine/', () => {
  // The Mac and Windows builds ship engine/*.js (build-kosmos-bundle.sh, build-kosmos-windows.sh),
  // so a data module there would ship again, which is what #4632 took out.
  const data = fs.readdirSync(__dirname).filter((f) => /^catalogue-.*\.js$/.test(f) && !f.endsWith('.test.js'));
  assert.deepEqual(data, []);
  assert.ok(!fs.existsSync(path.join(REPO, 'tools', 'catalogue')), 'tools/catalogue moved to joshualeestone/kosmos-catalogue');
  assert.equal(path.dirname(require(FIXTURE).FIXTURE), path.join(REPO, 'test-support'));
  // CONTROL: the same scan, on a folder that holds a data module, finds it.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-scan-'));
  try {
    fs.writeFileSync(path.join(probe, 'catalogue-roles.js'), '');
    fs.writeFileSync(path.join(probe, 'catalogue.test.js'), '');
    assert.deepEqual(fs.readdirSync(probe).filter((f) => /^catalogue-.*\.js$/.test(f) && !f.endsWith('.test.js')), ['catalogue-roles.js']);
  } finally { fs.rmSync(probe, { recursive: true, force: true }); }
});

test('a catalogue that fails to load costs the new roles, not the board: roles.js still loads, loudly', () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (req, ...rest) {
      if (req === './catalogue') throw new Error('planted catalogue failure');
      return load.call(this, req, ...rest);
    };
    const roles = require(${JSON.stringify(path.join(__dirname, 'roles.js'))});
    require(${JSON.stringify(FIXTURE)}).install(${JSON.stringify(SANDBOX)});
    process.stdout.write(String(roles.ROLES.length) + ' ' + (roles.byKey('pm') ? 'pm' : 'no-pm') + ' ' + (roles.byKey('cmo') ? 'cmo' : 'no-cmo'));
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: CHILD_ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '35 pm no-cmo', 'roles.js did not fall back to exactly the original roles');
  assert.match(r.stderr, /ready-made role catalogue did not load \(planted catalogue failure\)/);
  // CONTROL: without the planted failure the same child sees the catalogue.
  const ok = spawnSync(process.execPath, ['-e', `const r = require(${JSON.stringify(path.join(__dirname, 'roles.js'))}); require(${JSON.stringify(FIXTURE)}).install(${JSON.stringify(SANDBOX)}); process.stdout.write(String(r.ROLES.length))`], { encoding: 'utf8', env: CHILD_ENV });
  assert.equal(ok.stdout, '104', ok.stderr);
});

test('a catalogue key already defined in roles.js is skipped, the original kept once, and the skip is logged', () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (req, ...rest) {
      const real = load.call(this, req, ...rest);
      if (req !== './catalogue') return real;
      return { ...real, rawRoles: () => real.rawRoles().concat([{ key: 'pm', group: 'Running the work', label: 'Impostor',
        blurb: 'x', firstAction: 'a first action long enough', instructions: 'You are **{{NAME}}**, an impostor.' }]) };
    };
    const roles = require(${JSON.stringify(path.join(__dirname, 'roles.js'))});
    const pms = roles.ROLES.filter((r) => r.key === 'pm');
    process.stdout.write(pms.length + ' ' + pms[0].label);
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: CHILD_ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '1 Project Manager', 'the original pm was not kept exactly once');
  assert.match(r.stderr, /already defined in roles\.js were skipped: pm/);
  // CONTROL: without the planted key there is no skip line.
  const ok = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, 'roles.js'))})`], { encoding: 'utf8', env: CHILD_ENV });
  assert.doesNotMatch(ok.stderr, /were skipped/);
});

test('the picker still opens on the same first role: the merge keeps Project Manager first', () => {
  // The page recommends the first menu role; the catalogue must not move the default.
  assert.equal(roles.ROLES.filter((r) => r.menu !== false)[0].key, 'pm');
});

test('fewer than half of the roles a person can pick carry a caution (the menu, not counting hidden roles)', () => {
  const menu = roles.ROLES.filter((r) => r.menu !== false);
  assert.ok(menu.filter((r) => r.caution).length < menu.length / 2,
    `${menu.filter((r) => r.caution).length} of ${menu.length} menu roles carry a caution`);
});

test('every team member file carries the messaging block create adds to role templates', () => {
  const messages = require('./messages');
  for (const t of catalogue.teams()) for (const m of t.members) {
    const text = catalogue.memberInstructions(t.key, m.slot);
    assert.equal(text.split(messages.START).length - 1, 1, `${t.key}/${m.slot}: messaging block missing or doubled`);
    assert.ok(text.includes(messages.END));
  }
  // CONTROL: the role text alone (what explicit instructions would carry) has no block.
  assert.ok(!roles.instructionsFor('cmo', 'X').includes(messages.START));
});

test('the team section carries no command path (it is outside the healed block, so a path would go stale)', () => {
  const messages = require('./messages');
  for (const t of catalogue.teams()) for (const m of t.members) {
    const text = catalogue.memberInstructions(t.key, m.slot);
    const section = text.slice(text.indexOf('## On this team'), text.indexOf(messages.START));
    assert.ok(!section.includes(CLI + ' '), `${t.key}/${m.slot}: a command path sits outside the messaging block`);
  }
  // CONTROL: the messaging block itself does teach the command.
  assert.ok(catalogue.memberInstructions('marketing', 'lead').slice(catalogue.memberInstructions('marketing', 'lead').indexOf(messages.START)).includes('msg'));
});
