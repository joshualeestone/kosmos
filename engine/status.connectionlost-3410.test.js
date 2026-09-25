'use strict';

/**
 * #3410 — CONNECTION_LOST classification.
 *
 * A transient network error (DNS/network blip) takes an agent's connection to
 * the API. Claude Code prints its own on-screen error and the turn ends; the
 * agent then sits wedged. Before this, that pane classified `unknown`
 * ("Can't tell") and the only recovery was a terminal (`claude doctor`).
 *
 * The error strings asserted here are BYTE-EXACT from the installed Claude Code
 * 2.1.280 bundle's error formatter (the `"Connection error."` switch on the
 * network error code) — not composed here.
 *
 * The controls are the point: each is aimed at a state the change CAN reach, so
 * a green run means the precedence actually holds, not that the assertion is
 * vacuous.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { classify, STATE, CONFIDENCE, reconcileReport } = require('./status');

// Same helper shape the main status.test.js uses: a pane as the engine sees it,
// with `session` present so classify() treats it as an agent's own pane.
const pane = (over = {}) => ({
  name: 'test',
  session: 'test-discord',
  target: 'test-discord:0.0',
  command: '2.1.222',
  title: '',
  ...over,
});

// A prompt footer under the error, i.e. the turn has ended and Claude is back
// at its input box — the exact "wedged, sitting there" shape. Without the new
// rule this footer would classify IDLE ("sitting at its prompt").
const withFooter = (line) => `${line}\n\n⏵⏵ accept edits · ? for shortcuts\n`;

// The byte-exact network-error lines Claude Code renders, each keyed to the
// error-code case that produces it.
const NETWORK_LINES = [
  "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
  "API Error: Can't reach the API server — check your internet or DNS (EAI_AGAIN)",
  "API Error: No internet route — check your connection or VPN (ENETUNREACH)",
  "API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)",
  "API Error: Connection dropped (ECONNRESET)",
  "API Error: Couldn't connect through your proxy (ERR_PROXY_TUNNEL) — the proxy refused the tunnel: check its credentials and that it allows this host",
  "API Error: Unable to connect to API. Check your internet connection",
  // The formatter's DEFENSIVE default arm ("Unable to connect to API (CODE)"),
  // reached only by a network code the formatter does not specifically case.
  // A neutral placeholder code, NOT EAI_AGAIN -- EAI_AGAIN always renders the
  // "reach the API server" form above, so reusing it here would model a
  // code/message pairing that does not occur. The point is only that the
  // paren-arm regex fires.
  "API Error: Unable to connect to API (E_OTHER_NET)",
  "API Error: Request timed out. Check your internet connection and proxy settings",
  // Bun's mixed-case codes, which Claude Code prints as-is (read from 2.1.282's formatter).
  "API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)",
  "API Error: Can't reach the API server — check your internet or DNS (FailedToOpenSocket)",
  "API Error: Connection dropped (ConnectionClosed)",
];

for (const line of NETWORK_LINES) {
  test(`a transient network error is connection_lost, not "Can't tell": ${line.slice(0, 42)}…`, () => {
    const r = classify(pane(), withFooter(line));
    assert.equal(r.state, STATE.CONNECTION_LOST,
      `expected connection_lost for: ${line}`);
    assert.equal(r.confidence, CONFIDENCE.SCRAPED);
    assert.ok(r.because && r.because.length > 0, 'connection_lost must explain itself');
    // The line rides along as evidence (the rate-limit / auth rule). No leading
    // glyph on this fixture, so the whole line is carried verbatim.
    assert.equal(r.evidence, line,
      `the matched line is not carried as evidence: ${r.evidence}`);
  });
}

// CONTROL 1 — the leading `●` bullet Claude prefixes on an error line does not
// defeat the match, because CONNECTION_LOST_MESSAGE is a SUBSTRING test on the row
// (glyph-agnostic), NOT because the bullet is stripped: matchedLine's strip class
// does not include `●`, so the evidence line even retains it.
test('a network error prefixed with the ● bullet still classifies connection_lost', () => {
  const r = classify(pane(), withFooter("● API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"));
  assert.equal(r.state, STATE.CONNECTION_LOST);
});

// CONTROL 1b — a CURLY apostrophe (U+2019) in "Can't" must still match. The regex
// keys on "reach the API server" (apostrophe-free) precisely so a bundle that renders
// a typographic apostrophe cannot silently drop the primary ENOTFOUND case. This
// fixture uses U+2019 deliberately, so it fails if the pattern ever reintroduces an
// ASCII-apostrophe dependency (the same-mental-model blind spot a straight-apostrophe
// fixture could not catch).
test('a network error with a CURLY apostrophe still classifies connection_lost', () => {
  const r = classify(pane(), withFooter('● API Error: Can’t reach the API server — check your internet or DNS (ENOTFOUND)'));
  assert.equal(r.state, STATE.CONNECTION_LOST,
    'a typographic apostrophe must not drop the ENOTFOUND case; key on an apostrophe-free substring');
});

// CONTROL 2 — PRECEDENCE, the safety hinge. An agent Claude is ACTIVELY RETRYING
// draws a live spinner; that must read WORKING, never connection_lost, so the
// self-heal nudge never touches an agent that may recover on its own. The
// spinner sits ON SCREEN with the error line still in the tail.
// ⚠️ This fixture's spinner is COMPOSED. The real Claude Code 2.1.281 retry line (measured
// 2026-09-24) has no ellipsis or timer, so WORKING_LINE does not match it; that case is
// status.connlost-retry-3410.test.js, built from captured frames.
test('an actively-retrying agent (live spinner) reads working, NOT connection_lost', () => {
  const tail = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)\n· Reconnecting… (4s · esc to interrupt)\n";
  const r = classify(pane(), tail);
  assert.equal(r.state, STATE.WORKING,
    'a live spinner must win over the connection-error line, or the self-heal could nudge a recovering agent');
});

// CONTROL 2b — proves CONTROL 2 is not vacuous: the SAME error line WITHOUT the
// live spinner DOES reach connection_lost. If this failed, CONTROL 2 would be
// asserting against a state the input never produces.
test('the same error line WITHOUT a live spinner reaches connection_lost (CONTROL 2 is not vacuous)', () => {
  const tail = withFooter("API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)");
  const r = classify(pane(), tail);
  assert.equal(r.state, STATE.CONNECTION_LOST);
});

// CONTROL 3 — the SSL/cert class is EXCLUDED. Its line uses the COLON form
// ("Unable to connect to API: SSL …") and is NOT restart-recoverable (a CA-trust
// fix, not a reconnect), so it must not read connection_lost.
test('an SSL certificate error is NOT connection_lost (colon form, excluded)', () => {
  const sslLines = [
    'API Error: Unable to connect to API: SSL certificate verification failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE).',
    'API Error: Unable to connect to API: SSL certificate has expired',
    'API Error: Unable to connect to API: SSL error (ERR_TLS_HANDSHAKE_TIMEOUT)',
  ];
  for (const line of sslLines) {
    const r = classify(pane(), withFooter(line));
    assert.notEqual(r.state, STATE.CONNECTION_LOST,
      `an SSL/cert error must not read connection_lost: ${line}`);
  }
});

// CONTROL 4 — a plain idle pane (footer only, no error) stays IDLE, so the new
// rule did not swallow the ordinary at-the-prompt case.
test('an ordinary idle pane (no error) stays idle, not connection_lost', () => {
  const r = classify(pane(), '\n\n⏵⏵ accept edits · ? for shortcuts\n');
  assert.equal(r.state, STATE.IDLE);
  assert.notEqual(r.state, STATE.CONNECTION_LOST);
});

// CONTROL 5 — a genuine AUTH failure still reads auth_failed, not connection_lost
// (auth is checked first and is a different, non-restart-recoverable problem).
test('an auth failure still reads auth_failed, not connection_lost', () => {
  const authTail = withFooter('● Please run /login · API Error: 401 OAuth access token has expired. Re-authenticate to continue.');
  const r = classify(pane(), authTail);
  assert.equal(r.state, STATE.AUTH_FAILED,
    'a real auth failure must not be reclassified as a transient connection loss');
});

// ---------------------------------------------------------------------------
// reconcileReport: scraped connection_lost stands over a self-report (rule 3b, #3410)
//
// The board runs reconcileReport(report, scrapedStatus) for its OWN launched
// agents -- the #3410 target population, which run the report hook. Without a
// rule, a stale/idle report would mask the scraped connection_lost back to
// working/idle/"Can't tell" -- the exact false calm #3410 removes. These pin the
// rule-3b analog.
// ---------------------------------------------------------------------------
const connScrape = () => ({
  state: STATE.CONNECTION_LOST,
  confidence: CONFIDENCE.SCRAPED,
  because: 'it lost its connection to the API',
  evidence: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
});
const report = (state, ageMs, now) => ({
  found: true, state, confidence: CONFIDENCE.REPORTED,
  because: 'reported ' + state, at: new Date(now - ageMs).toISOString(), auto: true,
});

test('#3410 reconcile: a FRESH `working` report does NOT mask scraped connection_lost', () => {
  const now = Date.now();
  const got = reconcileReport(report(STATE.WORKING, 30 * 1000, now), connScrape(), now);
  assert.equal(got.state, STATE.CONNECTION_LOST,
    'a fresh working report (necessarily from before the connection died) must not override the wedged screen');
  assert.ok(got.conflict && /connection|reports cannot know/.test(String(got.conflict)),
    'the disagreement must surface as a conflict note, not be silently swallowed');
});

test('#3410 reconcile: a `reported idle` does NOT render a wedged agent "at rest" (the exact false calm #3410 removes)', () => {
  const now = Date.now();
  const got = reconcileReport(report(STATE.IDLE, 30 * 1000, now), connScrape(), now);
  assert.equal(got.state, STATE.CONNECTION_LOST,
    'an idle report never decays; without rule 3b it would render a wedged agent "at rest and nothing is needed" forever');
});

// CONTROL — proves the two assertions above are not vacuous: for an ORDINARY
// scraped state, a fresh `working` report DOES win. If reports never won,
// "connection_lost stands over the report" would be trivially true.
test('#3410 reconcile CONTROL: a fresh `working` report still leads for an ordinary idle scrape', () => {
  const now = Date.now();
  const ordinaryIdleScrape = { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it is sitting at its prompt' };
  const got = reconcileReport(report(STATE.WORKING, 30 * 1000, now), ordinaryIdleScrape, now);
  assert.equal(got.state, STATE.WORKING,
    'CONTROL: a fresh working report must win over an ordinary idle scrape, or the connection_lost result is meaningless');
});
