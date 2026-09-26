'use strict';

/**
 * #3723: is this agent stopped by its ACCOUNT, and what should the person be told?
 *
 * Josh, 2026-09-25, relaying a user who ran out of OpenAI credits and found out only from the
 * Advanced window: the person should be told where they look. This is the one reading of a board
 * card into "which account problem, in words", used by the agent's Direct Message line (the thread
 * route) and, next, by the note to the person's project manager. Pure: it reads a card, nothing else.
 *
 * Covered states (what the engine can see today):
 *   - rate_limited: out of usage or credits (Codex's messages, #3723), a Gemini API key's daily limit (#4004), or a
 *     Claude usage limit;
 *   - auth_failed: its sign-in stopped working.
 * The vendor's own sentence (the card's stateEvidence) is quoted when there is one, because it
 * carries the vendor's own remedy and link and stays true when their wording changes.
 */

const PROVIDER_NAME = Object.freeze({ codex: 'OpenAI', gemini: 'Gemini', grok: 'Grok', antigravity: 'Google' });   // #3568: the name the person picked is Google's

function providerOf(card) {
  return PROVIDER_NAME[card && card.runner] || 'Claude';
}

function nameOf(card) {
  return (card && (card.name || card.sessionName)) || 'This agent'; // a board card's `name` is its display name
}

// A vendor sentence, trimmed and capped, ready to quote; null when there is none.
function quoted(card) {
  // The vendor's sentence without the screen's own bullet (Codex prints "• " before it).
  const e = card && typeof card.stateEvidence === 'string' ? card.stateEvidence.trim().replace(/^[•●⏺■·\-*\s]+/, '') : '';
  if (!e) return null;
  return e.length > 240 ? e.slice(0, 240) + '…' : e;
}

/**
 * The account problem on this card, or null.
 * { kind: 'usage' | 'signin', provider, notify, text, summary }: `text` is for the person (it may
 * quote the vendor's sentence from the agent's screen); `summary` is Kosmos's own words only, for
 * another agent; `notify` says whether the reading is firm enough to interrupt a manager with it.
 */
function accountProblemOf(card) {
  if (!card || typeof card.state !== 'string') return null;
  const who = nameOf(card);
  const provider = providerOf(card);
  const said = quoted(card);
  /* #4004 (Josh, 2026-09-26): a Gemini API-key agent on Google's daily limit, read from Gemini's own words
     (status.js geminiQuotaReading), so it is firm. Said the way Josh asked: what happened, when it resets, and the
     two ways out. Google's daily limits reset at midnight Pacific time. */
  if (card.state === 'rate_limited' && card.runner === 'gemini' && card.limitFrom === 'gemini') {
    /* While only Gemini's question is up, the limit may be the free daily one or another (a billed key's cap, a model
       with no free quota), so it is said neutrally. Gemini's own "exhausted your
       daily quota" line, shown after that, is a daily limit (free or billed), and gets the reset and the two ways out. */
    if (card.quotaDialog === true) {
      /* Says what is on screen, not what Kosmos will do about it: the sweep that answers Stop can be switched off
         (AGENT_WORKFORCE_GEMINI_QUOTA_OFF, or live execution off), and then "Kosmos is answering" would be false. */
      const text = `${who} has reached a Google usage limit for its API key, so it has stopped at Gemini's question about`
        + ' it. To raise the limit, add billing to the key in Google AI Studio, or use Google Gemini (Google subscription).';
      return { kind: 'usage', provider: 'Gemini', notify: true, text, summary: text };
    }
    /* "Daily", not "free daily" (review round 6): Gemini prints the same line for any daily quota, billed keys too,
       so the screen cannot say which, and "add billing" is advice only for a key that has none yet. */
    /* Google's own quota message after Stop (a model with no free quota, say) is a limit, not the daily one: said
       neutrally, with no reset time (review round 8). */
    if (card.quotaDaily !== true) {
      const text = `${who} has reached a Google usage limit for its API key, so it has stopped. To raise the limit, add`
        + ' billing to the key in Google AI Studio, or use Google Gemini (Google subscription).';
      return { kind: 'usage', provider: 'Gemini', notify: true, text, summary: text };
    }
    const head = `Google's daily limit for ${who}'s API key is used up, so it has stopped.`;
    const todo = ' It resets at midnight Pacific time. To raise it, add billing to the key in Google AI Studio, or use'
      + ' Google Gemini (Google subscription) instead. It picks up again on the next message after that.';
    return { kind: 'usage', provider: 'Gemini', notify: true, text: head + todo, summary: head + todo };
  }
  if (card.state === 'rate_limited') {
    /* Which reader saw it. A Codex pane's usage limit comes only from Codex's own sentence, anchored
       at the start of a row (engine/status.js CODEX_LIMIT_MARKERS), so it is a firm reading. Every
       other pane (Claude, and Gemini and Grok, which are read the Claude way) goes through Claude's
       "reached your ... limit" marker, which also matches prose like "reached your context limit": a
       known false match kept on the card. So those are said as "looks like", "context" is dropped,
       and they are not typed into a manager (`notify: false`). */
    const firm = card.runner === 'codex';
    if (!firm && said && /\bcontext\b/i.test(said)) return null;
    const head = firm
      ? `${who} has run out of ${provider} usage or credits, so it has stopped.`
      : `It looks like ${who} has hit a ${provider} usage limit, so it has stopped.`;
    // Kosmos's own advice, picked by which kind of message it was (no screen text is used for this).
    const todo = said && /workspace/i.test(said)
      ? ` Ask whoever owns the ${provider} workspace to add credits, and then send it a message.`
      : ` Add credits with ${provider}, or wait until the limit resets, and then send it a message.`;
    return {
      kind: 'usage',
      provider,
      notify: firm,
      // For the person: the vendor's own sentence and link when there is one.
      text: head + (said ? ` ${provider} says: "${said}"` : todo),
      // For another agent: Kosmos's own words only. Screen text is never passed to another agent.
      summary: head + todo,
    };
  }
  if (card.state === 'auth_failed') {
    const text = `${who}'s ${provider} sign-in has stopped working, so it cannot do anything. Open its page and choose Sign in again.`;
    return { kind: 'signin', provider, notify: true, text, summary: text };
  }
  return null;
}

module.exports = { accountProblemOf, providerOf };
