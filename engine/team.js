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
 * almost none of the risk"; "create a new role type from scratch" was a separate
 * card (#4474, below), because that is where the default-text generator and the
 * permission model all have to be right at once.
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
 *   - It does not add a role to Kosmos's list. Each member's role is handed to
 *     create.createAgent, which refuses an unknown role with its own sentence,
 *     captured per-member below. #4474: an AGENT (not the setup guide) may give a
 *     made-up role, but only as the `own` role with its label and text
 *     (vetAgentMember below), the same one-agent shape the person's "Describe it
 *     yourself" makes; nothing is saved as a new role, and the agent reuses its
 *     role by reusing its file.
 *   - It does not verify the creator is a live roster agent. The creator string
 *     is recorded as provenance; verifying it belongs to a real agent is the
 *     authoring surface's job (the chat request -> createTeam seam), not this
 *     engine core's.
 */

const create = require('./create');
const store = require('./store');
const instructions = require('./instructions');
const defaults = require('./defaults');

/* Read a created agent's id the SAME way create.createAgent does (#170): from
   the profile, the single mint point. createAgent's RETURN carries no id -- the
   id lives in the profile and the birth record and is read back, never returned
   -- so createTeam must read it back too rather than expecting it on the return.
   Null on any failure or a DRY_RUN create that wrote no profile, exactly like the
   birth record's own id field.
   🔑 WHY THIS AGREES WITH create's birth-record id in EVERY mode, DRY_RUN included,
   WITHOUT a special case: create only ever answers a CREATED outcome for a slug
   that had NO prior profile (its name-taken guard refuses a slug that already has
   one). So on the only path team reaches this read-back -- a CREATED member -- a
   real create just minted the profile (id present, matching), and a DRY_RUN create
   wrote nothing AND there was no prior profile to be stale (else it would have been
   refused, not created), so readProfile finds nothing and returns null, matching
   create's own DRY_RUN null. The two cannot disagree on the id of an agent create
   says it made. */
function defaultReadAgentId(name) {
  try { return store.readProfile(name).id || null; } catch { return null; }
}

/* The Kosmos-owned default. A team assembled for one stated purpose is a handful
   of agents; a request for more than this is far likelier a runaway or a mistake
   than a real org, and Kosmos should say so rather than obey it. The cap only
   ever REFUSES a too-large request; it never trims one silently, because a team
   quietly cut to 12 is its own invisible failure. */
const DEFAULT_TEAM_CAP = 12;

/* 🛑 THE CEILING NO OVERRIDE MAY EXCEED. "Kosmos owns the bound" has to survive a
   deliberate override too: an operator (or a bug) setting cap to a billion would
   turn the loop below into a runaway of its own. So even a trusted override is
   bounded to this. More than this in ONE request is not a team, it is a fleet,
   and belongs in deliberate separate calls. */
const MAX_TEAM_CAP = 50;

/* 🔑 THE CAP OVERRIDE COMES ONLY FROM THE TRUSTED CHANNEL, NEVER FROM `opts`.
   This is the whole of "Kosmos owns the bound, not the prompt": `opts` carries
   the REQUEST (the members a PM agent asked for), and if the override lived there
   a model could raise its own cap and the runaway guard would be defeated by the
   very request it exists to bound. So the override is read from `deps.cap` (set
   by the authoring seam from OPERATOR config, not the model) and the operator env
   AGENT_WORKFORCE_TEAM_CAP -- both trusted, neither reachable from the model's
   request. "Pass a higher cap deliberately" means the OPERATOR, through deps/env,
   and even they are bounded by MAX_TEAM_CAP. */
function resolveCap(deps, env) {
  let cap = DEFAULT_TEAM_CAP;
  const fromDep = deps && deps.cap;
  const fromEnv = env && env.AGENT_WORKFORCE_TEAM_CAP;
  if (Number.isInteger(fromDep) && fromDep > 0) {
    cap = fromDep;
  } else if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).trim() !== '') {
    const n = Number(fromEnv);
    if (Number.isInteger(n) && n > 0) cap = n;
  }
  /* Bounded, not silently trimmed of members: the EFFECTIVE cap is at most the
     ceiling, and a too-large team is then refused against that effective number,
     which the refusal names honestly. */
  return Math.min(cap, MAX_TEAM_CAP);
}

/* The fields of a create request an agent may send. The rest of what create reads is launch mechanics (which
   binary runs, which folder, which platform, the person's own pick) or set by the team itself (createdBy,
   purpose); team.newrole-4474.test.js sorts every field create reads into one of those, so a new one is decided. */
const AGENT_MEMBER_KEYS = ['name', 'role', 'label', 'instructions', 'provider', 'account', 'model', 'projects', 'kind',
  'reportsTo', 'maxHelpers', 'dailyTokenLimit', 'dailyAllowancePct'];
const IDENTITY_LINE = /^(\s*)You are \*\*([^*\n]+)\*\*(?=[,.:;\s-])/;
const RULES_HEADING = defaults.RULES_PHRASE;   // the one phrase appendTo keys on (defaults.js)
/**
 * #4474 (Josh, on #1279: "if the type of agent they need created isn't there, they can create it from scratch"):
 * what an AGENT may ask create for, member by member. The operator path is not vetted here (it is the person).
 * ⚠️ WHAT KIND OF BOUNDARY THIS IS: a cooperative guard. An agent that can read the board token can call the
 * route without its own token, which is the unvetted operator path (as the per-creator cap in server.js says of
 * itself). #4728 measured one agent whose commands are refused that token's folder, a Claude setup guide on
 * macOS; the comment above guideDenyRules in setup-assistant.js has the rows. The vetting keeps a cooperating
 * agent inside the lines.
 *   - Only the fields an agent's request has any use for (AGENT_MEMBER_KEYS): never a runner binary, a config
 *     folder or a launch flag, which would let an agent choose what the new agent's launch job runs (and let the
 *     setup guide, where it is sandboxed, step outside its sandbox, #3769). Other fields are dropped.
 *   - Never the setup guide: that role is Kosmos's own, made once by Kosmos, with its folder locked down (#3769).
 *   - The setup guide makes agents only from the roles on the list (fromGuide): a role it wrote would hand an
 *     agent without the guide's guards instructions the guide itself may not act on. The person writes their own in New agent.
 *   - A role's own label or text are not replaced under a built-in role's key: a made-up role is the `own` role
 *     with a label and text, so no agent reads as a Bookkeeper while carrying other instructions.
 *   - The shared working rules stay as Kosmos wrote them: create appends them when their heading is missing, and
 *     text that keeps the heading must keep the rules under it word for word (defaults.block).
 *   - In made-up text, {{NAME}} becomes the member's name, and text that does not open with the identity line
 *     gets one, "You are **<name>**, <label>.", the line every role's text starts with (the board's fallback for
 *     the agent's name, status.readIdentity).
 * Returns { member } (a copy with only the allowed fields, possibly with its text completed) or { because }.
 */
function vetAgentMember(member, opts) {
  const fromGuide = !!(opts && opts.fromGuide === true);
  /* The role exactly as create reads it, through its own create.roleKeyOf: a role sent as ["setup"] is not the
     string 'setup' until coerced, and create would make the guide from it. One function, so the two cannot
     disagree (the repo's two-derivations rule, #1228). */
  const role = create.roleKeyOf(member);
  if (role === 'setup') {
    return { because: 'the setup guide is Kosmos\'s own and only Kosmos makes it; pick another role, or write a new one with --new-role' };
  }
  const madeUp = member.label !== undefined || member.instructions !== undefined;
  if (madeUp && fromGuide) {
    return { because: 'the setup guide makes agents from the roles on the list; for a role of their own, walk the person through New agent, then Describe it yourself' };
  }
  if (madeUp && role !== 'own') {
    return { because: 'a role\'s own label and text are not replaced; to make an agent with a role of your own, use role own with a label and text (kosmos agent create "<name>" --new-role "<label>" --from <file>)' };
  }
  const out = {};
  for (const k of AGENT_MEMBER_KEYS) if (member[k] !== undefined) out[k] = member[k];
  if (member.role !== undefined) out.role = role;   // the role as vetted, a string, never the shape it was sent in
  /* The label is flattened on every path (with or without text), so it can break neither the identity line nor
     the card: a newline or any control character (a NUL would ride into the text through the identity line), or
     a ** run (a single * a person meant, as in "C* specialist", is kept). */
  const label = typeof member.label === 'string'
    ? member.label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\*\*+/g, '').replace(/\s+/g, ' ').trim() : '';   // no control char (NUL too)
  if (typeof member.label === 'string') out.label = label;
  if (typeof member.instructions !== 'string') return { member: out };
  /* NUL is never text: a file saved as UTF-16 and read as UTF-8 has one between every letter, and would pass
     every length check (the Windows CLI decodes by BOM; this is the backstop for any AGENT caller, the operator
     path is not vetted here). */
  if (member.instructions.includes('\u0000')) {
    return { because: 'this role\'s text has characters that are not text, as a file saved in UTF-16 does; save it as plain text (UTF-8) and try again' };
  }
  /* The name goes into the identity line as given: create's own name rule (nameProblem) refuses a *, a tab or a
     newline in it before anything is written, so it cannot break the line. Loosen that rule and this needs the
     label's flattening too. */
  const name = String(member.name === undefined || member.name === null ? '' : member.name).trim();
  /* Line endings as \n: a file that went through a Windows editor or PowerShell has \r\n, and the rules check
     below compares the shared rules word for word. */
  let text = member.instructions.replace(/\r\n?/g, '\n').split('{{NAME}}').join(name);
  /* This stops edits INSIDE the shared rules; text elsewhere can still say otherwise, as any role's text can. */
  if (text.includes(RULES_HEADING) && !text.includes(defaults.block().trim())) {
    return { because: 'the text names the shared working rules ("' + RULES_HEADING + '") but does not carry them as Kosmos wrote them; leave that section as kosmos agent role-draft --to writes it, or delete it whole and Kosmos adds it back' };
  }
  /* Only text create would take on its own gets the line: padding blank or too-short text with it would carry
     it past create's own "say what this agent is for" minimum (instructions.MIN_CHARS), and an agent would be
     made whose whole brief is its name. */
  const enough = text.trim().length >= instructions.MIN_CHARS;
  const said = IDENTITY_LINE.exec(text);
  if (said && name && said[2].trim() !== name) {
    /* Written for another name ("You are **Bob**," for Ann): the agent's own brief would contradict its name.
       A replacer FUNCTION, so a name carrying $&, $' or $1 is written as typed, never expanded. */
    text = text.replace(IDENTITY_LINE, (_, lead) => lead + 'You are **' + name + '**');
  } else if (!said && enough && name && label) {
    text = 'You are **' + name + '**, ' + label + '.\n\n' + text.replace(/^\s+/, '');
  }
  out.instructions = text;
  return { member: out };
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
 *   NOTE: `opts` carries the REQUEST only. It deliberately has no cap field -- a
 *   cap on the request would let a model raise its own bound.
 * @param {boolean} [opts.fromAgent]  #4474: the request came from an agent's token, so each member is vetted
 *   (vetAgentMember) before create; a member it refuses lands in refused[] like any other.
 * @param {boolean} [opts.fromGuide]  #4474: that agent is the setup guide, which makes agents only from the list.
 * @param {object} [deps]  { createAgent, readAgentId, cap, env } -- the TRUSTED
 *   channel, injectable for tests; defaults to create.createAgent, the profile-id
 *   reader, and process.env. `deps.cap` is the operator/seam cap override (never
 *   the model's), bounded by MAX_TEAM_CAP.
 * @returns {{outcome:'created'|'partial'|'refused',
 *   created:Array<{name,shownAs,id}>, refused:Array<{name,because}>,
 *   because:(string|null), creator:string, purpose:string, cap:number}}
 */
function createTeam(opts, deps) {
  const doCreate = (deps && typeof deps.createAgent === 'function') ? deps.createAgent : create.createAgent;
  const readId = (deps && typeof deps.readAgentId === 'function') ? deps.readAgentId : defaultReadAgentId;
  const env = (deps && deps.env) || process.env;

  const creator = (opts && typeof opts.creator === 'string') ? opts.creator.trim() : '';
  const purpose = (opts && typeof opts.purpose === 'string') ? opts.purpose.trim() : '';
  const members = (opts && Array.isArray(opts.members)) ? opts.members : null;
  const cap = resolveCap(deps, env);

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
      + '. Kosmos holds this bound rather than the prompt, so a "build me a team" cannot run away. Split it into separate calls, or have the OPERATOR raise the cap (up to ' + MAX_TEAM_CAP + ').');
  }

  const created = [];
  const refused = [];
  for (const asked of members) {
    let member = asked;
    /* A member that is not even an object cannot be handed to create (the spread
       below would be meaningless), so it is refused here by shape rather than
       reaching createAgent as an empty create. Its own name, if any, is echoed so
       the caller can tell which entry failed. */
    if (!member || typeof member !== 'object' || Array.isArray(member)) {
      refused.push({ name: null, because: 'a team member must be a create spec object ({ name, role, ... })' });
      continue;
    }
    if (opts.fromAgent === true) {
      const vet = vetAgentMember(member, { fromGuide: opts.fromGuide === true });
      if (vet.because) {
        refused.push({ name: String((member.name !== undefined && member.name !== null) ? member.name : '').slice(0, 120) || null, because: vet.because });
        continue;
      }
      member = vet.member;
    }
    /* The creator and purpose ride onto every member as provenance. They are set
       BY the team, so a member that tries to name its own createdBy/purpose does
       not get to overwrite the truth -- the team is the authority on who built it
       and why, which is exactly the record's value. */
    const out = doCreate(Object.assign({}, member, { createdBy: creator, purpose }));
    const memberName = String((member.name !== undefined && member.name !== null) ? member.name : '').slice(0, 120) || null;
    if (out && out.outcome === 'created') {
      /* The id is read back from the profile by the agent's canonical NAME (the
         slug create.createAgent returns), never taken off the create return --
         which carries no id. Same source create.createAgent's own birth record
         reads (#170), so the two can never disagree. */
      const createdName = out.name || memberName;
      /* name is the canonical SLUG (what addresses the agent everywhere); shownAs
         is the display name the person would read, which create.createAgent
         returns separately and which is dropped if not carried here. A caller
         listing a freshly-built team needs both: the slug to address, the shown
         name to render. */
      created.push({
        name: createdName,
        shownAs: (out.shownAs !== undefined && out.shownAs !== null) ? out.shownAs : createdName,
        id: (createdName ? readId(createdName) : null),
      });
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

module.exports = { createTeam, resolveCap, vetAgentMember, AGENT_MEMBER_KEYS, DEFAULT_TEAM_CAP, MAX_TEAM_CAP };
