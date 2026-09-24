'use strict';

/**
 * Where an agent saves the files it makes for the person in a direct
 * conversation (#3614, item 3).
 *
 * Josh, 2026-09-24 12:42: "When I'm talking to an agent, a lot of times the
 * agent will directly make a file but it's not inside of a project ... instruct
 * the agent that when they make files for the user, they save them into that
 * directory (whatever that is) so that they're easy to see and access."
 *
 * 🔑 THE PATH IS WRITTEN IN, NEVER LEFT TO GUESS. The card says so, and it is the
 * point: an agent told "your Files folder" with no path invents one, and the page
 * that lists the folder then shows nothing. So this block is PER-AGENT, like the
 * reports-to block and unlike the connections block: it names the agent's real
 * resolved folder, the folder BESIDE the instructions file this block is written
 * into (`instructions.fileFor(name)`, which keys the name through store.safeKey and
 * follows a recorded folder for an agent brought in from elsewhere), plus `Files`.
 * `filesDir(name)` is the one derivation; nothing else should rebuild it.
 *
 * The folder itself (creating it, listing it on the agent page) is April's half
 * of #3614. This block only tells the agent where it is and to create it if it is
 * missing, so the instruction works before and after that half lands.
 *
 * Same guards as reports.js / connections.js, deliberately: an ambiguous file is
 * refused rather than spliced into, an unreadable one is reported, nothing is ever
 * created, and it never throws.
 */

const path = require('node:path');
const projects = require('./projects');
const instructions = require('./instructions');

const START = projects.DMFILES_START;
const END = projects.DMFILES_END;

/* The folder's name inside the agent's own folder (#3614's call, written on the card). */
const FOLDER = 'Files';

/* Why this module writes an agent's file, for the stale marker (#323). */
const WROTE_WHY = 'Kosmos told it where to save the files it makes for you';

/**
 * The agent's Files folder, or null when the agent has no usable folder.
 *
 * 🔑 BESIDE THE FILE THIS BLOCK IS WRITTEN INTO, by construction: the folder of
 * `instructions.fileFor(name)`, which keys the name through `store.safeKey` and follows
 * a recorded folder through `create.workerDir`. Deriving it from the raw name instead
 * named a different folder for any name safeKey changes (`orch.main`, `has space`,
 * `Writer` on a case-sensitive disk), so the agent was told a folder next to its own.
 *
 * April's agent-page list (#3614 items 1, 2, 4, not shipped yet) will read this function and
 * FOLDER, so both keep their names and signatures: tell her before changing either.
 */
function filesDir(sessionName) {
  let file = null;
  try { file = instructions.fileFor(sessionName); } catch { file = null; }
  if (typeof file !== 'string' || !file) return null;
  const dir = path.join(path.dirname(file), FOLDER);
  /* A path the block cannot state safely is no path: NUL (create.workerDir's sentinel for
     an unusable name), or a line break or backtick that would break out of the code span
     and write lines of its own into the agent's instructions (a recorded folder is only
     checked for being an absolute, real, non-link directory). */
  return /[\u0000\r\n`]/.test(dir) ? null : dir;
}

/**
 * The block, for one folder. The path is neutralised like every other value that
 * reaches a managed block, so a folder name can never close the block early.
 */
function blockBody(dir) {
  const where = projects.neutralise(String(dir == null ? '' : dir));
  return [
    '## Where to save files you make for the person',
    '',
    'When you make a file for the person in a direct conversation with them, not',
    'inside a project, save it in your Files folder:',
    '',
    '`' + where + '`',
    '',
    /* The Files list on the agent page (April's half of #3614) ships in the same change as
       this sentence, so the promise and the page land together. */
    'Create the folder if it is not there yet. Keeping everything you make for the',
    'person in one place means they always know where to find it: Kosmos lists what',
    'is in it on your page, where they can open it. Inside a project, keep using the',
    'project\'s own folder.',
  ].join('\n');
}

/** The body for an agent, or null when it has no folder to name. */
function bodyFor(sessionName) {
  const dir = filesDir(sessionName);
  return dir ? blockBody(dir) : null;
}

/**
 * Put the block in one agent's instructions. The same guard sequence as
 * reports.tellAgent: the roster gate unless the caller vouches, the reader's own
 * editable verdict, never inventing an instructions file, refusing two
 * well-formed blocks, and never throwing.
 */
function tellAgent(sessionName, roster, opts) {
  try {
    const vouched = !!(opts && opts.trusted);
    if (!vouched && (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === sessionName && a.isNamedOurs === true))) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const body = bodyFor(sessionName);
    if (!body) return { state: projects.TOLD.COULD_NOT, because: 'it has no folder of its own on this computer to name' };
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
        because: `its instructions contain ${found.pairs} Kosmos files blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const next = projects.spliceBlock(current.text || '', body, START, END);
    /* Unchanged is TOLD, not a failure: the block already says this. */
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: WROTE_WHY });
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

/** Every agent the board can name as ours. */
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

module.exports = { START, END, FOLDER, filesDir, blockBody, bodyFor, tellAgent, syncEveryone };
