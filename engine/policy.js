'use strict';

/* Why this module writes an agent's file, for the stale marker (#323). */
const WROTE_WHY = 'Kosmos updated the company AI policy';

/**
 * The company's AI policy, held once and handed to every agent (#479).
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
const store = require('./store');
const instructions = require('./instructions');
const projects = require('./projects');

// Same layout convention as you.js: under a sandbox the env var IS the base.
const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'policy.json');

const START = projects.POLICY_START;
const END = projects.POLICY_END;

/* An instruction file tops out around 64KB and the policy shares that
   space with everything else an agent is told; a quarter of it is already
   a very long policy. */
const TEXT_MAX = 16 * 1024;

function clean(value) {
  const s = String(value == null ? '' : value)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return projects.neutralise(s).trim();
}

/** The refusal, or null. Whole-or-not-at-all, same as you.js. */
function problem({ text, source } = {}) {
  if (typeof text !== 'string' || !text.trim()) return 'there is no policy text to hand out';
  if (text.length > TEXT_MAX) return `a policy has to fit in ${Math.floor(TEXT_MAX / 1024)}K characters; this one is longer`;
  if (source !== 'pasted' && !/^https?:\/\//.test(String(source || ''))) {
    return 'we lost track of where this policy came from';
  }
  return null;
}

/** Save the policy. Validated before the write; refusals throw. */
function save({ text, source } = {}) {
  const bad = problem({ text, source });
  if (bad) throw new Error(bad);
  const record = {
    text: clean(text),
    source: String(source),
    savedAt: new Date().toISOString(),
  };
  if (!record.text) throw new Error('there is no policy text to hand out');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  return record;
}

/** Forget the policy. Missing already is fine; the sync removes blocks. */
function clear() {
  try { fs.unlinkSync(FILE); } catch (err) {
    if (!err || err.code !== 'ENOENT') throw new Error('we could not remove the saved policy');
  }
}

/**
 * Three answers, never two, same as you.read: saved / absent / unknown
 * with the reason. A hand-edited record that fails its own validation is
 * unknown, never silently half-served.
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'absent', policy: null, because: null };
    return { state: 'unknown', policy: null, because: String((err && err.message) || 'we could not read the record') };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch {
    return { state: 'unknown', policy: null, because: 'the record on disk is not something we can read' };
  }
  if (!rec || typeof rec !== 'object' || problem(rec)) {
    return { state: 'unknown', policy: null, because: 'the record on disk does not hold what this screen saves' };
  }
  return {
    state: 'saved',
    policy: {
      text: String(rec.text),
      source: String(rec.source),
      savedAt: (typeof rec.savedAt === 'string') ? rec.savedAt : null,
    },
    because: null,
  };
}

/** The block, provenance first, in the voice the agent reads. */
function blockBody(policy) {
  const when = policy.savedAt ? policy.savedAt.slice(0, 10) : 'an unknown date';
  const from = policy.source === 'pasted'
    ? `Added by the person you work for on ${when}.`
    : `From ${policy.source}, fetched ${when}.`;
  return [
    '## Your company\'s AI policy',
    '',
    `${from} Follow it in everything you do; where it conflicts with any other instruction here, the policy wins.`,
    '',
    clean(policy.text),
  ].join('\n');
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
      ? projects.spliceBlock(current.text || '', blockBody(record.policy), START, END)
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

module.exports = { save, clear, read, blockBody, tellAgent, syncEveryone, START, END, TEXT_MAX, FILE };
