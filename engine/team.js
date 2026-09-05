'use strict';

/**
 * #1279: a PM agent builds a team for a stated purpose.
 *
 * Josh, 2026-08-28: *"if i create a project manager agent and i was like 'hey
 * can you build me a team of agents for purpose x?' they would be able to create
 * those agents through the kosmos system."*
 *
 * This is the NARROW version Baron Draxum's design pass recommended on the card:
 * a creator makes agents OF ROLE TYPES THAT ALREADY EXIST, with the two safety
 * rails that have a real substrate to build on. It is "most of the value and
 * almost none of the risk"; "create a new role type from scratch" is a separate
 * card, because that is where the default-text generator and the permission
 * model all have to be right at once.
 *
 * 🔑 KOSMOS OWNS THE BOUND, NOT THE PROMPT (Baron's runaway question). A PM agent
 * asked for "a team for purpose X" has no natural limit on team size, and an
 * agent that creates agents makes a runaway the whole tree rather than one pane.
 * So the cap lives HERE, in the product, refused with a sentence -- never left to
 * whatever number a model happened to pick.
 *
 * 🔑 CREATION RECORDS WHY (Baron's drift question). On 2026-08-25 thirteen of
 * seventeen agents on this fleet were working one project and seven of those were
 * DRIFT, not assignment -- with humans doing the assigning. Agent-created agents
 * make drift the default outcome unless creation records why an agent exists. So
 * every agent this makes carries `createdBy` (the creator) and `purpose` (the
 * stated reason) into its birth record, via create.createAgent's #1279 fields.
 *
 * 🛑 WHAT THIS DELIBERATELY DOES NOT DO, so the boundary is on the record and not
 * discovered later:
 *   - It does not enforce "a created agent can never exceed its creator's
 *     permissions" (Baron's privilege-escalation point). There is no unified
 *     agent-permission primitive in this engine to inherit-or-narrow -- account,
 *     role and project access are separate axes, none a capability set -- so
 *     there is nothing to narrow yet. Recording `createdBy` is the PREREQUISITE
 *     for ever enforcing it; the enforcement is the separate card.
 *   - It does not create a role type that does not exist. Each member's role is
 *     handed to create.createAgent, which refuses an unknown role with its own
 *     sentence, captured per-member below.
 *   - It does not verify the creator is a live roster agent. The creator string
 *     is recorded as provenance; verifying it belongs to a real agent is the
 *     authoring surface's job (the chat request -> createTeam seam), not this
 *     engine core's.
 */

const create = require('./create');

/* The Kosmos-owned default. A team assembled for one stated purpose is a handful
   of agents; a request for more than this is far likelier a runaway or a mistake
   than a real org, and Kosmos should say so rather than obey it. Overridable, so
   a genuine large build is possible deliberately -- opts.cap first, then the
   AGENT_WORKFORCE_TEAM_CAP env for an operator default, then this. The cap only
   ever REFUSES a too-large request; it never trims one silently, because a team
   quietly cut to 12 is its own invisible failure. */
const DEFAULT_TEAM_CAP = 12;

function resolveCap(opts, env) {
  const fromOpt = opts && opts.cap;
  if (Number.isInteger(fromOpt) && fromOpt > 0) return fromOpt;
  const fromEnv = env && env.AGENT_WORKFORCE_TEAM_CAP;
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).trim() !== '') {
    const n = Number(fromEnv);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_TEAM_CAP;
}

/**
 * Build a team of agents on behalf of a creator, for a stated purpose.
 *
 * @param {object} opts
 * @param {string} opts.creator  who is building the team (an agent name, or
 *   "operator"). Required: a team with no creator is just N separate creates,
 *   and the provenance the whole feature exists for would be null.
 * @param {string} opts.purpose  why the team exists. Required for the same
 *   reason -- recording WHY is the drift guard, so a team with no why defeats it.
 * @param {Array<object>} opts.members  one create.createAgent opts object per
 *   agent ({name, role, ...}). Must be a non-empty array no longer than the cap.
 * @param {number} [opts.cap]  override the team-size cap (positive integer).
 * @param {object} [deps]  { createAgent, env } -- injectable seam for tests;
 *   defaults to create.createAgent and process.env.
 * @returns {{outcome:'created'|'partial'|'refused', created:Array<{name,id}>,
 *   refused:Array<{name,because}>, because:(string|null), creator:string,
 *   purpose:string, cap:number}}
 */
function createTeam(opts, deps) {
  const doCreate = (deps && typeof deps.createAgent === 'function') ? deps.createAgent : create.createAgent;
  const env = (deps && deps.env) || process.env;

  const creator = (opts && typeof opts.creator === 'string') ? opts.creator.trim() : '';
  const purpose = (opts && typeof opts.purpose === 'string') ? opts.purpose.trim() : '';
  const members = (opts && Array.isArray(opts.members)) ? opts.members : null;
  const cap = resolveCap(opts, env);

  /* Pre-flight refusals: nothing is created, so `created`/`refused` stay empty
     and `because` carries the one reason. Whole-or-not-at-all for the request
     SHAPE, per-member tolerance for the CONTENT (below). */
  const refuseAll = (because) => ({
    outcome: 'refused', created: [], refused: [], because,
    creator, purpose, cap,
  });
  if (!creator) return refuseAll('a team needs a creator: name the agent (or "operator") building it, so every agent it makes records who asked for it');
  if (!purpose) return refuseAll('a team needs a stated purpose, because recording why each agent exists is what keeps the roster from drifting');
  if (!members) return refuseAll('give the team as a list of members, each one the same shape create takes ({ name, role, ... })');
  if (members.length === 0) return refuseAll('a team with no members is nothing to build');
  if (members.length > cap) {
    return refuseAll('that is ' + members.length + ' agents in one request and the cap is ' + cap
      + '. Kosmos holds this bound rather than the prompt, so a "build me a team" cannot run away. Split it, or pass a higher cap deliberately.');
  }

  const created = [];
  const refused = [];
  for (const member of members) {
    /* A member that is not even an object cannot be handed to create (the spread
       below would be meaningless), so it is refused here by shape rather than
       reaching createAgent as an empty create. Its own name, if any, is echoed so
       the caller can tell which entry failed. */
    if (!member || typeof member !== 'object' || Array.isArray(member)) {
      refused.push({ name: null, because: 'a team member must be a create spec object ({ name, role, ... })' });
      continue;
    }
    /* The creator and purpose ride onto every member as provenance. They are set
       BY the team, so a member that tries to name its own createdBy/purpose does
       not get to overwrite the truth -- the team is the authority on who built it
       and why, which is exactly the record's value. */
    const out = doCreate(Object.assign({}, member, { createdBy: creator, purpose }));
    const memberName = String((member.name !== undefined && member.name !== null) ? member.name : '').slice(0, 120) || null;
    if (out && out.outcome === 'created') {
      created.push({ name: out.name || memberName, id: (out.id !== undefined ? out.id : null) });
    } else {
      refused.push({ name: memberName, because: (out && out.because) ? String(out.because) : 'creation refused for a reason it did not name' });
    }
  }

  /* The three-way outcome mirrors create's own OUTCOME enum: all made -> created,
     some made -> partial, none made -> refused. A partial team is a real result,
     not a failure to undo: each agent that WAS made exists and is independently
     removable, and a PM that got 4 of 5 with a named reason for the 5th is better
     served than one handed nothing. */
  let outcome = 'partial';
  if (created.length === 0) outcome = 'refused';
  else if (refused.length === 0) outcome = 'created';

  const because = (outcome === 'created')
    ? null
    : (created.length + ' of ' + members.length + ' agents were created; ' + refused.length + ' were refused (see refused[])');

  return { outcome, created, refused, because, creator, purpose, cap };
}

module.exports = { createTeam, DEFAULT_TEAM_CAP };
