'use strict';
/**
 * kosmos#5359: the one copy of the words `kosmos accounts` prints, used by both CLIs (install/kosmos cmd_accounts and
 * tools/windows/kosmos-cli.js verbAccounts), so the two cannot drift.
 *
 * An account's line reads its state as the board's Settings > AI Models row does: the badge first (a credential on
 * disk is state "connected" even when its last request was refused, #874), a sign-in that has run out says when its
 * agents stop (#5168), and the account is named as the board names its row (acctPrimaryName), short of its folder.
 * Board text never prints as an extra line: control characters are replaced.
 */

const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ');
const str = (v) => (typeof v === 'string' && v.trim() ? clean(v).trim() : '');

/** What the account is called: the chosen name, the email, a keyed provider's key ending, the label, then which
 * sign-in it is for the two that carry none of those, then the default account. Never its folder. */
function accountName(a) {
  return str(a.name) || str(a.email)
    || (/^(openai|google|xai)$/i.test(String(a.provider || '')) && str(a.keyTail) ? 'API key ending ' + str(a.keyTail) : '')
    || str(a.label)
    || (a.authMode === 'antigravity' ? 'its Google subscription sign-in' : a.authMode === 'muse' ? 'its Meta account sign-in' : '')
    || (a.isDefault === true ? 'the default account' : '')
    || 'an account with no name or email on record';
}

function accountState(a, now = Date.now()) {
  const c = a.connection && typeof a.connection === 'object' ? a.connection : {};
  const why = str(c.because) ? ': ' + str(c.because) : '';
  const stops = Number.isFinite(c.loginStopsAt) && c.loginStopsAt > now ? c.loginStopsAt : null;
  if (stops) {
    const when = new Date(stops).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return 'its sign-in has run out; its agents keep working until ' + when + ', then stop. The person signs in again in Settings > AI Models';
  }
  if (c.badge === 'working') return 'signed in';
  if (c.badge === 'signed_in_unverified') return 'signed in by Kosmos\'s record, not yet confirmed by a real request';
  if (c.badge === 'rejected') return 'not signed in: its last request was refused. The person signs in again in Settings > AI Models';
  if (c.badge === 'signed_out') return 'not signed in' + why;
  if (c.badge === 'unchecked') return 'could not be checked just now' + why;
  if (c.liveCheckPending === true) return 'being checked now; it is known on the next read';
  if (a.authMode === 'chatgpt' && c.state === 'unknown') return 'signed in by its own record, not yet confirmed by a real request';
  if (c.state === 'connected') return 'signed in';
  if (c.state === 'none') return 'not signed in' + why;
  return 'could not be checked just now' + why;
}

function accountLine(a, now = Date.now()) {
  const provider = str(a.providerName) || str(a.provider) || 'a provider';
  const how = str(a.authMode) ? ' (' + str(a.authMode) + ')' : '';
  return provider + ': ' + accountName(a) + how + ': ' + accountState(a, now);
}

/**
 * The whole answer for an HTTP status and a parsed body (or null): { lines } to print, or { fail } with the sentence
 * to say. The same classes on both CLIs: a 5xx (JSON or not, empty or not) is a fault, never a refusal; a 4xx is a
 * refusal only when the board says why; a 2xx that is not an account list cannot be read.
 */
function answer(status, json, now = Date.now()) {
  const err = json && typeof json.error === 'string' ? clean(json.error).replace(/[.\s]+$/, '') : '';
  if (status >= 500 || (status >= 400 && !err)) return { fail: 'Kosmos could not read its accounts just now' + (err ? ': ' + err : '') + '. Try again in a minute.' };
  if (status >= 400) return { fail: 'Kosmos refused that request: ' + err + '.' };
  if (!json || !Array.isArray(json.accounts)) return { fail: 'Kosmos gave an answer we could not read about its accounts.' };
  if (!json.accounts.length) return { lines: ['No provider accounts are set up on this board yet. The person adds one in Settings > AI Models.'] };
  return { lines: json.accounts.filter((a) => a && typeof a === 'object').map((a) => accountLine(a, now)) };
}

module.exports = { accountLine, accountName, accountState, answer, clean };
