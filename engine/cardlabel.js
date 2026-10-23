'use strict';
/**
 * #5959: the word a person sees on an agent's card, for the agent itself (`kosmos report show`), so an agent can check
 * its own card without reading the board.
 *
 * The page owns these words (web/index.html STATE_COPY, restartingLabel, stateCopyOf, and the card render's offline
 * branch). This is a second copy, kept equal by cardlabel-5959.test.js: it lifts the page's functions and compares
 * answers on every state and special case, and pins the offline branch (a template) by its text. A special case the
 * page gains later is compared only once the test lists a card for it. A state named like an Object member reads
 * "Can't tell" here, where the page has no word.
 */

const STATE_COPY = Object.freeze({
  working: 'Working',
  needs_you: 'Issue',
  question: 'Question',
  approval: 'Needs permission',   // #6091; #6727 (Josh, 10-20): says what it waits for
  rate_limited: 'Rate Limit',   // #6398 (Josh 2026-10-17), kept equal to the page by cardlabel-5959
  auth_failed: 'Sign-in Issue',   // #6716 (Josh 2026-10-20), kept equal to the page by cardlabel-5959
  connection_lost: 'Connection lost',
  blocked: 'Waiting',
  idle: 'Idle',
  restarting: 'Restarting agent',
  stopped: 'Not running',
  unknown: "Can't tell",
  needs_trust: 'Waiting on a trust prompt',
});

function restartingLabel(a) {
  const cause = a && a.disruption && a.disruption.cause;
  const base = cause === 'model' ? (a.modelName ? 'Switching to ' + a.modelName : 'Switching model')
    : cause === 'provider' ? 'Switching provider'
    : cause === 'instructions' ? 'Restarting to apply your changes'
    : cause === 'account' ? 'Switching account'
    : 'Restarting agent';
  if (a && a.disruption && a.disruption.timedOut === true) return base + ', not back yet';
  return base;
}

/** The card's label for board card `a`: the card render's offline branch, then the page's stateCopyOf. */
function labelOf(a) {
  /* The page's offline card (renderAgentCard's `a.running === false` branch) comes before stateCopyOf: a trust prompt,
     a job running where Kosmos cannot see it ("Can't tell"), or "Not running". */
  if (a && a.running === false && a.state !== 'restarting') {
    if (a.needsTrust === true) return STATE_COPY.needs_trust;
    return a.jobRunningUnseen === true ? STATE_COPY.unknown : 'Not running';
  }
  if (a && a.crashLoop && a.crashLoop.looping === true) return 'Keeps stopping';
  if (a && a.state === 'restarting') return restartingLabel(a);
  if (a && a.state === 'needs_you' && a.stateReportedBy === 'agent') return STATE_COPY.question;
  // #6091: the card is on its permission prompt (status.awaitingApprovalOf), as the page's stateCopyOf.
  if (a && a.state === 'needs_you' && a.awaitingApproval === true) return STATE_COPY.approval;
  if (a && a.state === 'connection_lost' && a.reconnect
    && (a.reconnect.phase === 'waiting' || a.reconnect.phase === 'retried')) return 'Reconnecting…';
  const s = a && typeof a.state === 'string' && Object.prototype.hasOwnProperty.call(STATE_COPY, a.state) ? a.state : 'unknown';
  return STATE_COPY[s];
}

/* #7004 (the iPhone plan's slice 2, #6838): the tone a card's word has in the phone's Agents list, Mona Lisa's slice 1
   table. It sets the dot and the word's colour there, and the list's order. Built from STATE_COPY's own values, so a
   word changed above changes here too, except 'Not running', which labelOf's offline branch also writes as a literal. */
const NEEDS_YOU_WORDS = new Set([STATE_COPY.approval, STATE_COPY.needs_you, STATE_COPY.rate_limited, STATE_COPY.auth_failed,
  STATE_COPY.connection_lost, STATE_COPY.blocked, 'Not running', STATE_COPY.unknown]);

/** 'asked' (a question), 'needs_you', 'working' or 'quiet' for board card `a`. `needsPerson` is the board's own answer
 * for the card (engine/status.js needsPerson), passed in: an agent the board counts as needing the person is needs_you
 * whatever its word (a crash loop reads "Keeps stopping"). A state this copy has no word for (one added later) is
 * quiet, never red at the top, unless the board counts it as needing the person. */
function toneOf(a, needsPerson) {
  const known = Boolean(a) && typeof a.state === 'string' && Object.prototype.hasOwnProperty.call(STATE_COPY, a.state);
  const offline = Boolean(a) && a.running === false;
  const looping = Boolean(a && a.crashLoop && a.crashLoop.looping === true);
  if (!offline && !looping && !needsPerson && !known) return 'quiet';
  const word = labelOf(a);
  if (word === STATE_COPY.question) return 'asked';
  if (NEEDS_YOU_WORDS.has(word) || needsPerson) return 'needs_you';
  if (word === STATE_COPY.working) return 'working';
  return 'quiet';
}

/** The sentence `kosmos report show` leads with; a label that already ends in punctuation gets no second. */
function cardLine(label) {
  return 'Your card on the board shows: ' + label + (/[.…]$/.test(label) ? '' : '.');
}

/** How long a report has stood, in words, from its age alone (whole hours, then whole 24-hour periods), so the words
    never depend on where the stale threshold sits. */
function standingFor(ageMs) {
  const hours = Math.floor(ageMs / 3600e3);
  if (hours < 24) return hours === 1 ? '1 hour' : hours + ' hours';
  const days = Math.floor(hours / 24);
  return days >= 2 ? days + ' days' : 'over a day';
}

module.exports = { labelOf, toneOf, cardLine, standingFor, STATE_COPY, NEEDS_YOU_WORDS };
