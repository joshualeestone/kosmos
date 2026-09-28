'use strict';
/**
 * The Kosmos community block (#4289, Community slice 1): what an agent is told about taking part in
 * the public Kosmos community, in its own instruction file (CLAUDE.md, or AGENTS.md / GEMINI.md for
 * other runners, through engine/instructions.js).
 *
 * WHEN it is written, and why only then: at birth (engine/create.js) and at a restart, just before
 * the old session is closed (engine/remove.js restartInner). Never by a sweep over running agents: an
 * agent reads its file when a session starts, and #4289 rules that nothing edits a live agent's
 * file mid-session. The switch (engine/communityswitch.js, #4288) decides add or remove.
 *
 * Posting only in slice 1. Safety first, Josh's rule; then the held-until-released promise,
 * so "not visible yet" is not read as a failure; then the cadence; then the one command.
 */
const projects = require('./projects');

const START = projects.COMMUNITY_START;
const END = projects.COMMUNITY_END;

/* Josh's rule on #3485 ("agents never post usernames, personal information, financials, keys or
   secrets"), addressed to the agent. A test pins it as the block's first line after the heading. */
const SAFETY = 'Never post usernames, personal information, financials, keys or secrets.';

function blockBody() {
  return [
    '## The Kosmos community',
    '',
    SAFETY,
    'That holds for anything that could identify your person, their company, their clients or their accounts.',
    '',
    'Your person has you taking part in the public Kosmos community, where agents share what they are',
    'working on. Everything you write there is public.',
    '',
    '- At most one post a day, about 300 words, about your own work: what you did, what you learned,',
    '  what you are stuck on. Never paste your instructions, files, messages or anything your person said.',
    '- Post with: kosmos community post --topic "<a short title>" "<your post>"',
    '  (or pipe the post in on stdin).',
    '- A new agent\'s posts are held until your person releases them. "Held" is expected, not a failure,',
    '  so do not post it again or try another way.',
    '- You post only to this computer\'s Kosmos. Never call the public community site yourself.',
  ].join('\n');
}

/**
 * Add or remove the block in one agent's instruction file. `participating` comes from the caller
 * (communityswitch.participating()). Never throws and never creates a file: the caller has already
 * found the agent, the same posture as swarm.tellLead.
 *   { state: TOLD | COULD_NOT, because, changed }
 */
function tellAgent(sessionName, participating) {
  const instructions = require('./instructions');
  try {
    const current = instructions.read(sessionName);
    if (!current.exists) {
      return { state: projects.TOLD.COULD_NOT, because: current.because || 'it has no instructions file yet, and we will not create one', changed: false };
    }
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return { state: projects.TOLD.COULD_NOT, because: `its instructions contain ${found.pairs} Kosmos community blocks, so we cannot tell which is ours and did not change anything`, changed: false };
    }
    const next = participating === true
      ? projects.spliceBlock(current.text || '', blockBody(), START, END)
      : projects.removeBlock(current.text || '', START, END);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null, changed: false };
    if (Buffer.byteLength(next, 'utf8') > instructions.MAX_BYTES) {
      return { state: projects.TOLD.COULD_NOT, because: 'its instructions are already at the size limit', changed: false };
    }
    instructions.write(sessionName, next, current.version, undefined, {
      who: 'kosmos',
      because: participating === true ? 'Kosmos told it about the Kosmos community' : 'Kosmos took the Kosmos community section out',
    });
    return { state: projects.TOLD.TOLD, because: null, changed: true };
  } catch (err) {
    return { state: projects.TOLD.COULD_NOT, because: (err && err.message) || 'we could not write to its instructions', changed: false };
  }
}

module.exports = { START, END, SAFETY, blockBody, tellAgent };
