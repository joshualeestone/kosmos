#!/usr/bin/env node
'use strict';
/**
 * Which managed instruction blocks have actually REACHED the agents?
 *
 * 🛑 WHY THIS EXISTS. Every managed block is written by a function that returns
 * `told`, and `told` means THE WRITE WAS ATTEMPTED, not that the agent has it
 * (#1071). #1034 returned `told` for a sweep that never ran and reached zero of
 * seventeen agents while being merged, tested and gate-green. Nobody knew,
 * because nobody had looked at the other end.
 *
 * ⭐ SAME SHAPE AS `exit 0` MEANING SUBMITTED RATHER THAN DELIVERED. The
 * sender's success is not the receiver's state, and only the receiver can say.
 * This reads the receiver: the agent brief files themselves -- CLAUDE.md for a
 * claude agent, AGENTS.md for a codex agent (#2245/#2259), each read from the
 * file that agent actually boots from.
 *
 *   node tools/check-block-delivery.js
 *
 * Read-only. It prints a table and CHANGES NOTHING. Syncing rewrites the files
 * agents boot from, and #1071 is explicit that the decision belongs to a person.
 *
 * 🔑 A ZERO HAS TWO CAUSES AND THIS TOOL REFUSES TO MERGE THEM. A block can be
 * absent because it was never delivered, or because THERE IS NOTHING TO
 * DELIVER -- no `you` record saved, no policies, no doctrine. Counting
 * absences alone reported FIVE undelivered blocks on this machine when the
 * true number was two; two of the other three were correctly empty and one was
 * a membership block that fifteen agents are right not to have.
 * ⚠️ That wrong count would have argued for rewriting seventeen agents' boot
 * instructions. The distinction below is the whole value of the tool.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const projects = require(path.join(REPO, 'engine', 'projects.js'));

const WORKERS = process.env.KOSMOS_WORKERS_DIR || path.join(process.env.HOME || '', 'work', 'workers');

/* An agent's brief is the file it BOOTS from: AGENTS.md for a codex agent,
   CLAUDE.md for a claude agent (engine/create.js briefFilename). Before #2245
   every agent booted CLAUDE.md; a codex agent now boots AGENTS.md and has no
   CLAUDE.md (#2245), so reading only CLAUDE.md silently OMITS exactly the
   population #2245 added -- the most reassuring possible way to be blind, and
   the same false-clean this tool exists to prevent. Resolve the real brief per
   agent; null if the folder is not an agent.

   ⚠️ CLAUDE.md WINS WHEN BOTH EXIST -- the same precedence engine/discover.js
   connect() uses ("a person who has both has a Claude agent that also carries
   codex notes"), so a both-present migration folder resolves to the file it
   actually boots. A codex agent's runner change MOVES the brief (create.js), so
   in the normal case exactly one file is present and order is moot; only the
   ambiguous both-present case turns on it, and it must match discover.js. */
function briefPath(dir) {
  for (const fn of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(dir, fn);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* try the next brief name */ }
  }
  return null;
}

/* Whether each block currently has ANYTHING to deliver. Asked of the source of
   truth, never inferred from the agents' files -- inferring it from the thing
   you are measuring is how a zero becomes self-confirming. */
function hasContent(name) {
  const safe = (fn) => { try { return fn(); } catch { return null; } };
  switch (name) {
    case 'you':      return safe(() => require(path.join(REPO, 'engine', 'you.js')).read().state !== 'absent');
    case 'policy':   return safe(() => (require(path.join(REPO, 'engine', 'policy.js')).read().policies || []).length > 0);
    /* doctrine is never asked here: it has no read(), and asking one made every
       agent's working-rules block read "nothing to deliver" (#1071). It is
       measured per agent below, through the module's own planFor. */
    /* Unconditional instruction text: these produce a body even with an empty
       argument, so "nothing to deliver" can never explain their absence. */
    case 'reports':    return safe(() => String(require(path.join(REPO, 'engine', 'reports.js')).blockBody({}) || '').length > 0);
    case 'colleagues': return safe(() => String(require(path.join(REPO, 'engine', 'messages.js')).blockBody([]) || '').length > 0);
    case 'connections': return true;
    /* Per agent (its own Files path), never empty. */
    case 'dmfiles':     return true;
    /* A swarm lead's block always has a body; WHO leads is the entitlement. */
    case 'swarm':       return true;
    /* ⚠️ MEMBERSHIP, NOT UNIVERSAL. An agent outside every project is RIGHT to
       lack this, so a raw count reads fifteen correct absences as a failure. */
    case 'projects': return safe(() => (projects.readAll() || []).length > 0);
    default: return null;
  }
}

/* Who is entitled to each block. Only `projects` is narrower than everyone. */
function entitled(name, agents) {
  /* ⚠️ ROLE, NOT UNIVERSAL: only an agent made as a swarm carries the swarm block. */
  if (name === 'swarm') {
    try {
      const store = require(path.join(REPO, 'engine', 'store.js'));
      const swarm = require(path.join(REPO, 'engine', 'swarm.js'));
      /* ⚠️ readProfile answers {} for a missing OR unreadable profile, so "not a
         swarm" and "could not look" arrive looking the same. An agent carrying the
         swarm block with an empty profile is the one case that matters, and it is
         CANNOT TELL, never a STALE verdict built on a read that did not happen. */
      const leads = [];
      for (const a of agents) {
        const prof = store.readProfile(a);
        const carries = text[a].includes(projects.SWARM_START);
        if (carries && (!prof || Object.keys(prof).length === 0)) return null;
        if (swarm.settingsOf(prof) !== null) leads.push(a);
      }
      return leads;
    } catch { return null; }
  }
  if (name !== 'projects') return agents;
  try {
    const members = new Set();
    for (const p of projects.readAll() || []) for (const m of (p.members || p.agents || [])) members.add(String(m));
    return agents.filter((a) => members.has(a));
  } catch { return null; }
}

/* 🛑 THE BLOCK LIST COMES FROM THE REGISTRY, NOT FROM THIS FILE (#1071). A
   hardcoded list of seven went blind to dmfiles and swarm the day they were
   added, and a block the tool does not list reads as nothing at all, which is
   the quietest possible way to be wrong. A block added later with no case in
   hasContent reads CANNOT TELL, which is loud on purpose. */
const names = [];
const registry = projects.ALL_MARKERS();
for (const m of registry) {
  const hit = /^<!-- kosmos:([a-z0-9-]+):start -->$/.exec(m);
  if (hit && !names.includes(hit[1])) names.push(hit[1]);
}
/* A marker this pattern cannot parse would drop out of the table in silence, the
   defect the registry read exists to end. Every block is one start and one end. */
const unparsed = registry.length !== names.length * 2;

let agents;
try {
  agents = fs.readdirSync(WORKERS).filter((d) => briefPath(path.join(WORKERS, d)) !== null);
} catch (e) {
  console.error('FAIL  cannot read ' + WORKERS + ' (' + e.code + '); nothing below would describe the fleet');
  process.exit(2);
}

/* 🔑 A FLOOR ON THE POPULATION. With zero agent files every block reads as
   delivered-to-all, which is the most reassuring possible way to be blind. */
if (!agents.length) {
  console.error('FAIL  no agent brief files (CLAUDE.md or AGENTS.md) under ' + WORKERS + '; every verdict below would be vacuous');
  process.exit(2);
}

const text = Object.fromEntries(agents.map((a) => [a, fs.readFileSync(briefPath(path.join(WORKERS, a)), 'utf8')]));
/* 🔑 NAME BOTH SUBJECTS, NOT JUST ONE (Ice Cream Kitty's rule, 2026-08-27:
   publish the query with the count, the endpoint with the reading). This tool
   reads TWO different things -- the agents' files, and the ENGINE that says
   what should have been delivered -- and they can come from different places.
   The engine is whatever repo this script sits in, so running it from a
   worktree answers about THAT worktree's state while the fleet dir is shared.
   ⚠️ Four people spent this morning confidently measuring the wrong host. A
   verdict that does not name its subjects is one override away from that. */
console.log('fleet:  ' + WORKERS + '   (' + agents.length + ' agents)');
console.log('engine: ' + REPO);
console.log('');
console.log('block'.padEnd(14) + 'has it'.padEnd(9) + 'entitled'.padEnd(10) + 'verdict');

let undelivered = 0; let stale = 0; let cannotTell = 0; let awaiting = 0;
let currentDoctrine = null; let colleaguesShort = false;
for (const name of names) {
  const marker = '<!-- kosmos:' + name + ':start -->';
  const have = agents.filter((a) => text[a].includes(marker));
  if (name === 'doctrine') {
    /* 🔑 THE WORKING RULES ARE CONSENTED, NOT SWEPT (#539). An agent is current
       when every section is in its file, inside the managed span or as its own
       text, so the marker count says little. Asked of doctrine.planFor on the
       text read above, the same composition the consent dialog shows. Behind
       is its own verdict: the path to current is the person's click, not a
       sync, so it is never counted as undelivered. */
    let verdict;
    try {
      const doctrine = require(path.join(REPO, 'engine', 'doctrine.js'));
      const now = Date.now();
      const plan = Object.fromEntries(agents.map((a) => [a, doctrine.planFor(text[a], now).state]));
      const behind = agents.filter((a) => plan[a] === 'refresh');
      const unsure = agents.filter((a) => plan[a] === 'could_not');
      currentDoctrine = agents.filter((a) => plan[a] === 'current').length;
      if (unsure.length) { verdict = 'CANNOT TELL on ' + unsure.join(', '); cannotTell += 1; }
      else if (!behind.length) verdict = 'current on all';
      else { verdict = 'behind on ' + behind.length + ', awaiting the person\'s consented refresh (#539)'; awaiting += 1; }
    } catch { verdict = 'CANNOT TELL -- could not read its source'; cannotTell += 1; }
    /* "has it" is agents CURRENT here, not agents carrying the marker: a file can
       hold the rules as its own text with no marker, or a marked but outdated span. */
    console.log('  ' + name.padEnd(12) + String((currentDoctrine === null ? '?' : currentDoctrine) + '/' + agents.length).padEnd(9)
      + String(agents.length).padEnd(10) + verdict);
    continue;
  }
  const content = hasContent(name);
  const ent = entitled(name, agents);
  let verdict;
  if (content === null || ent === null) { verdict = 'CANNOT TELL -- could not read its source'; cannotTell += 1; }
  else if (content === false) {
    verdict = have.length ? 'STALE on ' + have.join(', ') + ' (nothing to deliver)' : 'correctly absent (nothing to deliver)';
    if (have.length) stale += 1;
  } else {
    const missing = ent.filter((a) => !have.includes(a));
    const extra = have.filter((a) => !ent.includes(a));
    if (!missing.length && !extra.length) verdict = 'delivered to all entitled';
    else {
      const bits = [];
      if (missing.length) {
        bits.push('UNDELIVERED to ' + missing.length); undelivered += 1;
        if (name === 'colleagues') colleaguesShort = true;
      }
      if (extra.length) { bits.push('STALE on ' + extra.join(', ')); stale += 1; }
      verdict = bits.join('; ');
    }
  }
  console.log('  ' + name.padEnd(12) + String(have.length + '/' + agents.length).padEnd(9)
    + String(ent === null ? '?' : ent.length).padEnd(10) + verdict);
}

if (unparsed) {
  console.log('  CANNOT TELL: the registry holds ' + registry.length + ' markers but only '
    + names.length + ' blocks parsed, so some block has no row above');
  cannotTell += 1;
}
console.log('');
console.log(undelivered + ' block(s) undelivered, ' + stale + ' stale, ' + cannotTell + ' unreadable, '
  + awaiting + ' awaiting consent.');
/* ⚠️ colleagues IS BIRTH-ONLY, AND ONLY FOR ROLE-TEMPLATE AGENTS (engine/create.js:
   custom instructions get nothing appended uninvited; projects.healColleagues only
   refreshes a block already there). Its UNDELIVERED count therefore includes agents
   made from the person's own words, which lack it by design. Said here rather than
   guessed per agent, because nothing on disk records which way an agent was made. */
if (colleaguesShort) {
  console.log('Note: colleagues is added at birth to role-template agents only; an agent made');
  console.log('from custom instructions lacks it by design, so its count is an upper bound.');
}
console.log('This tool CHANGES NOTHING. Syncing rewrites the files agents boot from (#1071).');
/* Exit 0 always: this is a REPORT, and a non-zero here would wire a standing
   fleet condition into every caller's failure path. A number is the output. */
