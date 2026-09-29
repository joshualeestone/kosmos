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
 * and that the person sees its files on its page; and (#3759) that a file for one of
 * its projects goes in that project instead, that it tells the person where each file
 * went, and that when it cannot tell, it saves here and asks which project. And (#3965) it
 * opens by saying a thing made for the person is a FILE, never a Claude artifact or a link
 * unless the person asks for one.
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
const TOP_START = projects.DMFILES_TOP_START;
const TOP_END = projects.DMFILES_TOP_END;

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
  return ownDir(sessionName, FOLDER);
}

/**
 * #4447: a named folder of the agent's OWN, beside the file its instructions are written into:
 * the one derivation filesDir uses, shared so the Inbox (engine/messages.js, where a long
 * message is spilled) can never name a different folder than Files does. Null when the agent
 * has no usable folder, or the path could not be stated safely.
 */
function ownDir(sessionName, folder) {
  let file = null;
  try { file = instructions.fileFor(sessionName); } catch { file = null; }
  if (typeof file !== 'string' || !file) return null;
  const dir = path.join(path.dirname(file), folder);
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
     which project; and when it is unclear it saves it here, says so and asks which project in the same
     line: no project is guessed (the doctrine's "one short question, not a licence to guess") and no
     file waits unsaved on an answer that may never come (a turn ends when it asks). */
  return [
    '## Where to save files you make for the person',
    '',
    /* #3965 (Josh, 2026-09-26 08:57): "Agents keep defaulting to trying to put the document as an
       artifact ... not keep trying to put stuff out as Claude artifacts". A Claude agent's own
       tools tell it to publish a finished piece as an artifact by default, so the rule here has to
       say, in so many words, that this default wins over that one. Every provider reads this block. */
    'Anything you make for the person to keep (a document, a report, a draft,',
    'anything longer than a reply) is a FILE on this computer, saved where the next',
    'paragraphs say, and named in your reply. Do not publish it as a Claude artifact,',
    'a shared document or any other link unless the person asks for that, in the',
    'conversation or in the instructions Kosmos keeps for you: they look for your',
    'work under Files in Kosmos, and a link lives somewhere else. If one of your',
    'tools offers to publish by default, this instruction wins over that default.',
    '',
    'When you make a file for the person in a direct conversation with them, or they',
    'ask you for one there, save it in your Files folder. Two things come first: if',
    'they tell you where to put it, put it there, and if it is an existing file you',
    'are changing, leave it where it is. A file that belongs to one of your projects',
    'goes in the project instead (see the next paragraphs); if you are on no',
    'projects, that never applies. Your Files folder is:',
    '',
    '`' + where + '`',
    '',
    /* #4420 (Josh, 2026-09-28 15:29): a Gemini agent saved a file for him in its own folder, the one ABOVE this
       one, then told him it was in the files panel. Neither is possible if the agent reads these two lines. */
    'Directly inside that folder: not in your own folder above it, and not in a',
    'subfolder. Only files there appear on your page; a file anywhere else is',
    'invisible to the person. Never tell them a file is under Files unless you',
    'saved it at that exact path.',
    '',
    /* "Kosmos lists what is in it on your page": the Files list on the agent page (April's
       half of #3614) shipped in the same change as that sentence, so promise and page agree. */
    'Tell them in one line where you saved it, in words that mean something to them:',
    'the file\'s name, and that it is under Files on your page in Kosmos (to them it',
    'is not "your Files folder"). This Files folder is only for files made for the',
    'person: your running summaries and other working',
    'files stay where your instructions put them. Create the folder if it is not',
    'there yet. Keeping what you make in a direct conversation in one place means',
    'they always know where to find it: Kosmos lists what is in it on your page,',
    'where they can open it. Save files directly in it, not in subfolders: the page',
    'lists only what sits at the top of the folder.',
    '',
    'When the conversation is about one of your projects (the person names it, or the',
    'file is unmistakably that project\'s work, not only the same kind of thing), save',
    'it in that project\'s folder instead. That folder is the one listed for it under',
    '"Your projects" in your instructions (a section you have only while you are on a',
    'project). This holds even when they asked for it, or you made it, in a direct',
    'conversation. Then tell them in one line where you put it: which project, the',
    'file\'s name, and the folder inside the project if it is not at the top (Kosmos',
    'lists a project\'s subfolders too, a few folders deep). If they name a project you are not',
    'on, do not guess another: save it in your Files folder, say you are not on that',
    'project, and say it can move there once you are added to it.',
    '',
    'When you cannot tell whether the file belongs to a project, or to which one, do',
    'not guess a project. Save it in your Files folder. In the same line where you',
    'tell them it is under Files on your page, ask which project it belongs to, so',
    'they can have you move it. That is not guessing: your Files folder is where it',
    'goes by default. Never wait with the file unsaved. If your instructions also say',
    'to ask one short question rather than guess, this is how that applies to a file',
    'made for the person in a direct conversation: save here and ask.',
    '',
    'When the conversation itself happens inside a project, not in a direct',
    'conversation, keep using that project\'s own folder, as you already do there.',
  ].join('\n');
}

/* #4420: the pointer, for EVERY agent (Splinter, 15:34: the fix is for all agents, not Gemini's). It
   sits above the doctrine's "Where the files you make go", which an existing agent holds as plain text Kosmos may not
   rewrite without consent, so this is the line that reaches them. One line; the rule itself stays in the block. PURE. */
function topLine(dir) {
  const where = projects.neutralise(String(dir == null ? '' : dir));
  return 'A file you make for the person goes directly in `' + where + '` (or in a project\u2019s folder when it is that '
    + 'project\u2019s work): it is the only folder they see on your page in Kosmos. Your own folder above it is for your '
    + 'working notes. The full rule is under "Where to save files you make for the person" in these instructions.';
}

/* Where the pointer goes. It exists to be read BEFORE the working rules' "Where the files you make go": an existing
   agent obeyed that section's old sentence, and its copy of the rules is text Kosmos may not rewrite (#122).
   - The working rules' heading is on a line of its own: the pointer goes right before that line, or, when that line
     sits inside a managed span (a consented refresh puts the rules between DOCTRINE markers), right before that
     span's start marker, never inside it (a block inside another block would make the refresh read as out of date
     forever, and the two would take turns deleting each other).
   - ⚠️ THAT IS AN EXCEPTION TO #1071, stated as one: when the rules are plain text, which is the person's (#122),
     this INSERTS a marked block in the middle of their file. It is insert-only: exactly `block + "\n\n"` goes in at
     the start of a line and no existing byte changes, so cutting out exactly that string gives the file back byte
     for byte (dmfiles.top-4420.test.js pins it). A future remover must cut exactly that, not projects.removeBlock,
     which also collapses the blank line before it. The person's own words above the rules stay first (#591).
   - No working rules in the file: appended like every other managed block, so the person's text is untouched. A
     pointer placed that way stays where it is if rules arrive later (replaced in place, never moved).
   - Review 2: a file saved with Windows line endings (CRLF, e.g. from Notepad) matches too, and the pointer is written
     with the file's own line ending, so the insert-only cut-out above holds for it byte for byte as well.
   Replaced where it already is; refused (text unchanged) on two pointers. PURE. */
const DOCTRINE_HEADING = '## How you work, whatever the job';
const HEADING_LINE = /(^|\n)## How you work, whatever the job[ \t]*\r?(?=\n|$)/;
function spliceTop(text, dir) {
  const original = String(text == null ? '' : text);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';   // the file's own line ending
  const block = TOP_START + eol + topLine(dir) + eol + TOP_END;
  const at = projects.findBlock(original, TOP_START, TOP_END);
  if (at && at.ambiguous) return original;
  if (at) return original.slice(0, at.start) + block + original.slice(at.end);
  const m = HEADING_LINE.exec(original);
  if (m) {
    let pos = m.index + m[1].length;   // the start of the heading's line
    const all = projects.ALL_MARKERS();
    for (let i = 0; i + 1 < all.length; i += 2) {
      if (all[i] === TOP_START) continue;
      const span = projects.findBlock(original, all[i], all[i + 1]);
      if (span && !span.ambiguous && span.start <= pos && pos < span.end) {
        const ls = original.lastIndexOf('\n', span.start - 1) + 1;   // the start of the marker's line
        pos = ls;
        break;
      }
    }
    return original.slice(0, pos) + block + eol + eol + original.slice(pos);
  }
  return projects.spliceBlock(original, topLine(dir), TOP_START, TOP_END);
}

/* #4420: both managed parts for one agent, the block and the pointer (spliceTop says where it goes). The ONE composition, used at birth
   (create.js) and by tellAgent. Null when the agent has no folder to name. */
function applyTo(text, sessionName) {
  const dir = filesDir(sessionName);
  if (!dir) return null;
  return spliceTop(projects.spliceBlock(text, blockBody(dir), START, END), dir);
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
    if (!vouched && !projects.heldExactly(sessionName, roster)) {
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
    const topFound = projects.findBlock(current.text || '', TOP_START, TOP_END);
    if (topFound && topFound.ambiguous) {
      return { state: projects.TOLD.COULD_NOT, because: `its instructions contain ${topFound.pairs} Kosmos files pointers, so we cannot tell which is ours and did not change anything` };
    }
    const next = applyTo(current.text || '', sessionName);   // #4420: the block, and the pointer
    if (next === null) return { state: projects.TOLD.COULD_NOT, because: 'it has no folder of its own on this computer to name' };
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

module.exports = { START, END, TOP_START, TOP_END, FOLDER, filesDir, ownDir, blockBody, bodyFor, topLine, spliceTop, applyTo, tellAgent, syncEveryone };
