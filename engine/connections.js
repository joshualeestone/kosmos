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
    'the closing paragraphs matter as much as the rest.',
    '',
    '**What a provider is here.** Kosmos runs each agent using a terminal agent',
    'from a provider. Anthropic agents run on Claude Code. OpenAI agents run on',
    'Codex, and OpenAI\'s model is GPT, the word the screen uses, so if someone',
    'asks to connect GPT they mean OpenAI. Google Gemini and xAI Grok can be',
    'connected too: Gemini with an API key or a Google subscription, Grok with',
    'an API key or an xAI subscription. Those four can be connected today.',
    'Gemini on a Google subscription runs on Google\'s Antigravity, on a Mac and',
    'on Windows (where the person pastes the code Google\'s page shows into Kosmos). Kosmos',
    'installs it from Google when the person presses Install Antigravity after',
    'Sign in with Google, for Gemini in Settings, AI Models, Add a provider (on',
    'the Gemini row of the guided setup the button reads Sign in with',
    'Subscription): the person signs in with Google in the browser and pastes',
    'Google\'s code into Kosmos. On the screen it is "Google Gemini (Google',
    'subscription)". Once signed in, `GET /api/accounts` lists it as a row with',
    '`authMode` `antigravity` (no key; from Kosmos\'s last check, not a live one).',
    'Meta Llama, Alibaba Qwen, Moonshot Kimi and Mistral appear in the menu',
    'marked coming soon and cannot be chosen yet, so if they ask for one of',
    'those, the honest answer is that it is listed but not available.',
    '',
    '**What connecting actually does.** Kosmos installs the provider\'s terminal',
    'agent onto this computer if it is not already there, then the person signs',
    'in or provides a key. The install is a real download and Claude Code is the',
    'big one, a couple of hundred megabytes. Everything after it is quick.',
    'Gemini\'s and Grok\'s are smaller downloads, and Kosmos installs them the',
    'same way, on a Mac and on Windows.',
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
    'string the person creates on the provider\'s website and pastes in. OpenAI,',
    'Grok and Gemini each take a subscription sign-in or a key, all in Settings,',
    'AI Models, Add a provider (and each on its row of the guided setup).',
    'Each person uses their own account or their own',
    'key, and the usage is billed to them.',
    '',
    '🔑 **Two different things here, and the rule flips between them.** This',
    'block carries no live state, but which providers are set up here is not a',
    'mystery you have to ask about: **the board records it and reports it at',
    '`GET /api/accounts`** - every provider\'s accounts and, per account, a',
    'live-checked connection status. So **look, do not ask**: read that rather',
    'than telling the person you cannot see which providers are set up.',
    '',
    'Reading it right is not a one-liner, so lean on the `kosmos` CLI as the',
    'reference rather than hardcoding anything. The board\'s port is derived',
    'PER-ACCOUNT - do not assume 16180; hitting the wrong port can land you on a',
    'different account\'s board. And on a board that enforces auth the read needs',
    'the board token, sent off the command line, never in argv (argv leaks it',
    'cross-account). The CLI resolves the address and sends the token safely;',
    'there is no one-word verb that prints accounts, so it is a direct read of',
    'the route. An unauthenticated read is refused, which is a gate to pass, not',
    'a sign you are blind.',
    '',
    '**What you genuinely cannot see is their live screen** - what it says right',
    'now, which button is in front of them, whether a download has run yet. For',
    'that, ask. Do not guess and do not describe a button as though you can see',
    'it. Ask what they are looking at, ask what it says, and work from their',
    'answer. Being the one who asks a clear question about the screen is more',
    'useful than confidently describing the wrong one.',
    '',
    /* #5309 (a day-one report): a plugin installed and enabled in the person's own Claude Code or Codex never
       reached their agents, through restarts, and nothing could tell them why. Kosmos sets up no plugins; an
       agent reads its OWN provider home, which is the person's only for the default account (CLAUDE_CONFIG_DIR
       unset), and a separate folder for every other account. Measured: each config folder keeps its own
       plugins/installed_plugins.json. Knowledge only: where to look, never what is there. */
    '## A plugin the person installed in their own app',
    '',
    'Kosmos does not install provider plugins (a CRM, a calendar and so on).',
    'A person installs those in their own Claude Code or Codex app, and the app',
    'keeps them in its own folder. **You see a plugin only if it is in YOUR',
    'folder**, and yours is not always the same as the person\'s:',
    '',
    '- **Claude Code:** your folder is the one in `CLAUDE_CONFIG_DIR`, or',
    '  `~/.claude` when that is not set. Installed plugins are listed in',
    '  `plugins/installed_plugins.json` inside it. An agent on a second Claude',
    '  account has its own folder, so it does not get plugins installed in',
    '  `~/.claude`. Connectors added on the claude.ai website reach only an agent',
    '  signed in with a Claude account, never one running on an API key.',
    '- **Codex:** your folder is the one in `CODEX_HOME`, or `~/.codex` when that',
    '  is not set. Installed plugins sit under `plugins` inside it.',
    '',
    '**When the person says a plugin is connected and you cannot use it,**',
    'check your folder before anything else. If it is in their folder and not',
    'in yours, say so plainly: it is connected in their own app, and this agent',
    'runs from another folder, so it cannot see it. Restarting does not change',
    'that, so do not suggest it. If it IS in your folder and still fails, that',
    'is a different problem, for example a sign-in the plugin still needs, and',
    'say which of the two it is.',
    '',
    /* #4451 (Josh, 2026-09-28 19:57): agents did not know the Connections tab at all. */
    '## The Connections tab: the services you can work with',
    '',
    'Separate from AI Models, Settings has a **Connections** tab. It lists the',
    'outside services an agent can work with: GitHub, Vercel, Cloudflare, web',
    'search (Brave Search, Exa, Tavily, Serper), and services for hosting,',
    'databases, email, notes and tickets. A row says connected when Kosmos holds',
    'a working sign-in or token for that service.',
    '',
    '**To see what is connected, run `kosmos connections`.** It answers from',
    'what Kosmos has stored, without asking each service. 🛑 **Never read',
    '`GET /api/connections` yourself, and never in a loop:** it checks every',
    'service live, and the search services bill the person for every check.',
    '',
    '**When you connect a service for the person, connect it through Kosmos, so',
    'its row shows it.** For a service that takes a token, the person creates the',
    'token on that service\'s website and gives it to you; store it with',
    '`kosmos connect <service>`, giving the token on stdin and never as an',
    'argument, for example `printf \'%s\' "$TOKEN" | kosmos connect brave-search`.',
    '`kosmos connections` shows the word for each service. Kosmos checks the',
    'token with the service once and keeps it only if it works. GitHub and Vercel',
    'are signed in to by the person, in the Connections tab itself: point them',
    'there rather than asking for a password.',
    '',
    '**A service Kosmos has no door for** (it is not in `kosmos connections`):',
    'you may set it up your own way, for example a key in your own folder, but its',
    'row cannot show it. Say so plainly: it is connected for you, and it will not',
    'appear in the Connections tab.',
    '',
    '**If the person asks what connections you need,** name the services your',
    'work needs, check which are connected with `kosmos connections`, and offer to',
    'connect the missing ones for them.',
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

module.exports = { START, END, blockBody, tellAgent, syncEveryone };
