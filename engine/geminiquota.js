'use strict';

/**
 * #4004: a Gemini API-key agent that runs out of Google's free daily limit stops on Gemini's own question
 * ("Usage limit reached for <model>." / 1. Keep trying / 2. Stop) and waits there forever: an unattended agent
 * nobody is watching. Each tick, for every Gemini card whose screen shows that question (status.js reads it as
 * rate_limited, waiting on Keep trying or Stop), answer Stop through chat.answerGeminiQuotaStop, which re-reads the
 * pane and presses the number printed beside Stop. Retrying cannot clear a daily limit. The card then reads the
 * limit (the quota error at its prompt), and the next message after the reset simply works.
 *
 * At most one answer per agent per ANSWER_EVERY_MS: a question that is still up after that is answered again, and
 * a failed answer is logged, never looped on quickly.
 */

const ANSWER_EVERY_MS = 60 * 1000;

function waitingOnQuestion(card) {
  return !!card && card.runner === 'gemini' && card.state === 'rate_limited'
    && /waiting on Keep trying or Stop/.test(String(card.because || ''));
}

/**
 * { roster, answer(session, roster) -> {ok, because?, key?}, book: Map, now, log? } -> results[]
 * Never throws: one agent's failure never stops the others.
 */
function sweepOnce(o) {
  const roster = (o && Array.isArray(o.roster)) ? o.roster : [];
  const book = (o && o.book instanceof Map) ? o.book : new Map();
  const now = o && Number.isFinite(o.now) ? o.now : Date.now();
  const answer = o && typeof o.answer === 'function' ? o.answer : null;
  const log = o && typeof o.log === 'function' ? o.log : null;
  const results = [];
  if (!answer) return results;
  for (const card of roster) {
    const session = card && card.sessionName;
    if (!session || !waitingOnQuestion(card)) continue;
    const last = book.get(session);
    if (Number.isFinite(last) && now - last < ANSWER_EVERY_MS) continue;
    book.set(session, now);
    let got;
    try { got = answer(session, roster); } catch (err) { got = { ok: false, because: String((err && err.message) || err) }; }
    const r = { session, name: (card && card.name) || session, answered: !!(got && got.ok), because: (got && (got.because || (got.ok ? 'answered Stop with ' + got.key : ''))) || '' };
    results.push(r);
    if (log) { try { log(r); } catch { /* logging never breaks a sweep */ } }
  }
  for (const [k] of book) if (!roster.some((c) => c && c.sessionName === k && waitingOnQuestion(c))) book.delete(k);
  return results;
}

module.exports = { ANSWER_EVERY_MS, waitingOnQuestion, sweepOnce };
