'use strict';

/**
 * Who an agent reports to, written where the agent reads it (#336).
 *
 * The record has carried `reportsTo` and `role` since the org chart shipped,
 * and every SCREEN read them; the agent never did. A person dragged someone
 * under a manager on the org chart, the record moved, and the agent kept
 * reporting to whoever its file said, which was nobody in particular. Josh,
 * 2026-08-23 09:47: "do we put that into their file as well? if so, we
 * definitely should so that the agent is aware of that".
 *
 * ONE managed block, `## Who you report to`, with its own markers, spliced by
 * the same projects.findBlock/spliceBlock machinery as the about-you block
 * and for the same reason: one derivation of the tight-pair matching and the
 * refuse-on-ambiguity rule.
 *
 * 🔑 ALWAYS PRESENT. Josh, 09:55: an agent nobody has assigned reports to
 * the person, and there is no "nobody". So an empty `reportsTo` is not the
 * block's absence, it is the block naming the person (by the About-you name,
 * or "the person who runs this computer" until that exists). It is rewritten
 * on every profile save and never removed for being empty.
 *
 * 🔑 KEYED ON THE AGENT, NEVER ON ITS ROLE. `key: 'own'` has no role content,
 * which is how it went without a #122 block for as long as the product
 * existed (#333). An agent somebody described in their own words gets this
 * block identically to one picked off the menu: at birth from create.js, and
 * on every later save from the route. That is also why the own template
 * carries no reporting words of its own: two places for one fact is the
 * defect #333 removed.
 *
 * The meaning of reporting is already in the #122 block every agent carries
 * ("Report four things, to whoever you report to"). This block only names
 * the who, and settles the two things that go wrong in practice: where a
 * question goes, and who wins when a manager and the person disagree.
 */

const store = require('./store');
const instructions = require('./instructions');
const projects = require('./projects');

const START = projects.REPORTS_START;
const END = projects.REPORTS_END;

/* Why this module writes an agent's file, for the stale marker (#323). Kept
   up here, away from the verdict sentences the group-map pin scans for. */
const WROTE_WHY = {
  to: (who) => `Kosmos set it to report to ${who}`,
};

function clean(value) {
  return projects.neutralise(String(value == null ? '' : value).replace(/\s+/g, ' ')).trim();
}

/**
 * How the person is named in an agent's file: the About-you name when one is
 * saved, else a true description. Never "you": the file is read by the agent,
 * and "you" in it would mean the agent.
 */
function personName() {
  try {
    const rec = require('./you').read();
    if (rec.state === 'saved' && rec.you && rec.you.name) return clean(rec.you.name);
  } catch { /* fall through */ }
  return 'the person who runs this computer';
}

/* kosmos#1676. `personName()` falls back to a generic phrase, so naming the
   operator inline produced "run by the person who runs this computer". This
   says the same fact in whichever of the two states the record is in. */
function personLine() {
  const who = personName();
  return who === 'the person who runs this computer'
    ? 'This computer is run by a person.'
    : `This computer is run by **${who}**.`;
}

/* The name a manager is known by: its display name when the record has one,
   else the session name, which is what the org chart stores. */
function managerName(sessionName) {
  const key = clean(sessionName);
  try {
    const p = store.readProfile(key);
    if (p && typeof p.displayName === 'string' && p.displayName.trim()) return clean(p.displayName);
  } catch { /* the key is the name */ }
  return key;
}

/**
 * The block, in the voice the agent reads. `profile` is the agent's own
 * record (`role`, `reportsTo`); both optional.
 */
function blockBody(profile) {
  const p = profile || {};
  const title = typeof p.role === 'string' && p.role.trim() ? clean(p.role) : null;
  const to = typeof p.reportsTo === 'string' && p.reportsTo.trim() ? managerName(p.reportsTo) : null;
  const lines = ['## Who you report to', ''];
  const head = title ? `Kosmos lists you as **${title}**. ` : '';
  if (to) {
    lines.push(
      `${head}You report to **${to}**. When your instructions say "whoever you report`,
      'to", that is them. Your four reports (started, stopped, blocked, decided) go',
      'to them, and a question only a person can answer goes to them first; they',
      'will take it to the person if it needs to. They can hand you work and',
      'reorder yours. They do not replace the person: if the two ever disagree,',
      'the person wins, and you say so to both.',
      '',
      /* kosmos#1676. Everything above is about ESCALATION, and an agent that
         read it correctly then greeted its manager in a reply meant for the
         person: this block named exactly one human, so it was the only name
         it had. `personName()` was called only in the branch below, which is
         the branch a managed agent never reaches. */
      `**Reporting to them is not the same as being spoken to by them.** ${personLine()}`,
      `Either they or ${to} can write to you.`,
      '',
      '**You answer whoever sent the message, not whoever you report to.** The',
      'message says who it came from. Read that before you greet anyone by name:',
      'answering one person by another person\'s name reads as not having looked.',
    );
  } else {
    lines.push(
      `${head}You report to **${personName()}** directly. When your instructions say`,
      '"whoever you report to", that is them. Your four reports (started, stopped,',
      'blocked, decided) go to them, and so does any question only a person can',
      'answer.',
    );
  }
  return lines.join('\n');
}

/** The body for an agent, from its record on disk. */
function bodyFor(sessionName) {
  let profile = {};
  try { profile = store.readProfile(sessionName) || {}; } catch { profile = {}; }
  return blockBody(profile);
}

/**
 * Write (or rewrite) the block in one agent's instruction file.
 *
 * Same guard sequence as you.tellAgent, for its reasons: exact match to
 * permit on a session the board can name as ours, the reader's own editable
 * verdict, never inventing a boot file, refusing two well-formed blocks, and
 * never throwing. Returns the projects.TOLD verdict shape so the route and
 * the screen read one vocabulary.
 */
function tellAgent(sessionName, roster, opts) {
  try {
    /* `trusted`: the caller has already established this is an agent of ours
       by its record (the profile route answers 404 otherwise), so a STOPPED
       agent can be told. That is Josh's assign-later case: make it, place it
       under a manager days afterwards, and it is not running at the time. The
       file is read at its next start, so writing it now is exactly right and
       needs no restart. Everything else keeps the roster gate. */
    const vouched = !!(opts && opts.trusted);
    if (!vouched && (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === sessionName && a.isNamedOurs === true))) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : roster.some((a) => a && a.sessionName === sessionName)
            ? 'something is running under this name, but we cannot tell that it is this agent'
            : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const current = instructions.read(sessionName);
    if (!current.exists && !current.editable) {
      return { state: projects.TOLD.COULD_NOT, because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    }
    if (!current.exists) {
      return { state: projects.TOLD.COULD_NOT, because: 'it has no instructions file yet, and we will not create one' };
    }
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos reports-to blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    let profile = {};
    try { profile = store.readProfile(sessionName) || {}; } catch { profile = {}; }
    const next = projects.spliceBlock(current.text || '', blockBody(profile), START, END);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    const who = profile.reportsTo ? managerName(profile.reportsTo) : personName();
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: WROTE_WHY.to(who) });
    return { state: projects.TOLD.TOLD, because: null };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: projects.TOLD.COULD_NOT,
      because: /larger than an instruction file should be/.test(raw)
        ? 'its instructions are already at the size limit'
        : (raw || 'we could not write to its instructions'),
    };
  }
}

/** Every agent the board can name as ours, e.g. after the person's own name changes. */
function syncEveryone(roster) {
  if (!Array.isArray(roster)) {
    return [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not check which agents are running' }];
  }
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster) });
  }
  return told;
}

/** Every agent reporting to `managerSession`, e.g. after that manager is renamed. */
function syncReportsTo(managerSession, roster) {
  if (!Array.isArray(roster)) return [];
  const key = String(managerSession || '');
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    let p = null;
    try { p = store.readProfile(a.sessionName); } catch { p = null; }
    if (!p || p.reportsTo !== key) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster) });
  }
  return told;
}

module.exports = { START, END, blockBody, bodyFor, tellAgent, syncEveryone, syncReportsTo, personName, managerName };
