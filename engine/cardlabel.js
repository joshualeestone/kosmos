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
  approval: 'Waiting for you',   // #6091
  rate_limited: 'Paused',
  auth_failed: "Sign-in isn't working",
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
  // #6091: a permission prompt (status.APPROVAL_WAITING; web.approval-pill-6091.test.js pins the string).
  if (a && a.state === 'needs_you' && a.because === 'it is waiting for your approval') return STATE_COPY.approval;
  if (a && a.state === 'connection_lost' && a.reconnect
    && (a.reconnect.phase === 'waiting' || a.reconnect.phase === 'retried')) return 'Reconnecting…';
  const s = a && typeof a.state === 'string' && Object.prototype.hasOwnProperty.call(STATE_COPY, a.state) ? a.state : 'unknown';
  return STATE_COPY[s];
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

module.exports = { labelOf, cardLine, standingFor, STATE_COPY };
