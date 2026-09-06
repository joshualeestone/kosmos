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
    case 'doctrine': return safe(() => { const d = require(path.join(REPO, 'engine', 'doctrine.js')); const r = d.read ? d.read() : null; return !!(r && (r.text || r.state === 'present')); });
    /* Unconditional instruction text: these produce a body even with an empty
       argument, so "nothing to deliver" can never explain their absence. */
    case 'reports':    return safe(() => String(require(path.join(REPO, 'engine', 'reports.js')).blockBody({}) || '').length > 0);
    case 'colleagues': return safe(() => String(require(path.join(REPO, 'engine', 'messages.js')).blockBody([]) || '').length > 0);
    case 'connections': return true;
    /* ⚠️ MEMBERSHIP, NOT UNIVERSAL. An agent outside every project is RIGHT to
       lack this, so a raw count reads fifteen correct absences as a failure. */
    case 'projects': return safe(() => (projects.readAll() || []).length > 0);
    default: return null;
  }
}

/* Who is entitled to each block. Only `projects` is narrower than everyone. */
function entitled(name, agents) {
  if (name !== 'projects') return agents;
  try {
    const members = new Set();
    for (const p of projects.readAll() || []) for (const m of (p.members || p.agents || [])) members.add(String(m));
    return agents.filter((a) => members.has(a));
  } catch { return null; }
}

const names = ['projects', 'you', 'reports', 'connections', 'policy', 'doctrine', 'colleagues'];

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

let undelivered = 0; let stale = 0; let cannotTell = 0;
for (const name of names) {
  const marker = '<!-- kosmos:' + name + ':start -->';
  const have = agents.filter((a) => text[a].includes(marker));
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
      if (missing.length) { bits.push('UNDELIVERED to ' + missing.length); undelivered += 1; }
      if (extra.length) { bits.push('STALE on ' + extra.join(', ')); stale += 1; }
      verdict = bits.join('; ');
    }
  }
  console.log('  ' + name.padEnd(12) + String(have.length + '/' + agents.length).padEnd(9)
    + String(ent === null ? '?' : ent.length).padEnd(10) + verdict);
}

console.log('');
console.log(undelivered + ' block(s) undelivered, ' + stale + ' stale, ' + cannotTell + ' unreadable.');
console.log('This tool CHANGES NOTHING. Syncing rewrites the files agents boot from (#1071).');
/* Exit 0 always: this is a REPORT, and a non-zero here would wire a standing
   fleet condition into every caller's failure path. A number is the output. */
