'use strict';

/**
 * What an agent needs to know to help somebody connect a provider (#1034).
 *
 * Josh, 2026-08-26 17:10: *"What I'm wanting is an agent to help me get some of
 * these things connected but they can't even see it to help with it."*
 *
 * 🔑 THIS BLOCK IS KNOWLEDGE, NOT STATE. The card bundles three things with
 * very different costs: knowing how connecting works, seeing this machine's
 * actual connection state, and acting on it. This block carries the first and
 * POINTS AT where the second is readable (GET /api/accounts); it never bakes
 * the state itself in, which is the line engine/connections.test.js enforces.
 * Telling an agent WHERE to look is knowledge; embedding what it found would be
 * state, and state in a static block goes stale the moment anything changes.
 * (An earlier version of this note said the block carried ONLY "how it works"
 * and had "no security surface, no consent" -- that produced the false clause
 * #1034 removed, the one telling agents they could see NONE of the setup. They
 * can: it is on the machine and readable, so pointing there is the fix.)
 *
 * (kosmos#7875 item 2: the notes below describe the guide, guideText; the block in each agent's file now points at it.)
 *
 * ⭐ THE MODEL IS A PHONE CALL, BUT ONLY FOR THE SCREEN. A person helping
 * another connect something cannot see their live screen, and manages by asking
 * what they are looking at; an agent does the same for the screen. What it does
 * NOT have to ask about is which providers are set up -- that is recorded on the
 * machine and readable. So this block ends by splitting the two: ask about the
 * live screen, look for the connection setup, rather than the old false absolute
 * that said an agent could see none of it and confidently describe a button that
 * is not there.
 *
 * ⚠️ EVERY AGENT GETS THE SAME WORDS. Unlike the reports-to block, nothing here
 * is per-agent: it is how the product works, not who this agent is. `blockBody`
 * therefore takes no argument, and a future caller must not be tempted to pass
 * one in and start baking THIS machine's state INTO the block. That is the part
 * that would need consent, and it is distinct from the RUNTIME read the body
 * points at: reading /api/accounts at request time is gated by the #1946 board
 * token, so consent is enforced by the token rather than by asking, and the
 * answer is never frozen into these static words.
 *
 * ⚠️ ONLY WHAT WAS READ OFF THE PRODUCT. Nothing below is remembered from
 * training or inferred from how such flows usually look. A wrong step in an
 * agent's instructions is worse than no step, because the agent will say it
 * with confidence to somebody who cannot check it.
 */

const projects = require('./projects');
const instructions = require('./instructions');

const START = projects.CONNECTIONS_START;
const END = projects.CONNECTIONS_END;

/* Why this module writes an agent's file, for the stale marker (#323). */
const WROTE_WHY = 'Kosmos told it where to read how connecting a provider works';

/* kosmos#7875 item 2: the block's words and the guide live in engine/connectionsguide.js (requires nothing). */
const { blockBody, guideText } = require('./connectionsguide');

/**
 * Put the block in one agent's instructions. Same shape and same guards as
 * `reports.tellAgent`, deliberately: an ambiguous file is refused rather than
 * spliced into, an unreadable one is reported, and nothing is ever created.
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
        because: `its instructions contain ${found.pairs} Kosmos connections blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const next = projects.spliceBlock(current.text || '', blockBody(), START, END);
    /* Unchanged is TOLD, not a failure: the block already says this, which is
       the common case on every sync after the first. */
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null, changed: false };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: WROTE_WHY });
    return { state: projects.TOLD.TOLD, because: null, changed: true };   // kosmos#5304: the running agent is owed a re-read
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

module.exports = { START, END, blockBody, guideText, tellAgent, syncEveryone };
