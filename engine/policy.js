'use strict';

/* Why this module writes an agent's file, for the stale marker (#323). */
const WROTE_WHY = 'Kosmos updated the company AI policy';

/**
 * The company's AI policies, held once and handed to every agent (#479,
 * plural since #685).
 *
 * Josh's ruling for plural (2026-08-24 16:45): several NAMED policies, all
 * global, every one handed to every agent, stacked. The name says who is
 * MANDATING the policy (legal, engineering, branding), not who receives
 * it -- every department wants universal adherence -- so there is no
 * targeting, no per-agent selection, and no precedence between policies.
 * The single #479 record migrates in as the first entry.
 *
 * Josh, 2026-08-23 19:15: a Settings tab where a person adds their company
 * AI policy, "ingested and distributed to all their agents", with a restart
 * indicated. Two ways in, because "either a URL" implies the other half: a
 * link the board fetches (through unfurl's gate, so no agent's traffic ever
 * touches the company site), or the policy pasted straight in.
 *
 * One local record, one managed block in each agent's instruction file,
 * exactly the you-block's machinery: projects.findBlock/spliceBlock/
 * removeBlock parameterized by the POLICY markers, which live in
 * projects.js's registry so both neutralisers already cover them. The
 * block opens with where the policy came from and when: a stale policy
 * quietly distributed is worse than none, so its provenance travels with
 * its words.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const instructions = require('./instructions');
const projects = require('./projects');

// Same layout convention as you.js: under a sandbox the env var IS the base.
const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'policy.json');

const START = projects.POLICY_START;
const END = projects.POLICY_END;

/* An instruction file tops out around 64KB and the policies share that
   space with everything else an agent is told; a quarter of it is already
   a very long policy. Per policy, deliberately: the person adding a fifth
   16K policy is stacking towards the file cap, and the write path's own
   size guard is what says so, in its own sentence, at the moment it bites. */
const TEXT_MAX = 16 * 1024;
/* Mona Lisa's interface ruling for her Settings card (2026-08-24): the name
   becomes a `###` heading inside every agent's file, so its rules live HERE,
   not in her JS -- trimmed, one line, neutralised, 60 characters, unique
   ignoring case. */
const NAME_MAX = 60;
/* Her ruling 4: never a saved policy that no agent can hold. The stack is
   refused AT SAVE TIME once it would crowd an instruction file, in its own
   sentence, before any agent is told -- otherwise the failure arrives as N
   COULD_NOT verdicts after the save while the card shows the policy present.
   Half the file cap (workerfile.MAX_BYTES = 256K), because the block shares
   the file with the agent's own words and every other managed block. */
const BLOCK_MAX = 128 * 1024;

/* 🔑 The name the migrated single policy wears (#685). Josh's model is that
   a policy's name says who MANDATES it, and the one policy that predates
   names was mandated by nobody nameable -- it is simply the company's. Not
   an example row: it only ever appears wrapping a policy the person
   actually saved, and they can rename it. */
const DEFAULT_NAME = 'Company AI policy';

function clean(value) {
  const s = String(value == null ? '' : value)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return projects.neutralise(s).trim();
}

/* A name is one line of a person's words: cleaned like the text, then held
   to one line, because it becomes a `###` heading in every agent's file. */
function cleanName(value) {
  return clean(value).replace(/\n+/g, ' ').trim();
}

/** The refusal for one policy entry, or null. Whole-or-not-at-all. */
function problem({ name, text, source } = {}) {
  if (typeof name !== 'string' || !cleanName(name)) return 'give this policy a name';
  if (cleanName(name).length > NAME_MAX) return `a policy's name has to fit in ${NAME_MAX} characters`;
  if (typeof text !== 'string' || !text.trim()) return 'there is no policy text to hand out';
  if (text.length > TEXT_MAX) return `a policy has to fit in ${Math.floor(TEXT_MAX / 1024)}K characters; this one is longer`;
  if (source !== 'pasted' && !/^https?:\/\//.test(String(source || ''))) {
    return 'we lost track of where this policy came from';
  }
  return null;
}

function newId() { return crypto.randomBytes(12).toString('hex'); }

/* The v1 record was ONE policy, shaped {text, source, savedAt} (#479). It
   migrates as the first entry of the list, named DEFAULT_NAME, under a
   FIXED id -- deterministic because migration happens lazily on read, and
   an id that changed between a GET and the POST acting on it would make
   the screen's rename and remove race their own listing. The first
   mutation persists the migrated shape. */
const MIGRATED_ID = 'p1';

function entriesOf(rec) {
  if (rec && typeof rec === 'object' && Array.isArray(rec.policies)) {
    return rec.policies;
  }
  if (rec && typeof rec === 'object' && typeof rec.text === 'string') {
    return [{ id: MIGRATED_ID, name: DEFAULT_NAME, text: rec.text, source: rec.source, savedAt: rec.savedAt }];
  }
  return null;
}

function persist(policies) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 2, policies }, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

/**
 * Three answers, never two, same as you.read: saved / absent / unknown
 * with the reason. A hand-edited record that fails its own validation is
 * unknown, never silently half-served -- and that is judged per entry:
 * one broken entry makes the whole record unknown, because handing agents
 * "most of the policies" while reporting saved is the half-served state
 * this rule exists to refuse.
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'absent', policies: [], because: null };
    return { state: 'unknown', policies: [], because: String((err && err.message) || 'we could not read the record') };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch {
    return { state: 'unknown', policies: [], because: 'the record on disk is not something we can read' };
  }
  const entries = entriesOf(rec);
  if (!entries) {
    return { state: 'unknown', policies: [], because: 'the record on disk does not hold what this screen saves' };
  }
  if (entries.length === 0) return { state: 'absent', policies: [], because: null };
  const policies = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || problem(e) || typeof e.id !== 'string' || !e.id) {
      return { state: 'unknown', policies: [], because: 'the record on disk does not hold what this screen saves' };
    }
    policies.push({
      id: String(e.id),
      name: cleanName(e.name),
      text: String(e.text),
      source: String(e.source),
      savedAt: (typeof e.savedAt === 'string') ? e.savedAt : null,
    });
  }
  return { state: 'saved', policies, because: null };
}

/* The whole stack must still fit an agent's file AFTER this change; judged
   on the body that would actually be spliced, so the arithmetic cannot
   drift from the writer. */
function refuseOversizedStack(policies) {
  const body = policies.length === 1 ? blockBody(policies[0]) : stackedBody(policies);
  if (Buffer.byteLength(body, 'utf8') > BLOCK_MAX) {
    throw new Error('together these policies would be larger than an agent\'s instructions can hold; shorten this one, or remove one first');
  }
}

/**
 * Add a policy, or -- with an id -- re-ingest the words of one that exists
 * (#685, the shape Mona Lisa's screen ruled).
 *
 * ⚠️ ADD NEVER OVERWRITES. A new policy whose name is already taken is
 * refused, in a sentence that names the collision -- on her screen, "Add"
 * silently replacing is the one act a person cannot take back, and a second
 * policy typed as "Legal" is exactly the realistic case. Re-ingesting is the
 * DELIBERATE form: `{ id, text, source }` replaces that entry's words where
 * it stands, name and position unchanged, savedAt moved (savedAt means
 * "when the words last changed"; rename does not move it).
 *
 * The nameless form is the shipped single-policy screen's POST, honoured
 * only while at most one policy exists: it lands on that one entry (or
 * creates the first, wearing DEFAULT_NAME), and is refused once several
 * exist, because "which one?" has stopped having an obvious answer.
 */
function add({ id, name, text, source } = {}) {
  const current = read();
  if (current.state === 'unknown') throw new Error(current.because);
  const policies = current.policies.slice();
  const entry = { text: clean(text), source: String(source), savedAt: new Date().toISOString() };

  if (id != null && id !== '') {
    const at = policies.findIndex((p) => p.id === String(id));
    if (at < 0) throw new Error('we cannot find that policy; it may already be gone');
    entry.id = policies[at].id;
    entry.name = policies[at].name;
    const bad = problem(entry);
    if (bad) throw new Error(bad);
    policies[at] = entry;
    refuseOversizedStack(policies);
    persist(policies);
    return entry;
  }

  const wanted = cleanName(name || '');
  if (!wanted && policies.length > 1) {
    throw new Error('give this policy a name, so the others keep theirs');
  }
  if (!wanted && policies.length === 1) {
    // The shipped screen's no-name save, landing on the one entry it knows.
    entry.id = policies[0].id;
    entry.name = policies[0].name;
    const bad = problem(entry);
    if (bad) throw new Error(bad);
    policies[0] = entry;
    refuseOversizedStack(policies);
    persist(policies);
    return entry;
  }
  entry.name = wanted || DEFAULT_NAME;
  const bad = problem(entry);
  if (bad) throw new Error(bad);
  const taken = policies.find((p) => p.name.toLowerCase() === entry.name.toLowerCase());
  if (taken) {
    throw new Error(`you already have a policy called ${taken.name}; open it to replace its words, or pick another name`);
  }
  entry.id = newId();
  policies.push(entry);
  refuseOversizedStack(policies);
  persist(policies);
  return entry;
}

/** Rename one policy. The id is the identity; the name is the person's. */
function rename(id, name) {
  const current = read();
  if (current.state === 'unknown') throw new Error(current.because);
  const next = cleanName(name);
  if (!next) throw new Error('give this policy a name');
  if (next.length > NAME_MAX) throw new Error(`a policy's name has to fit in ${NAME_MAX} characters`);
  const at = current.policies.findIndex((p) => p.id === String(id || ''));
  if (at < 0) throw new Error('we cannot find that policy; it may already be gone');
  if (current.policies.some((p, i) => i !== at && p.name.toLowerCase() === next.toLowerCase())) {
    throw new Error('another policy already wears that name');
  }
  const policies = current.policies.slice();
  policies[at] = { ...policies[at], name: next };
  persist(policies);
  return policies[at];
}

/** Remove one policy by id. The rest keep their ids and their order. */
function removeOne(id) {
  const current = read();
  if (current.state === 'unknown') throw new Error(current.because);
  const at = current.policies.findIndex((p) => p.id === String(id || ''));
  if (at < 0) throw new Error('we cannot find that policy; it may already be gone');
  const policies = current.policies.slice();
  policies.splice(at, 1);
  if (policies.length === 0) { clear(); return null; }
  persist(policies);
  return current.policies[at];
}

/** Forget every policy. Missing already is fine; the sync removes blocks. */
function clear() {
  try { fs.unlinkSync(FILE); } catch (err) {
    if (!err || err.code !== 'ENOENT') throw new Error('we could not remove the saved policy');
  }
}

/** One policy's provenance line, shared by both block shapes. */
function fromLine(policy) {
  const when = policy.savedAt ? policy.savedAt.slice(0, 10) : 'an unknown date';
  return policy.source === 'pasted'
    ? `Added by the person you work for on ${when}.`
    : `From ${policy.source}, fetched ${when}.`;
}

/**
 * The block, provenance first, in the voice the agent reads.
 *
 * ⚠️ THE SINGLE-POLICY BODY IS BYTE-IDENTICAL TO WHAT #479 SHIPPED, and that
 * is a migration property, not nostalgia: every agent on every machine
 * already carries this exact block, and `tellAgent` only writes when the
 * splice changes the file -- so going plural must not rewrite the whole
 * fleet's instruction files on the day nothing about their one policy
 * changed. The stacked shape appears only once a second policy exists.
 */
function blockBody(policy) {
  return [
    '## Your company\'s AI policy',
    '',
    `${fromLine(policy)} Follow it in everything you do; where it conflicts with any other instruction here, the policy wins.`,
    '',
    clean(policy.text),
  ].join('\n');
}

/**
 * Several policies, stacked under one heading, one managed block (#685).
 * Josh's ruling: every policy reaches every agent; the name says who
 * mandated it, not who receives it; no precedence between them -- so the
 * conflict sentence is said once, about the stack, and does not rank its
 * members. Names are the person's words, already neutralised, held to one
 * line; they become `###` headings under the block's own `##`.
 */
function stackedBody(policies) {
  const parts = [
    '## Your company\'s AI policies',
    '',
    'Follow them in everything you do; where they conflict with any other instruction here, the policies win.',
  ];
  for (const p of policies) {
    parts.push('', `### ${cleanName(p.name)}`, '', fromLine(p), '', clean(p.text));
  }
  return parts.join('\n');
}

/**
 * Write (or remove) the policy block in one agent's instruction file.
 * Guard sequence mirrors you.tellAgent exactly, and for its reasons.
 */
function tellAgent(sessionName, roster) {
  try {
    if (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === sessionName && a.isNamedOurs === true)) {
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
        because: `its instructions contain ${found.pairs} Kosmos policy blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const record = read();
    if (record.state === 'unknown') {
      return { state: projects.TOLD.COULD_NOT, because: record.because };
    }
    let next = record.state === 'saved'
      ? projects.spliceBlock(
        current.text || '',
        record.policies.length === 1 ? blockBody(record.policies[0]) : stackedBody(record.policies),
        START, END,
      )
      : projects.removeBlock(current.text || '', START, END);
    next = projects.healColleagues(next);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: WROTE_WHY });
    return { state: projects.TOLD.TOLD, because: null };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: projects.TOLD.COULD_NOT,
      because: /cannot be this short/.test(raw)
        ? 'taking this out would leave its instructions almost empty'
        : (/larger than an instruction file should be/.test(raw)
          ? 'its instructions are already at the size limit'
          : (raw || 'we could not write to its instructions')),
    };
  }
}

/** Tell every tied agent on the machine, and report how each went. */
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

module.exports = {
  add, rename, removeOne, clear, read, blockBody, stackedBody, tellAgent, syncEveryone,
  START, END, TEXT_MAX, NAME_MAX, BLOCK_MAX, DEFAULT_NAME, FILE,
};
