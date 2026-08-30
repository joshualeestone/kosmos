'use strict';

/**
 * What an AGENT is allowed to see about this computer's connections.
 *
 * Card #1034 part (2). An agent helping somebody get connected is the only
 * participant who cannot see the screen, so it needs an answer -- but the
 * richest readers on hand are not safe to hand over:
 *
 *   connect.state()            carries `url`, a LIVE OAuth authorize URL, and
 *                              `tail`, 12 lines of raw terminal output from the
 *                              pane where the person pastes their sign-in code
 *   accounts/openaiaccounts    carry `email` and `dir`
 *   runners.status()           carries `bin`, a filesystem path
 *
 * A live sign-in URL is a BEARER CREDENTIAL for its window: an agent holding
 * one can complete a sign-in as the person. So the default is do not expose,
 * and the asymmetry is the whole argument -- verdict-only widens in a commit,
 * a leaked URL cannot be un-leaked.
 *
 * 🔑 THE RULE, chosen because it is provable rather than reviewable:
 *
 *   NOTHING IS PASSED THROUGH. Every string this module emits is either an
 *   enum value it allowlists, or a sentence from SAYS below.
 *
 * ⚠️ Why not the softer "pass through the fields that are safe today". It was
 * measured and it is true today and it would have been wrong on the next edit:
 * none of the 23 `because` fields in connect.js interpolate captured output,
 * but subscription.js builds one from `${org}`, read out of the person's own
 * Claude config. One field name, two source modules, opposite answers. A rule
 * that depends on which module a sentence came from cannot be checked by
 * looking at this file.
 *
 * ⇒ The test that keeps this honest plants a foreign string in every input and
 * asserts it does not reach the output. It fails if anyone widens this.
 */

const subscription = require('./subscription');

/* Every sentence this module can emit. Nothing else may be said. */
const SAYS = {
  SIGNED_IN: 'this computer has a working sign-in for it',
  NOT_SIGNED_IN: 'this computer has no working sign-in for it',
  CANNOT_TELL: 'we could not check the sign-in on this computer just now',
  NO_RUNNER: 'the program it needs is not installed on this computer yet',
  SERVICE_ON: 'connected',
  SERVICE_OFF: 'not connected',
  SERVICE_UNSURE: 'we could not check it just now',
};

/**
 * The sign-in phases we are willing to name. An unrecognised phase becomes
 * `unknown` rather than travelling: the point of an allowlist is that a value
 * we have never seen does not get to be the first one out of the door.
 */
const PHASES = [
  'idle', 'downloading', 'installing',
  'signin-launching', 'signin-browser-open', 'signin-awaiting-code',
  'signin-completing', 'connected', 'stuck', 'interrupted',
];

const BUSY_PHASES = [
  'downloading', 'installing',
  'signin-launching', 'signin-browser-open', 'signin-awaiting-code',
  'signin-completing',
];

/**
 * `unknown` is a real answer and is never collapsed into "not connected".
 * Same reason `kosmos agents` refuses a confident "None" when it is merely
 * blind: a settled negative ends the search at exactly the moment somebody is
 * trying to find the thing.
 */
function stateOf(rows) {
  if (!Array.isArray(rows) || !rows.length) return subscription.STATE.NONE;
  let sawUnknown = false;
  for (const row of rows) {
    const st = row && row.connection && row.connection.state;
    if (st === subscription.STATE.CONNECTED) return subscription.STATE.CONNECTED;
    if (st !== subscription.STATE.NONE) sawUnknown = true;
  }
  return sawUnknown ? subscription.STATE.UNKNOWN : subscription.STATE.NONE;
}

function saysFor(state, runnerPresent) {
  if (state === subscription.STATE.CONNECTED) return SAYS.SIGNED_IN;
  if (state === subscription.STATE.UNKNOWN) return SAYS.CANNOT_TELL;
  return runnerPresent === false ? SAYS.NO_RUNNER : SAYS.NOT_SIGNED_IN;
}

/**
 * A count, not a list. How many sign-ins exist is useful for helping somebody
 * ("you have two, the switch will ask which"); WHICH sign-ins they are is the
 * part that identifies a person, so it does not travel.
 */
function countOf(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * ⚠️ A READER THAT THREW IS NOT AN EMPTY MACHINE. Without this the route's
 * `.catch(() => null)` arrives here as zero rows, which `stateOf` correctly
 * reads as NONE -- a confident "no sign-in" for a computer we simply could not
 * read. That is the exact failure `kosmos agents` refuses ("a confident None
 * ends the search at the moment somebody is trying to find their agents"), so
 * an unreadable provider is UNKNOWN and says so.
 */
function providerView(id, name, rows, runner, unreadable) {
  const present = runner && typeof runner.present === 'boolean' ? runner.present : null;
  const state = unreadable === true ? subscription.STATE.UNKNOWN : stateOf(rows);
  return {
    id,
    name,
    installed: present,
    signedIn: state,
    howMany: countOf(rows),
    because: saysFor(state, present),
  };
}

/**
 * The doors already answer verdict-only and three-state (`connected` true,
 * false or null), so they are composed rather than rebuilt. Their `who` is a
 * login and is dropped here; that field is for the operator's own screen.
 */
function serviceView(doors) {
  const out = [];
  if (!doors || typeof doors !== 'object') return out;
  for (const route of Object.keys(doors).sort()) {
    const d = doors[route] || {};
    const connected = d.connected === true ? true : (d.connected === false ? false : null);
    out.push({
      name: String(route).replace(/^\/api\//, ''),
      connected,
      because: connected === true ? SAYS.SERVICE_ON
        : (connected === false ? SAYS.SERVICE_OFF : SAYS.SERVICE_UNSURE),
    });
  }
  return out;
}

function signinView(st) {
  const raw = st && typeof st.phase === 'string' ? st.phase : null;
  const phase = PHASES.includes(raw) ? raw : 'unknown';
  return { phase, busy: BUSY_PHASES.includes(phase) };
}

/**
 * Pure on purpose: the route collects, this decides. That is what makes the
 * leak test cheap enough to actually run on every input at once.
 */
function forAgent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const runners = src.runners && typeof src.runners === 'object' ? src.runners : {};
  const accounts = Array.isArray(src.accounts) ? src.accounts : [];
  const byProvider = (p) => accounts.filter((a) => a && a.provider === p);
  const blind = src.unreadable && typeof src.unreadable === 'object' ? src.unreadable : {};
  return {
    providers: [
      providerView('anthropic', 'Claude Code', byProvider('anthropic'), runners.anthropic, blind.anthropic === true),
      providerView('openai', 'GPT (OpenAI, through Codex)', byProvider('openai'), runners.openai, blind.openai === true),
    ],
    signin: signinView(src.connect),
    services: serviceView(src.doors),
  };
}

module.exports = { forAgent, SAYS, PHASES, BUSY_PHASES };
