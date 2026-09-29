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
const create = require('./create');

let injected = null;

/** Tests hand in a catalogue in the agreed shape; false means not installed; null restores the real one. */
function setCatalogue(c) { injected = (c === false) ? false : (c || null); }

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
  if (!c) return { ok: false, because: NOT_INSTALLED };
  const teams = (c.teams() || []).map((t) => ({
    key: t.key, label: t.label, blurb: t.blurb, kind: t.kind, rank: t.rank, count: membersOf(t).length,
  }));
  teams.sort((a, b) => (a.rank || 0) - (b.rank || 0) || String(a.label).localeCompare(String(b.label)));
  return { ok: true, teams };
}

/** For the confirm screen: one team's members, lead first, with the suggested names. */
function detail(key, cat) {
  const c = cat === undefined ? catalogue() : cat;
  if (!c) return { ok: false, because: NOT_INSTALLED };
  const team = c.team(key);
  if (!team) return { ok: false, because: 'there is no prebuilt team called ' + JSON.stringify(String(key)) };
  const lead = leadSlot(team);
  const members = ordered(team).map((m) => ({
    slot: m.slot, title: m.title, role: m.role, name: m.name,
    reportsTo: m.reportsTo, portrait: Boolean(m.avatar && m.avatar.image),
  }));
  return {
    ok: true,
    team: { key: team.key, label: team.label, purpose: team.purpose, project: team.project || null, lead },
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
 * @param {{team:string, names:Object<string,string>, project?:(string|null)}} req
 *   names maps every slot to the name the person chose; project is an existing project id or null.
 * @returns {{ok:true, team:string, specs:Array<{slot,title,spec,avatar}>}|{ok:false, because:string}}
 */
function specs(req, cat) {
  const c = cat === undefined ? catalogue() : cat;
  if (!c) return { ok: false, because: NOT_INSTALLED };
  const key = req && req.team;
  const team = c.team(key);
  if (!team) return { ok: false, because: 'there is no prebuilt team called ' + JSON.stringify(String(key)) };
  const lead = leadSlot(team);
  if (!lead) return { ok: false, because: 'this prebuilt team has no single lead, so it cannot be made' };

  const given = (req && req.names && typeof req.names === 'object') ? req.names : {};
  const names = {};
  const seen = new Map();
  for (const m of membersOf(team)) {
    const raw = typeof given[m.slot] === 'string' ? given[m.slot].trim() : '';
    if (!raw) return { ok: false, because: 'give the ' + m.title + ' a name' };
    const problem = create.nameProblem(raw);
    if (problem) return { ok: false, because: 'the ' + m.title + '\'s name: ' + problem };
    const slug = create.slugFor(raw);
    if (seen.has(slug)) return { ok: false, because: 'the ' + seen.get(slug) + ' and the ' + m.title + ' have the same name; give each one its own' };
    seen.set(slug, m.title);
    names[m.slot] = raw;
  }

  const project = (req && typeof req.project === 'string' && req.project.trim()) ? req.project.trim() : null;
  const out = ordered(team).map((m) => ({
    slot: m.slot,
    title: m.title,
    spec: {
      name: names[m.slot],
      role: m.role,
      label: m.title,
      instructions: c.memberInstructions(team.key, m.slot, names),
      reportsTo: m.slot === lead ? null : create.slugFor(names[lead]),
      ...(project ? { projects: [project] } : {}),
    },
    avatar: { image: (m.avatar && typeof m.avatar.image === 'string' && m.avatar.image) ? m.avatar.image : null },
  }));
  return { ok: true, team: team.key, specs: out };
}

module.exports = { list, detail, specs, setCatalogue, catalogue, NOT_INSTALLED };
