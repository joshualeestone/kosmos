'use strict';
/**
 * #5959: the word a person sees on an agent's card, for the agent itself (`kosmos report show`), so an agent can check
 * its own card without reading the board.
 *
 * The page owns these words (web/index.html STATE_COPY, restartingLabel, stateCopyOf). This is a second copy, kept
 * equal by cardlabel-5959.test.js, which lifts the page's own functions and compares their answers with these on every
 * state and special case. Change one and that test goes red until the other matches.
 */

const STATE_COPY = Object.freeze({
  working: 'Working',
  needs_you: 'Issue',
  question: 'Question',
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

/** The card's label for board card `a`, as the page's stateCopyOf picks it. */
function labelOf(a) {
  if (a && a.crashLoop && a.crashLoop.looping === true) return 'Keeps stopping';
  if (a && a.state === 'restarting') return restartingLabel(a);
  if (a && a.state === 'needs_you' && a.stateReportedBy === 'agent') return STATE_COPY.question;
  if (a && a.state === 'connection_lost' && a.reconnect
    && (a.reconnect.phase === 'waiting' || a.reconnect.phase === 'retried')) return 'Reconnecting…';
  const s = a && typeof a.state === 'string' && Object.prototype.hasOwnProperty.call(STATE_COPY, a.state) ? a.state : 'unknown';
  return STATE_COPY[s];
}

module.exports = { labelOf, STATE_COPY };
