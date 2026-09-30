'use strict';
/**
 * #4557 (umbrella #4554, Josh 2026-09-29 09:06): make a whole team of agents from a seeded team
 * definition, a lead plus the people who report to it.
 *
 * This module only BUILDS. It turns a seeded team (April's catalogue, #4555) and the names the
 * person chose into one create spec per member, in the order they must be made. The page then makes
 * each one through the existing POST /api/agents, one request per member, so every member gets the
 * same birth a single agent gets (account check, project attach, created count) and a failed one
 * can be retried alone. Nothing here writes an agent; `refresh()` downloads and stores the catalogue.
 *
 * The catalogue is read through `catalogue()`, which is injectable (setCatalogue) for tests and
 * loads `./catalogue` lazily otherwise. Since #4632 the catalogue is DOWNLOADED, not shipped: a board
 * that has not downloaded one has no teams, and `refresh()` is what the Team screen's routes call so
 * that opening the screen is what downloads it.
 */
const create = require('./create');

let injected = null;

/** Tests hand in a catalogue in the agreed shape; false means not installed; null restores the real one. */
function setCatalogue(c) { injected = (c === false) ? false : (c || null); }

/* Whether a machine name is already taken on this computer, by the same two things create refuses on:
   the agent's folder, or its launch job (create.js, before it makes anything). */
function takenDefault(slug) {
  const held = create.nameHeld(slug);
  return held.folder || held.job;
}

/* Whether that machine name belongs to an agent the person removed (remove keeps its folder). Loaded
   when asked: remove.js itself loads create.js. */
function removedDefault(slug) {
  return require('./remove').isRemoved(slug);
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
/* #4632: the board holds no catalogue (it is downloaded when the Team screen or the role picker opens,
   and this computer was offline or the download was refused). */
const NOT_DOWNLOADED = 'Kosmos has not downloaded the prebuilt teams to this computer yet. Check it is online and try again';
/* The download worked and what came was refused (its signature, its format, a serial this version will
   not take): being online does not help, so the sentence must not say it would. */
const REFUSED = 'Kosmos downloaded the prebuilt teams but could not use them';
/* Kosmos keeps no record of a team that is half made. After a page reload in the middle of making one,
   the agents already made are simply agents, and their names are taken. */
const MAYBE_OURS = '. If you were making this team a moment ago, those agents are already on your board';
/* A newer catalogue arrived between the screen opening and the button: the rows on screen are the old
   team's seats. */
const CHANGED = 'this prebuilt team was updated after this screen opened, so its seats no longer match. Go back and open the team again';
/* #4557 (April, #4555 review): a call into the catalogue can throw. That is "unavailable", like not
   installed, never a 500 that reads as a bug in the page. */
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

/** Why there are no teams to read from `c`, or null. A catalogue that cannot say what it holds (a
 *  test's fixture) is taken as holding what it answers. */
function notHeld(c) {
  if (!c) return NOT_INSTALLED;
  if (typeof c.status !== 'function') return null;
  const s = c.status();
  if (s && s.loaded) return null;
  // The catalogue's own reason (an address, a status code, a serial) goes to the log, never the screen.
  const why = s && typeof s.error === 'string' ? s.error : '';
  if (why && why !== loggedWhy) { loggedWhy = why; console.error('[teamseed] no prebuilt teams: ' + why); }
  return s && s.refused === true ? REFUSED : NOT_DOWNLOADED;
}
let loggedWhy = '';

/**
 * Download the catalogue for the routes the Team screen opens with. A board that HOLDS one asks
 * only when the catalogue says a check is due. A board that holds none asks every time: the person
 * opened the screen to get the teams, and "try again" after reconnecting must really try.
 * Never rejects: a failure only means the screen is told there are no teams yet.
 * @returns {Promise<void>}
 */
async function refresh(cat) {
  try {
    const c = cat === undefined ? catalogue() : cat;
    if (!c || typeof c.refresh !== 'function') return;
    // A copy that arrived and was refused is not asked for again at once: only a new publish changes it.
    const st = typeof c.status === 'function' ? (c.status() || {}) : {};
    await c.refresh({ force: !st.loaded && st.refused !== true });
  } catch (err) {
    console.error('[teamseed] the catalogue refresh failed:', (err && err.message) || err);
  }
}

/** For the Team dropdown: every seeded team, business then personal, each by rank. */
function list(cat) {
  const c = cat === undefined ? catalogue() : cat;
  const gone = notHeld(c);
  if (gone) return { ok: false, because: gone, unavailable: true };
  const teams = (c.teams() || []).map((t) => ({
    key: t.key, label: t.label, blurb: t.blurb, kind: t.kind, rank: t.rank, count: membersOf(t).length,
  }));
  // The catalogue's own order (business, then personal, each by rank): ranks restart per kind, so rank
  // alone would interleave the two. Sorted here too, since a catalogue handed in may not be in order.
  const kindOrder = (k) => { const i = ['business', 'personal'].indexOf(k); return i === -1 ? 2 : i; };
  teams.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || (a.rank || 0) - (b.rank || 0) || String(a.label).localeCompare(String(b.label)));
  return { ok: true, teams };
}

/** For the confirm screen: one team's members, lead first, with the suggested names. */
function detail(key, cat) {
  const c = cat === undefined ? catalogue() : cat;
  const gone = notHeld(c);
  if (gone) return { ok: false, because: gone, unavailable: true };
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
 * @param {{taken?:function(string):boolean, removed?:function(string):boolean}} [deps] tests replace the checks.
 * @returns {{ok:true, team:string, specs:Array<{slot,title,session,spec,avatar}>}|{ok:false, because:string}}
 */
function specs(req, cat, deps) {
  const c = cat === undefined ? catalogue() : cat;
  const taken = (deps && typeof deps.taken === 'function') ? deps.taken : takenDefault;
  // A caller that hands in its own checks (a test) gets no read of this computer's removed list.
  const removed = deps ? (typeof deps.removed === 'function' ? deps.removed : () => false) : removedDefault;
  const gone = notHeld(c);
  if (gone) return { ok: false, because: gone, unavailable: true };
  const key = req && req.team;
  const team = c.team(key);
  if (!team) return { ok: false, because: 'there is no prebuilt team called ' + JSON.stringify(String(key)), notFound: true };
  const lead = leadSlot(team);
  if (!lead) return { ok: false, because: 'this prebuilt team has no single lead, so it cannot be made' };

  const given = (req && req.names && typeof req.names === 'object') ? req.names : {};
  // The page sends one name per row it shows, blank or not. A seat it names that this team lacks, or
  // (when it named any) a seat of this team it did not name, means its rows are another version's.
  const slots = membersOf(team).map((m) => m.slot);
  const named = Object.keys(given);
  if (named.some((s) => !slots.includes(s)) || (named.length && slots.some((s) => !named.includes(s)))) {
    return { ok: false, because: CHANGED };
  }
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
    /* A REMOVED agent keeps its folder, so its name is taken too, but it is not "on your board": say
       what create itself says for that name (the removed list, and how to free the name). */
    if (req && req.checkTaken === true && removed(slug)) {
      return { ok: false, because: create.removedNameWords(raw) + 'give the ' + m.title + ' another name' };
    }
    if (req && req.checkTaken === true && taken(slug)) takenSeats.push({ raw, title: m.title });
    names[m.slot] = raw;
  }
  // Every taken name in one answer: making the same team again takes all of its suggested names.
  if (takenSeats.length === 1) {
    return { ok: false, because: 'there is already an agent called ' + takenSeats[0].raw + ' on this computer; give the ' + takenSeats[0].title + ' another name' + MAYBE_OURS };
  }
  if (takenSeats.length > 1) {
    return { ok: false, because: 'these names are already taken on this computer: ' + takenSeats.map((t) => t.raw + ' (the ' + t.title + ')').join(', ') + '; give each one another name' + MAYBE_OURS };
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
      // #4557 (Josh): the SAME create path as a single agent. The member's brief is layered INTO its
      // role's standard instructions (teamInstructions), never sent as `instructions`, which would
      // replace them.
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
  refresh, setCatalogue, catalogue, NOT_INSTALLED, NOT_DOWNLOADED, REFUSED, CHANGED, BROKEN,
};
