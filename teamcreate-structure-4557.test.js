'use strict';

/**
 * kosmos#4557, Josh's two requirements (card comments 2026-09-29 20:22 and 20:24):
 *
 * 1. "they'll also get the additional Kosmos instructions layered in with them, right?"
 *    Every team member is made through the SAME create path as a single agent, and its team brief
 *    is layered INTO the role's standard instructions, never written raw in place of them.
 * 2. "make sure ... that doesn't accidentally get overwritten and that all of the agents from a
 *    team report to the user." The structure lives in each agent's RECORD (reports -> the lead,
 *    the lead -> nobody, i.e. the person), so the board's reports sweep writes it rather than
 *    erasing it, a second sweep changes nothing, and the org chart draws the same tree.
 *
 * Driven through the real pieces, in order: teamseed.specs (what the page receives), then
 * create.createAgent per member (what POST /api/agents runs), then reports.syncEveryone (the
 * board's sweep) over a produced roster, then the page's own orgTreeOf.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sandbox BEFORE requiring anything that resolves a path at load (the same harness as
   engine/create.blockdrop-1673.test.js, tmux stub included so the roster read is fake too). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'teamcreate-structure-4557-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = nodePath.join(SANDBOX, 'panes.txt');
fs.writeFileSync(nodePath.join(SANDBOX, 'panes.txt'), '');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./engine/create');
const teamseed = require('./engine/teamseed');
const projects = require('./engine/projects');
const reports = require('./engine/reports');
const store = require('./engine/store');
const fleet = require('./test-support/fleet');

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
/* 🛑 A FAKE LAUNCH RUNNER, OR create TRIES A REAL LAUNCH. Measured writing this file: without it the
   first member came back 'partial' (a real start attempted, failing only because the paths are
   sandboxed). With the runner injected, files are written and nothing is started. */
create.setRunner(() => ({ ok: true }));
create.setDryRun(false);

/* A catalogue in April's agreed shape (#4555). The lead's role `cmo` is NOT a Kosmos role, so it
   also proves an unknown catalogue role still gets a standard template ('own') rather than a refusal. */
const CATALOGUE = {
  teams: () => [TEAM],
  team: (key) => (key === TEAM.key ? TEAM : null),
  memberInstructions: (key, slot, names) => {
    const m = TEAM.members.find((x) => x.slot === slot);
    const boss = slot === 'lead' ? 'the person who runs this computer' : names.lead;
    return `## On this team\n\nYou are the ${m.title} on the ${TEAM.label} team. You report to ${boss}.\n\n`
      + `## Personality\n\nWarm, exact, and brief.`;
  },
};
const TEAM = {
  key: 'marketing', label: 'Marketing', blurb: 'b', kind: 'business', rank: 1,
  members: [
    { slot: 'lead', role: 'cmo', title: 'Chief Marketing Officer', name: 'Maya', reportsTo: null, avatar: { image: null } },
    { slot: 'content', role: 'copy', title: 'Content Writer', name: 'Leo', reportsTo: 'lead', avatar: { image: null } },
    { slot: 'social', role: 'social', title: 'Social Media Manager', name: 'Ana', reportsTo: 'lead', avatar: { image: null } },
  ],
};

const NAMES = { lead: 'Maya', content: 'Leo', social: 'Ana' };
const file = (who) => fs.readFileSync(create.instructionFile(who), 'utf8');
const blockOf = (text, start, end) => {
  const at = projects.findBlock(text, start, end);
  return at ? text.slice(at.start, at.end) : null;
};
const without = (text, start, end) => {
  const at = projects.findBlock(text, start, end);
  return at ? text.slice(0, at.start) + text.slice(at.end) : text;
};

/* The page's org chart builder, lifted out of the build like web.org-view.test.js does. */
function orgTreeOf(agents) {
  const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = PAGE.indexOf('function orgTreeOf(');
  assert.ok(at > -1, 'orgTreeOf vanished from the page');
  let depth = 0; let end = -1;
  for (let k = PAGE.indexOf('{', at); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  // eslint-disable-next-line no-new-func
  return new Function(PAGE.slice(at, end) + '\nreturn orgTreeOf;')()(agents);
}

let made = null;
function makeTeam() {
  if (made) return made;
  teamseed.setCatalogue(CATALOGUE);
  const r = teamseed.specs({ team: 'marketing', names: NAMES });
  assert.equal(r.ok, true, r.because);
  made = {};
  for (const s of r.specs) {
    // The page posts exactly `s.spec` to POST /api/agents, which hands it to createAgent.
    assert.equal(s.spec.instructions, undefined, 'a member must never carry raw `instructions` (they replace the template)');
    const out = create.createAgent({ ...BINS, ...s.spec });
    assert.equal(out.outcome, create.OUTCOME.CREATED, s.slot + ': ' + out.because);
    made[s.slot] = out.name;
  }
  return made;
}

test('#4557 req 1: a member is the single-agent file of its role, plus its team brief, never instead of it', () => {
  const m = makeTeam();
  // A single agent of the same role, made the ordinary way, as the control.
  const solo = create.createAgent({ ...BINS, name: 'Solo', role: 'copy', label: 'Content Writer' });
  assert.equal(solo.outcome, create.OUTCOME.CREATED, solo.because);

  const member = file(m.content);
  // The team parts are there, inside their own block.
  const team = blockOf(member, projects.TEAM_START, projects.TEAM_END);
  assert.ok(team, 'the member has no team block');
  assert.match(team, /## On this team/);
  assert.match(team, /## Personality/);
  // The role's standard template is there: its opening line and the colleagues block every
  // role-template agent is born with (and the raw-instructions path skips).
  assert.match(member, /You are \*\*Leo\*\*, a copywriter\./, 'the role template is missing');
  assert.ok(blockOf(member, '<!-- kosmos:colleagues:start -->', '<!-- kosmos:colleagues:end -->'),
    'the standard colleagues block is missing, so this was written raw');

  // And apart from the team parts, it is the single agent's file byte for byte (names swapped).
  // The reports block differs by design (Leo reports to Maya, Solo to the person).
  // Removing a block leaves its surrounding blank lines behind, so blank runs are folded before comparing.
  const strip = (text) => without(without(text, projects.TEAM_START, projects.TEAM_END), reports.START, reports.END)
    .replace(/\n{3,}/g, '\n\n');
  // The display name and the machine name (the agent's own folder path) are the only per-agent words.
  const named = (text, shown, key) => text.split(shown).join('NAME').split('/workers/' + key + '/').join('/workers/KEY/');
  assert.equal(named(strip(member), 'Leo', m.content), named(strip(file(solo.name)), 'Solo', solo.name),
    'a team member\'s file is not the single-agent file of its role apart from the team parts');
});

test('#4557 req 1: a catalogue role Kosmos does not have gets the general template, not a refusal or a raw file', () => {
  const m = makeTeam();
  const lead = file(m.lead);
  assert.ok(blockOf(lead, projects.TEAM_START, projects.TEAM_END), 'the lead has no team block');
  assert.ok(blockOf(lead, '<!-- kosmos:colleagues:start -->', '<!-- kosmos:colleagues:end -->'), 'the lead was written raw');
  assert.match(lead, /Kosmos lists you as \*\*Chief Marketing Officer\*\*/, 'the lead lost its title');
});

test('#4557 req 2: the structure is in the RECORD, and the board sweep writes it, twice, without change', () => {
  const m = makeTeam();
  // The records: each report points at the lead's session name; the lead points nowhere (the person).
  assert.equal(store.readProfile(m.content).reportsTo, m.lead);
  assert.equal(store.readProfile(m.social).reportsTo, m.lead);
  assert.ok(!store.readProfile(m.lead).reportsTo, 'the lead must report to the person');

  const board = fleet.install([
    fleet.agent(m.lead, { state: 'idle' }), fleet.agent(m.content, { state: 'idle' }), fleet.agent(m.social, { state: 'idle' }),
  ]);
  try {
    // One sweep, the board's own.
    const first = reports.syncEveryone(board.agents);
    assert.equal(first.length, 3, JSON.stringify(first));
    const leadName = reports.managerName(m.lead);
    // (a) each report's file says it reports to the lead;
    for (const who of [m.content, m.social]) {
      assert.match(blockOf(file(who), reports.START, reports.END), new RegExp('You report to \\*\\*' + leadName + '\\*\\*\\.'), who);
    }
    // (b) the lead's says it reports to the person, and names no teammate as its manager;
    const leadBlock = blockOf(file(m.lead), reports.START, reports.END);
    assert.match(leadBlock, /directly/, leadBlock);
    assert.doesNotMatch(leadBlock, /You report to \*\*(Leo|Ana)\*\*/);
    // (c) a second sweep changes nothing;
    const before = [m.lead, m.content, m.social].map(file);
    reports.syncEveryone(board.agents);
    assert.deepEqual([m.lead, m.content, m.social].map(file), before, 'a second sweep rewrote a file');
    // (d) the org chart draws the same tree: the lead at the top, both reports under it.
    // The page reads each card's profile; here each agent's STORED record stands in for it (the
    // strict fixture refuses the page's direct read of an absent key, which production reads as none).
    const tree = orgTreeOf([m.lead, m.content, m.social].map((who) => ({ sessionName: who, profile: { ...store.readProfile(who) } })));
    const node = (who) => tree.find((n) => n.agent.sessionName === who);
    assert.equal(node(m.lead).depth, 0);
    assert.equal(node(m.lead).parent, null);
    for (const who of [m.content, m.social]) {
      assert.equal(node(who).depth, 1, who);
      assert.equal(node(who).parent, m.lead, who);
    }
  } finally { board.restore(); }
});
