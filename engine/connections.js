'use strict';

/**
 * What an agent needs to know to help somebody connect a provider (#1034).
 *
 * Josh, 2026-08-26 17:10: *"What I'm wanting is an agent to help me get some of
 * these things connected but they can't even see it to help with it."*
 *
 * 🔑 THIS BLOCK IS KNOWLEDGE, NOT ACCESS, and that is the whole design. The
 * card bundles three things with very different costs: knowing how connecting
 * works, seeing this machine's actual connection state, and acting on it. Only
 * the first is here. It has no security surface, it needs no consent, and the
 * card's own reading is that it delivers most of the value.
 *
 * ⭐ THE MODEL IS A PHONE CALL. A person helping another person connect
 * something cannot see their screen either, and manages perfectly well by
 * asking what they are looking at. An agent that knows the flow can do the
 * same. So this block ends by telling the agent it CANNOT see the screen and
 * must ask rather than assume, which is the difference between useful help and
 * confident nonsense about a button that is not there.
 *
 * ⚠️ EVERY AGENT GETS THE SAME WORDS. Unlike the reports-to block, nothing here
 * is per-agent: it is how the product works, not who this agent is. `blockBody`
 * therefore takes no argument, and a future caller must not be tempted to pass
 * one in and start describing THIS machine's state, which is the part that
 * needs a person's consent.
 *
 * 🛑 CORRECTED (#1034 part 2): THE BLOCK NOW POINTS AT MACHINE STATE, though it
 * still contains none. It tells every agent to run `kosmos connections`, which
 * reports which providers are connected on this computer. The consent question
 * was decided (verdict only: no sign-in URL, no terminal output, no emails, no
 * key tails). So the paragraph above remains true of these WORDS and is no
 * longer true of where they lead, and this header is the first thing the next
 * editor reads.
 * ⚠️ An earlier version of this correction was spliced into the MIDDLE of the
 * sentence above, leaving it reading "must not be tempted to pass / one in"
 * across a paragraph break. Editing half a comment is its own defect.
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
    '🔑 **You cannot see their screen. Ask.** You do not know what the screen',
    'currently says or which button they are looking at.',
    'Do not guess and do not describe a button as though you',
    'can see it. Ask what they are looking at, ask what it says, and work from',
    'their answer. Being the one who asks a clear question is more useful than',
    'being the one who confidently describes the wrong screen.',
    '',
    'One thing you CAN check for yourself, rather than asking: run',
    '`kosmos connections`. It tells you which providers are connected on this',
    'computer, whether the program each needs is installed, and whether a sign-in',
    'is going on right now. It answers in three states, and **could not check** is',
    'one of them: treat that as unknown, never as "not connected".',
    '',
    'It deliberately does NOT show you the sign-in link or the terminal output.',
    'Those are the parts that would let somebody sign in as them, so they are not',
    'yours to hold. If you need to know what a screen says, that is still a',
    'question for the person.',
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
