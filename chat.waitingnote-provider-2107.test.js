'use strict';

/**
 * #2107/#2093: provider-name leak in running-agent state copy. The AUTH_FAILED
 * waiting note ("its Claude sign-in was not working") is shown on the REACHABLE
 * running-agent path -- a running codex agent fronts as a node process, passes
 * the messageable gate, and stays addressable (#571 send path). If a codex pane
 * classifies AUTH_FAILED, its OpenAI owner must not see a Claude-named message.
 *
 * waitingNote now takes the runner and names the PROVIDER the sign-in belongs to
 * (degrade to Claude), and deliver passes allowed.card.runner in (the card the
 * send was authorised against).
 *
 * #2107's first cut named the RUNNER here ("Codex"), copying the "no <runner>
 * running" idiom at chat.js:520. #2093 corrected it to the PROVIDER ("OpenAI")
 * on resolving the two PRs together, because the established, shipped vocabulary
 * names a SIGN-IN by its provider everywhere else -- create.js:2181 ("that OpenAI
 * account's sign-in is not working"), server.js:3144 ("your OpenAI sign-in"), and
 * ~15 web/index.html strings ("Sign in to OpenAI again", "which OpenAI sign-in it
 * runs on"). "Codex" names the RUNNER PROCESS (chat.js:520 "no Codex running"),
 * never a sign-in; a dead credential is an OpenAI account you reconnect, and the
 * board's own #2093 copy says "Its OpenAI sign-in is not working. Reconnect the
 * account." The note and the board must teach one fact, so both say OpenAI.
 *
 * These run the SHIPPED waitingNote, so what is under test is the code that ships.
 *
 *   node --test chat.waitingnote-provider-2107.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('./engine/chat');
const status = require('./engine/status');

const AUTH_FAILED = status.STATE.AUTH_FAILED;
const { UNCONFIRMED, COULD_NOT } = chat.DELIVERY;

test('#2107/#2093: a codex AUTH_FAILED note names OpenAI (the provider), never Claude or Codex', () => {
  const confirmed = chat.waitingNote(AUTH_FAILED, COULD_NOT, 'codex');
  assert.match(confirmed, /its OpenAI sign-in was not working/, 'the codex note is not OpenAI-named');
  assert.doesNotMatch(confirmed, /Claude/, 'the codex AUTH_FAILED note still leaks the word Claude');
  assert.doesNotMatch(confirmed, /Codex sign-in/, 'the codex note names the RUNNER on a SIGN-IN line -- a sign-in is a provider (OpenAI), not the runner');
  assert.match(confirmed, /so it will not act on this until that is fixed/, 'the settled-fact clause was dropped for the confirmed verdict');

  const unsure = chat.waitingNote(AUTH_FAILED, UNCONFIRMED, 'codex');
  assert.match(unsure, /its OpenAI sign-in was not working/, 'the unconfirmed codex note is not OpenAI-named');
  assert.doesNotMatch(unsure, /Claude/, 'the unconfirmed codex note still leaks Claude');
  assert.doesNotMatch(unsure, /so it will not act/, 'the unconfirmed verdict must drop the settled-fact clause');
});

test('#2107: a Claude AUTH_FAILED note still says Claude, and an unknown runner degrades to Claude', () => {
  assert.match(chat.waitingNote(AUTH_FAILED, COULD_NOT, 'claude'), /its Claude sign-in was not working/, 'the claude note lost its name');
  // degrade: no runner (the pre-#2107 default) -> Claude, never blank or Codex
  const degraded = chat.waitingNote(AUTH_FAILED, COULD_NOT, undefined);
  assert.match(degraded, /its Claude sign-in was not working/, 'an unknown runner did not degrade to Claude');
  assert.doesNotMatch(degraded, /Codex/, 'an unknown runner wrongly named Codex');
});

test('#2107: the runner only renames the AUTH_FAILED copy, not other states', () => {
  // A non-AUTH_FAILED state carries no runner name at all -- the change is scoped.
  const working = chat.waitingNote(status.STATE.WORKING, COULD_NOT, 'codex');
  assert.doesNotMatch(working, /Codex|Claude|OpenAI/, 'a provider/runner name leaked into a non-AUTH_FAILED note');
});

// Plumbing: prove deliver actually PASSES the runner, or the runner-aware note is an
// unarmed guard (waitingNote would always see undefined -> always Claude).
test('#2107 (source): deliver passes the card runner into waitingNote', () => {
  const SRC = fs.readFileSync('engine/chat.js', 'utf8');
  assert.match(SRC, /waitingNote\(paneState, outcome, allowed\.card\.runner\)/,
    'deliver does not pass allowed.card.runner into waitingNote -- the AUTH_FAILED note would always degrade to Claude even for a codex agent');
});
