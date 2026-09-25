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
 * The folder itself (creating it, listing it on the agent page) is the agent page's
 * Files list (server.js /api/agent/:name/files and web/index.html paintAgentFiles).
 * This block tells the agent where the folder is, to create it if it is missing,
 * and that the person sees its files on its page.
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
 * The agent page's Files routes (server.js) read this function, so it is the one place the
 * folder is derived: change it here, never rebuild it elsewhere.
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
  /* #3759 (Josh, 2026-09-25 11:07): the folder follows what the conversation is ABOUT, not only
     where it happens. A file asked for in a direct conversation goes in the agent's Files; one that
     belongs to a project's work goes in that project, even when asked for here, and the agent says
     which project; and when it is unclear the agent asks first (the doctrine's "one short question,
     not a licence to guess"), saving it here and saying so only when nobody is there to answer. */
  return [
    '## Where to save files you make for the person',
    '',
    'When you make a file for the person in a direct conversation with them, or they',
    'ask you for one in a direct conversation, save it in your Files folder, unless it',
    'belongs to one of your projects (see the next paragraphs; if you are on no',
    'projects, it always goes here):',
    '',
    '`' + where + '`',
    '',
    /* The Files list on the agent page (April's half of #3614) ships in the same change as
       this sentence, so the promise and the page land together. */
    'Create the folder if it is not there yet. Keeping what you make in a direct',
    'conversation in one place means they always know where to find it: Kosmos lists',
    'what is in it on your page, where they can open it. Save files directly in it,',
    'not in subfolders: the page lists only what sits at the top of the folder.',
    '',
    'When the conversation is about one of your projects (the person names it, or the',
    'file is plainly part of that project\'s work), save it in that project\'s folder',
    'instead, the folder listed for it under "Your projects" in your instructions,',
    'even though they asked in a direct conversation. Then tell them in one line',
    'where you put it: which project, and the file\'s name.',
    '',
    'When you cannot tell whether the file belongs to a project, ask them in one short',
    'line. Only if they are not there to answer, save it in your Files folder and say',
    'so, so they can ask you to move it.',
    '',
    'Inside a project, keep using the project\'s own folder.',
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
