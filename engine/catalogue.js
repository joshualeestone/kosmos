'use strict';
/**
 * #4555 (#4554 parts 1-2): the seeded catalogue of ready-made ROLES beyond the
 * original set in engine/roles.js, and of prebuilt TEAMS (a lead plus 4 or 5
 * reports) a person can create in one go (#4557).
 *
 * The data is two generated modules beside this one, catalogue-roles.js and
 * catalogue-teams.js (`module.exports = <JSON>;`, .js because the builds ship
 * engine/*.js only), made by tools/catalogue/build.js from
 * tools/catalogue/*-source.js. Edit the source and rebuild;
 * engine/catalogue.test.js fails when the data and its source disagree.
 *
 * This module is the one reader of those files: roles.js merges `rawRoles()` into
 * ROLES (so the picker, the roles route and `kosmos agent roles` see them), and
 * team creation reads `teams()` and `memberInstructions()`. Nothing else reads
 * the data modules.
 *
 * It must not require ./roles at load: roles.js requires this module while it
 * builds ROLES. `memberInstructions` requires it lazily, when roles is complete.
 */
const path = require('node:path');

const ROLES_FILE = path.join(__dirname, 'catalogue-roles.js');
const TEAMS_FILE = path.join(__dirname, 'catalogue-teams.js');

let rolesData = null;
let teamsData = null;
function readRoles() { if (!rolesData) rolesData = require(ROLES_FILE); return rolesData; }
function readTeams() { if (!teamsData) teamsData = require(TEAMS_FILE); return teamsData; }

/** The menu order of role groups, first to last. */
function groupOrder() { return readRoles().groups.slice(); }

/**
 * The catalogue roles in the same shape as a roles.js entry, `instructions` as
 * one string. A fresh copy each call: roles.js appends its rhythm to what it gets.
 */
function rawRoles() {
  return readRoles().roles.map((r) => ({ ...r, instructions: r.instructions.join('\n') }));
}

/** Every prebuilt team, ordered business first, then personal, each by rank. Copies, like
 *  rawRoles(): a caller editing one (a form, say) must not change the catalogue for the process. */
function teams() {
  const kinds = ['business', 'personal'];
  return structuredClone(readTeams().teams)
    .sort((a, b) => (kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) || (a.rank - b.rank));
}

function team(key) {
  const t = readTeams().teams.find((x) => x.key === String(key || ''));
  return t ? structuredClone(t) : null;
}

/** The one member whose reportsTo is null. */
function leadOf(t) { return t.members.find((m) => m.reportsTo === null) || null; }

function wrapLines(text, first, rest) {
  const out = [];
  let line = first;
  let empty = true;
  // A `code span` is one token, together with anything touching it on either side (the "(" and
  // ")," around a command), so a command is never broken across two lines.
  for (const word of String(text).match(/\S*`[^`]*`\S*|\S+/g) || []) {
    const next = empty ? line + word : line + ' ' + word;
    if (!empty && next.length > 76) { out.push(line); line = rest + word; } else line = next;
    empty = false;
  }
  out.push(line);
  return out;
}

/** The name the person chose for a member's seat, or the seed's name when they chose none. */
function chosenName(x, names) {
  return (names && typeof names[x.slot] === 'string') ? names[x.slot].trim() : x.name;
}

/**
 * Why memberInstructions would return null for these arguments, in a sentence a person can
 * read, or null when it would not. It knows only the catalogue and create's name rules, not the
 * board: a name an existing agent already holds is the caller's to check.
 */
function memberProblem(teamKey, slot, names) {
  const t = team(teamKey);
  if (!t) return `there is no prebuilt team called ${JSON.stringify(String(teamKey))}`;
  const m = t.members.find((x) => x.slot === slot);
  if (!m) return `the ${t.label} has no member ${JSON.stringify(String(slot))}`;
  // Lazy, like roles: create requires roles, which requires this module.
  const create = require('./create');
  for (const k of Object.keys(names || {})) {
    if (!t.members.some((x) => x.slot === k)) return `the ${t.label} has no seat ${JSON.stringify(k)} to name`;
  }
  const bySlug = new Map();
  for (const x of t.members) {
    // A name that is present but is not text (a number, null from a JSON body) is refused, like a
    // blank one, rather than quietly replaced by the seed's name.
    if (names && Object.prototype.hasOwnProperty.call(names, x.slot) && typeof names[x.slot] !== 'string') {
      return `the name for the ${x.title} must be text`;
    }
    const problem = create.nameProblem(chosenName(x, names));
    if (problem !== null) return `the name for the ${x.title} cannot be used: ${problem}`;
    // Two seats create would call the same agent: create would refuse the second one.
    const slug = create.slugFor(chosenName(x, names));
    if (bySlug.has(slug)) return `the ${bySlug.get(slug).title} and the ${x.title} have the same name; give each a different one`;
    bySlug.set(slug, x);
  }
  if (!require('./roles').byKey(m.role)) return `the ${m.title} needs the role ${JSON.stringify(m.role)}, which this version does not have`;
  return null;
}

/**
 * The full instruction file for one member of one team, ready to write: the
 * member's role text (with {{NAME}} filled in, because create writes explicit
 * instructions verbatim, create.js) plus an `## On this team` section naming the
 * lead and the teammates by the names the person actually chose.
 *
 * @param {string} teamKey
 * @param {string} slot                         the member's slot, e.g. 'lead'
 * @param {Object<string,string>} [names]       slot -> the agent name chosen; a
 *                                              slot left out keeps the seed's name
 * @returns {string|null} null exactly when memberProblem() returns a reason: an unknown
 *   team, slot or role, a name create refuses, or two seats with the same name.
 */
function memberInstructions(teamKey, slot, names) {
  if (memberProblem(teamKey, slot, names) !== null) return null;
  const t = team(teamKey);
  const m = t.members.find((x) => x.slot === slot);
  const nameOf = (x) => chosenName(x, names);
  const create = require('./create');
  // What a `kosmos msg` command must carry: the machine name (lowercase, spaces folded), so a
  // two-word name cannot split into a recipient and the start of the message.
  const handleOf = (x) => create.slugFor(nameOf(x));
  const roles = require('./roles');
  const base = roles.instructionsFor(m.role, nameOf(m));
  const lead = leadOf(t);
  const lines = ['', '## On this team', ''];
  if (m.reportsTo === null) {
    lines.push(...wrapLines(`You lead the ${t.label} for the person you work for.`, '', ''));
    lines.push('', 'Your team, and what each of them is here for:', '');
    for (const x of t.members.filter((y) => y !== m)) {
      lines.push(...wrapLines(`**${nameOf(x)}** (\`kosmos msg ${handleOf(x)}\`), ${x.title}: ${x.focus.join(' ')}`, '- ', '  '));
    }
    lines.push('');
    lines.push(...wrapLines(`Brief each of them with the command beside their name, check what comes back before it reaches the person you work for, and keep the team working toward this goal: ${t.project.goal}`, '', ''));
  } else {
    lines.push(...wrapLines(`You are the ${m.title} on the ${t.label}. You report to **${nameOf(lead)}**, the ${lead.title}: take your work from ${nameOf(lead)}, and send finished work and questions back with \`kosmos msg ${handleOf(lead)} "..."\`.`, '', ''));
    const peers = t.members.filter((y) => y !== m && y !== lead).map((y) => `${nameOf(y)} (${y.title})`);
    if (peers.length) lines.push('', ...wrapLines(`Your teammates: ${peers.join(', ')}.`, '', ''));
    lines.push('', ...wrapLines(`The team's goal: ${t.project.goal}`, '', ''));
  }
  if (m.focus.length) {
    lines.push('', 'Your focus here:', '');
    for (const f of m.focus) lines.push(...wrapLines(f, '- ', '  '));
  }
  return base.replace(/\n+$/, '\n') + lines.join('\n') + '\n';
}

module.exports = { ROLES_FILE, TEAMS_FILE, groupOrder, rawRoles, teams, team, leadOf, memberInstructions, memberProblem };
