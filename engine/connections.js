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
 * one in and start describing THIS machine's state, which is the part that
 * needs a person's consent.
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
const WROTE_WHY = 'Kosmos told it how connecting a provider works';

/**
 * The block. Constant by design: see the note above about why this takes no
 * argument and must not grow one.
 */
function blockBody() {
  return [
    '## How connecting a provider works',
    '',
    'The person you work for may ask you to help them connect a provider. You',
    'can, and this is what you need to know. **You cannot see their screen**, so',
    'the last paragraph matters as much as the rest.',
    '',
    '**What a provider is here.** Kosmos runs each agent using a terminal agent',
    'from a provider. Anthropic agents run on Claude Code. OpenAI agents run on',
    'Codex, and OpenAI\'s model is GPT, the word the screen uses, so if someone',
    'asks to connect GPT they mean OpenAI. Those two can be connected today.',
    'Google Gemini, Meta Llama, xAI',
    'Grok, Alibaba Qwen, Moonshot Kimi and Mistral appear in the menu marked',
    'coming soon and cannot be chosen yet, so if they ask for one of those, the',
    'honest answer is that it is listed but not available.',
    '',
    '**What connecting actually does.** Kosmos installs the provider\'s terminal',
    'agent onto this computer if it is not already there, then the person signs',
    'in or provides a key. The install is a real download and Claude Code is the',
    'big one, a couple of hundred megabytes. Everything after it is quick.',
    '',
    '**Why it asks before downloading.** There is a confirm step before the',
    'download starts. It exists because a large download beginning with no',
    'warning is alarming, and the person asked for it specifically. If they are',
    'looking at a confirm box, nothing has been downloaded yet and pressing it',
    'is safe. If they would rather not, nothing happens.',
    '',
    '**Signing in versus a key.** These are different and people mix them up.',
    'Signing in to a Claude account happens through Anthropic\'s own sign-in',
    'flow, in a browser, and Kosmos never sees the password. A key is a long',
    'string the person creates on the provider\'s website and pastes in. OpenAI',
    'is connected with a key. Each person uses their own account or their own',
    'key, and the usage is billed to them.',
    '',
    '🔑 **Two different things here, and the rule flips between them.** This',
    'block carries no live state, but which providers are set up here is not a',
    'mystery you have to ask about: **`GET /api/accounts` returns every',
    'provider\'s accounts and, per account, a live-checked connection status.**',
    'So for what is already set up, **look, do not ask** - read that and answer',
    'from it rather than sending the person to read a screen you could have read',
    'yourself. (On a board that enforces auth (kosmos#1946) that read needs the',
    'board token. Do not hand-roll it: the `kosmos` CLI is the reference for',
    'sending it safely, off the command line. An unauthenticated read is refused',
    '- that is a gate to pass, not a sign you cannot see.)',
    '',
    '**What you genuinely cannot see is their live screen** - what it says right',
    'now, which button is in front of them, whether a download has run yet. For',
    'that, ask. Do not guess and do not describe a button as though you can see',
    'it. Ask what they are looking at, ask what it says, and work from their',
    'answer. Being the one who asks a clear question about the screen is more',
    'useful than confidently describing the wrong one.',
  ].join('\n');
}

/**
 * Put the block in one agent's instructions. Same shape and same guards as
 * `reports.tellAgent`, deliberately: an ambiguous file is refused rather than
 * spliced into, an unreadable one is reported, and nothing is ever created.
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

module.exports = { START, END, blockBody, tellAgent, syncEveryone };
