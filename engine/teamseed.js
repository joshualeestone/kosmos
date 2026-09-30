'use strict';
/**
 * #4557 (umbrella #4554, Josh 2026-09-29 09:06): make a whole team of agents from a seeded team
 * definition, a lead plus the people who report to it.
 *
 * This module only BUILDS. It turns a seeded team (April's catalogue, #4555) and the names the
 * person chose into one create spec per member, in the order they must be made. The page then makes
 * each one through the existing POST /api/agents, one request per member, so every member gets the
 * same birth a single agent gets (account check, project attach, created count) and a failed one
 * can be retried alone. Nothing here writes anything.
 *
 * The catalogue is read through `catalogue()`, which is injectable (setCatalogue) for tests and
 * loads `./catalogue` lazily otherwise, so this module can land before the seed does.
 */
const fs = require('node:fs');
const create = require('./create');
const roles = require('./roles');

let injected = null;

/** Tests hand in a catalogue in the agreed shape; false means not installed; null restores the real one. */
function setCatalogue(c) { injected = (c === false) ? false : (c || null); }

/* Whether a machine name is already taken on this computer, by the same two things create refuses on:
   the agent's folder, or its launch job (create.js, before it makes anything). */
function takenDefault(slug) {
  return fs.existsSync(create.workerDir(slug)) || fs.existsSync(create.plistPath(slug));
}

/** The catalogue, or null when it is not installed on this build. */
function catalogue() {
  if (injected === false) return null;
  if (injected) return injected;
  try {
    return require('./catalogue');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /['"]\.\/catalogue['"]/.test(String(err.message))) return null;
    throw err;
  }
}

const NOT_INSTALLED = 'the prebuilt teams are not installed in this version of Kosmos yet';
/* #4557 (April, #4555 review): the catalogue is generated (catalogue-teams.js), so a bad build can make
   it throw on load or on a call. That is "unavailable", like not installed, never a 500 that reads as a
   bug in the page. */
const BROKEN = 'the prebuilt teams could not be read in this version of Kosmos';

function guarded(fn) {
  return function (...args) {
    try {
      return fn(...args);
    } catch (err) {
      // Not always the catalogue: a create helper or the disk can throw here too, so log where.
      console.error('[teamseed] ' + (fn.name || 'a call') + ' failed:', (err && err.stack) ? String(err.stack).split('\n').slice(0, 3).join(' | ') : err);
      return { ok: false, because: BROKEN, unavailable: true };
    }
  };
}

function membersOf(team) {
  return Array.isArray(team && team.members) ? team.members : [];
}

/** The lead's slot: the one member that reports to no one. */
function leadSlot(team) {
  const leads = membersOf(team).filter((m) => m && m.reportsTo === null);
  return leads.length === 1 ? leads[0].slot : null;
}

/** For the Team dropdown: every seeded team, ordered by rank. */
function list(cat) {
  const c = cat === undefined ? catalogue() : cat;
  if (!c) return { ok: false, because: NOT_INSTALLED, unavailable: true };
  const teams = (c.teams() || []).map((t) => ({
    key: t.key, label: t.label, blurb: t.blurb, kind: t.kind, rank: t.rank, count: membersOf(t).length,
  }));
  teams.sort((a, b) => (a.rank || 0) - (b.rank || 0) || String(a.label).localeCompare(String(b.label)));
  return { ok: true, teams };
}

/** For the confirm screen: one team's members, lead first, with the suggested names. */
function detail(key, cat) {
  const c = cat === undefined ? catalogue() : cat;
  if (!c) return { ok: false, because: NOT_INSTALLED, unavailable: true };
  const team = c.team(key);
  if (!team) return { ok: false, because: 'there is no prebuilt team called ' + JSON.stringify(String(key)), notFound: true };
  const lead = leadSlot(team);
  // Refused here too, so the confirm screen never shows a team Create would then refuse.
  if (!lead) return { ok: false, because: 'this prebuilt team has no single lead, so it cannot be made' };
  const members = ordered(team).map((m) => ({
    slot: m.slot, title: m.title, role: m.role, name: m.name,
    reportsTo: m.reportsTo, portrait: Boolean(m.avatar && m.avatar.image),
  }));
  return {
    ok: true,
    team: { key: team.key, label: team.label, purpose: team.purpose, caution: typeof team.caution === 'string' ? team.caution : null, project: team.project || null, lead },
    members,
  };
}

/** Lead first, then the reports in the seed's own order. */
function ordered(team) {
  const lead = leadSlot(team);
  const ms = membersOf(team);
  return ms.filter((m) => m.slot === lead).concat(ms.filter((m) => m.slot !== lead));
}

/**
 * Every member's create spec, in the order to make them, for the names the person chose.
 *
 * @param {{team:string, names:Object<string,string>, project?:(string|null), checkTaken?:boolean}} req
 *   names maps every slot to the name the person chose; project is an existing project id or null.
 *   checkTaken also refuses a name already taken on this computer. The page asks for it before making
 *   anything, so a taken suggested name is caught before the first agent; it is off when the page
 *   re-reads the specs to retry, because by then some of the names are taken by this team itself.
 * @param {{taken?:function(string):boolean}} [deps] tests replace the taken check.
 * @returns {{ok:true, team:string, specs:Array<{slot,title,spec,avatar}>}|{ok:false, because:string}}
 */
function specs(req, cat, deps) {
  const c = cat === undefined ? catalogue() : cat;
  const taken = (deps && typeof deps.taken === 'function') ? deps.taken : takenDefault;
  if (!c) return { ok: false, because: NOT_INSTALLED, unavailable: true };
  const key = req && req.team;
  const team = c.team(key);
  if (!team) return { ok: false, because: 'there is no prebuilt team called ' + JSON.stringify(String(key)), notFound: true };
  const lead = leadSlot(team);
  if (!lead) return { ok: false, because: 'this prebuilt team has no single lead, so it cannot be made' };

  const given = (req && req.names && typeof req.names === 'object') ? req.names : {};
  const names = {};
  const seen = new Map();
  const takenSeats = [];
  for (const m of membersOf(team)) {
    const raw = typeof given[m.slot] === 'string' ? given[m.slot].trim() : '';
    if (!raw) return { ok: false, because: 'give the ' + m.title + ' a name' };
    const problem = create.nameProblem(raw);
    if (problem) return { ok: false, because: 'the ' + m.title + '\'s name: ' + problem };
    const slug = create.slugFor(raw);
    if (seen.has(slug)) return { ok: false, because: 'the ' + seen.get(slug) + ' and the ' + m.title + ' have the same name; give each one its own' };
    seen.set(slug, m.title);
    if (req.checkTaken === true && taken(slug)) takenSeats.push({ raw, title: m.title });
    names[m.slot] = raw;
  }
  // Every taken name in one answer: making the same team again takes all of its suggested names.
  if (takenSeats.length === 1) {
    return { ok: false, because: 'there is already an agent called ' + takenSeats[0].raw + ' on this computer; give the ' + takenSeats[0].title + ' another name' };
  }
  if (takenSeats.length > 1) {
    return { ok: false, because: 'these names are already taken on this computer: ' + takenSeats.map((t) => t.raw + ' (the ' + t.title + ')').join(', ') + '; give each one another name' };
  }

  /* April (#4555): the catalogue's own reason, per member, for anything it would refuse (a role this
     version lacks among them), so a member is never made with its team brief silently missing. */
  const briefs = {};
  for (const m of membersOf(team)) {
    const why = typeof c.memberProblem === 'function' ? c.memberProblem(team.key, m.slot, names) : null;
    if (why) return { ok: false, because: why };
    /* Only the team section: create layers it INTO the role's own instructions, which already carry the
       role text and the live messaging block (iteration 14: the full memberInstructions file doubled the
       role text and froze a copy of the messaging block). A catalogue without the section function
       (an older build, a test fake) gives its whole brief. */
    briefs[m.slot] = typeof c.memberTeamSection === 'function'
      ? c.memberTeamSection(team.key, m.slot, names)
      : c.memberInstructions(team.key, m.slot, names);
    if (typeof briefs[m.slot] !== 'string' || !briefs[m.slot]) return { ok: false, because: 'the ' + m.title + '\'s instructions could not be made' };
  }

  const project = (req && typeof req.project === 'string' && req.project.trim()) ? req.project.trim() : null;
  const out = ordered(team).map((m) => ({
    slot: m.slot,
    title: m.title,
    session: create.slugFor(names[m.slot]),   // the name the member's agent will have on this computer
    spec: {
      name: names[m.slot],
      // #4557 (Josh): the SAME create path as a single agent. The catalogue's role when Kosmos has it,
      // else the general-purpose one; the member's brief is layered INTO that role's standard
      // instructions (teamInstructions), never sent as `instructions`, which would replace them.
      role: m.role,
      label: m.title,
      teamInstructions: briefs[m.slot],
      reportsTo: m.slot === lead ? null : create.slugFor(names[lead]),
      ...(project ? { projects: [project] } : {}),
    },
    avatar: { image: (m.avatar && typeof m.avatar.image === 'string' && m.avatar.image) ? m.avatar.image : null },
  }));
  return { ok: true, team: team.key, specs: out };
}

module.exports = {
  list: guarded(list), detail: guarded(detail), specs: guarded(specs),
  setCatalogue, catalogue, NOT_INSTALLED, BROKEN,
};
