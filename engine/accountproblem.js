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
 *   - rate_limited: out of usage or credits (Codex's messages, #3723) or a Claude usage limit;
 *   - auth_failed: its sign-in stopped working.
 * The vendor's own sentence (the card's stateEvidence) is quoted when there is one, because it
 * carries the vendor's own remedy and link and stays true when their wording changes.
 */

const PROVIDER_NAME = Object.freeze({ codex: 'OpenAI', gemini: 'Gemini', grok: 'Grok' });

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
 * { kind: 'usage' | 'signin', provider, text, summary }: `text` is for the person (it may quote the
 * vendor's sentence from the agent's screen); `summary` is Kosmos's own words only, for another agent.
 */
function accountProblemOf(card) {
  if (!card || typeof card.state !== 'string') return null;
  const who = nameOf(card);
  const provider = providerOf(card);
  const said = quoted(card);
  if (card.state === 'rate_limited') {
    /* Claude's "reached your ... limit" marker also matches prose like "reached your context limit",
       a known false match kept on the card (engine/status.js RATE_LIMIT_MARKERS). That is not an
       account problem, so it is not told here. */
    if (said && provider === 'Claude' && /\bcontext\b/i.test(said)) return null;
    const head = `${who} has run out of ${provider} usage or credits, so it has stopped.`;
    const todo = ` Add credits with ${provider}, or wait until the limit resets, and then send it a message.`;
    return {
      kind: 'usage',
      provider,
      // For the person: the vendor's own sentence and link when there is one.
      text: head + (said ? ` ${provider} says: "${said}"` : todo),
      // For another agent: Kosmos's own words only. Screen text is never passed to another agent.
      summary: head + todo,
    };
  }
  if (card.state === 'auth_failed') {
    const text = `${who}'s ${provider} sign-in has stopped working, so it cannot do anything. Open its page and choose Sign in again.`;
    return { kind: 'signin', provider, text, summary: text };
  }
  return null;
}

module.exports = { accountProblemOf, providerOf };
