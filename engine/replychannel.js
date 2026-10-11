'use strict';

/*
 * kosmos#5805 part 2: an agent can declare where it answers the person (`kosmos reply-channel "<where>"`).
 *
 * The report (collected feedback, 2026-10-10): an agent whose instructions say to answer through another channel
 * answered there, and a reminder then said nothing had reached the person. Kosmos cannot see an answer given outside
 * it, so with a channel declared neither reminder speaks for that agent: the first-reply nudge (firstreply-nudge.js)
 * and the room's #185 reminder with its "has not answered" line (messages.unanswered, which owedElsewhere shares).
 *
 * Stored on the agent's profile as `replyChannel`: words, at most MAX_LEN characters, one line. Empty clears it, and
 * so does "kosmos" (answering through Kosmos is what an undeclared agent does already).
 *
 * Weakest premise: a declared agent that does not answer on its channel is never reminded. Nothing checks the claim.
 */

const MAX_LEN = 60;

/* The value to store for what was typed: null to clear, a string to set. Throws an Error with a sentence for the
   person on anything else. */
function normalize(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('say the channel in words');
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) throw new Error('say the channel on one line');
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v || v.toLowerCase() === 'kosmos') return null;
  if (v.length > MAX_LEN) throw new Error('keep the channel to ' + MAX_LEN + ' characters');
  return v;
}

/* The declared channel on a profile object, or null. A stored value that would not be accepted today counts as none,
   so a hand-edited profile can never silence the reminders with something the command would refuse. */
function of(profile) {
  if (!profile || typeof profile !== 'object') return null;
  try { return normalize(profile.replyChannel); } catch { return null; }
}

/* Lazy, so requiring this module never loads store.js (messages.js and firstreply-nudge.js both require it). */
function storeNow() { return require('./store'); }

/* The agent's declared channel, or null. Never throws: a profile that cannot be read is no declaration, so the
   reminders behave as they did before this card. */
function forAgent(name, store) {
  if (!name) return null;
  try { return of((store || storeNow()).readProfile(name)); } catch { return null; }
}

/* Set or clear it. Returns the stored value (null when cleared). Throws normalize's sentences. */
function set(name, value, store) {
  const v = normalize(value);
  (store || storeNow()).writeProfile(name, { replyChannel: v });
  return v;
}

module.exports = { MAX_LEN, normalize, of, forAgent, set };
