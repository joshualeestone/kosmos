'use strict';
/**
 * #3410: the board card and list row for an agent that lost its connection to
 * the API (a transient network error). A DOM-level test (it extracts the SHIPPED
 * card()/lrow() region from web/index.html and renders them, exactly as
 * server.test.js does), so it runs on macOS CI without a browser. It proves the
 * new `connection_lost` state renders as "Connection lost" with a dressed state
 * pill, instead of falling back to the opaque "Can't tell".
 *
 *   node --test web.connection-lost-3410.test.js
 */

/* 🛑 SANDBOX BEFORE ANY REQUIRE that pulls engine/status (test-support/fleet does):
   status.js freezes its roots at require time. Same discipline as #3013. */
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-3410-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');

const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/* The shipped renderers, evaluated from the REAL page region (STATE_COPY through
   lrow) so CARD_ST / STATE_COPY / GLYPH / cardStOf / stateCopyOf are the real
   ones, not stubs — the same slice server.test.js uses. connection_lost has no
   bespoke render branch (unlike needs_trust); it goes through the GENERIC pill
   path, so the real consts must drive it. */
const from = SCRIPT.indexOf('const STATE_COPY = {');
const lrowAt = SCRIPT.indexOf('function lrow(a)');
const end = SCRIPT.indexOf('\n}', SCRIPT.indexOf('</div>`;', lrowAt)) + 2;
assert.ok(from > -1 && lrowAt > from && end > lrowAt, 'renderer block not found — this test is stale, not the code');
// eslint-disable-next-line no-new-func
const api = new Function('CURRENT', SCRIPT.slice(from, end) + '\n; return { card, lrow };')(null);

/* A real snapshot() card, then augmented with the network-loss fields the
   producer sets (state from classify, because + evidence ride along). */
const BOARD = fleet.install([fleet.agent('nettie', { state: 'idle' })]);
process.on('exit', () => { try { BOARD.restore(); } catch { /* best effort */ } });
const BASE = BOARD.card('nettie');
const EVIDENCE = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
/* profile/context are replaced with plain objects: the STRICT snapshot card does
   not carry the route's `profile` enrichment (the route adds it, and server.test.js
   renders route cards with freeForm:['profile','context'] for exactly this). The
   subject here is the STATE PILL, so these incidental fields get the route-honest
   shape (a role the renderer reads, an empty context union) rather than the strict
   proxy that throws on a field the snapshot omits. */
const plainify = (a) => Object.assign({}, a, { profile: { role: 'Assistant' }, context: {} });
const connLostAgent = (extra) => plainify(Object.assign({}, BASE, {
  running: true,                 // the Claude process is up; it just cannot reach the API (pres:'on')
  state: 'connection_lost',
  stateConfidence: 'scraped',    // classify() only ever emits this state as SCRAPED
  because: 'it lost its connection to the API',
  evidence: EVIDENCE,
}, extra || {}));
const idleAgent = () => plainify(Object.assign({}, BASE, { running: true, state: 'idle' }));

/* Pin the shipped label at its source so a copy change is a deliberate update. */
function pageLabel() {
  const m = /connection_lost:\s*\{\s*label:\s*'([^']+)'/.exec(SCRIPT);
  assert.ok(m, 'STATE_COPY.connection_lost.label is gone from the page; this test is stale, not the code');
  return m[1];
}

for (const which of ['card', 'lrow']) {
  test(`${which}: a connection_lost agent renders "Connection lost", not "Can't tell"`, () => {
    const html = api[which](connLostAgent());
    assert.match(html, /Connection lost/, `${which} did not carry the connection_lost label`);
    assert.doesNotMatch(html, /Can't tell/, `${which} fell back to the opaque "Can't tell" for a state it can name`);
    assert.match(html, /nettie|Nettie/i);
  });

  /* CONTROL — proves the label assertion is not vacuous: an ordinary idle agent
     renders neither the connection_lost label nor "Can't tell". If the renderer
     ignored state entirely, this would fail. */
  test(`${which}: an ordinary idle agent does NOT render "Connection lost" (control)`, () => {
    const html = api[which](idleAgent());
    assert.doesNotMatch(html, /Connection lost/, `${which} drew connection_lost for a plain idle agent`);
  });
}

/* The CARD pill carries the dressed state class (auth_failed's `st-paused` shape,
   reused). The LIST row conveys state as the row's ground colour + a .vh label
   rather than a pill class (#3131/#3187), so its label coverage above is the arm
   that applies there. */
test('card: the connection_lost pill wears a state class the stylesheet actually dresses', () => {
  const html = api.card(connLostAgent());
  const cls = /class="astate (st-[a-z-]+)"/.exec(html);
  assert.ok(cls, 'card put no state class on the connection_lost pill');
  assert.equal(cls[1], 'st-paused', 'connection_lost should reuse the paused pack shape (mirrors auth_failed)');
  const rules = PAGE.split(`.${cls[1]}`).length - 1;
  assert.ok(rules > 0, `card uses .${cls[1]}, which has no rule in the stylesheet`);
});

/* #3410 (Mona Lisa's look): while Kosmos is reconnecting the card stays quiet (paused); once it
   has given up the person is needed, so it wears needs_you's card (st-attn). */
test('card: reconnecting keeps the paused look; given up wears the needs-you look', () => {
  const clsOf = (extra) => (/class="astate (st-[a-z-]+)"/.exec(api.card(connLostAgent(extra))) || [])[1];
  assert.equal(clsOf({ reconnect: { phase: 'waiting', tries: 0 } }), 'st-paused');
  assert.equal(clsOf({ reconnect: { phase: 'retried', tries: 1 } }), 'st-paused');
  const gaveUp = clsOf({ reconnect: { phase: 'gave_up', tries: 3 } });
  assert.equal(gaveUp, 'st-attn', 'a given-up connection should ask for the person, not sit paused');
  assert.equal(clsOf({}), 'st-paused', 'CONTROL: with no self-heal the card is unchanged');
});

/* #3410 (Mona Lisa): given up is counted under the Issue filter (data-attn); reconnecting is not. */
test('card and list row: given up is in the Issue filter, reconnecting is not', () => {
  for (const which of ['card', 'lrow']) {
    const attnOf = (extra) => /\bdata-attn\b/.test(api[which](connLostAgent(extra)));
    assert.equal(attnOf({ reconnect: { phase: 'gave_up', tries: 3 } }), true, `${which}: given up is not in the Issue filter`);
    assert.equal(attnOf({ reconnect: { phase: 'waiting', tries: 0 } }), false, `${which}: reconnecting is in the Issue filter`);
    assert.equal(attnOf({}), false, `${which}: CONTROL, no self-heal is not in the Issue filter`);
  }
});

test('the page ships the expected connection_lost label copy', () => {
  assert.equal(pageLabel(), 'Connection lost',
    'the shipped STATE_COPY.connection_lost label changed; update this pin deliberately');
});

// #3410: the card says what the state MEANS in human terms (Josh #215: raw
// terminal text is not what a white-collar person thinks about), not the raw
// "API Error: ... (ENOTFOUND)" evidence line.
test('card: a connection_lost agent shows a human sentence, not the raw API-Error evidence', () => {
  const html = api.card(connLostAgent());
  assert.match(html, /lost its internet connection/,
    'the card does not explain the connection_lost state in plain words');
  assert.doesNotMatch(html, /ENOTFOUND/,
    'the raw terminal evidence leaked onto the card face instead of a human sentence');
});

/* #3410 copy: what Kosmos is doing about it, from the route's `reconnect` field. Each phase is
   rendered through the REAL card/lrow, and the no-field case is the control that keeps the
   original "Connection lost" (the self-heal is not running, so nothing may promise a retry). */
for (const which of ['card', 'lrow']) {
  test(`${which}: while Kosmos still has retries to give, the label is "Reconnecting…", not "Connection lost"`, () => {
    for (const phase of ['waiting', 'retried']) {
      const html = api[which](connLostAgent({ reconnect: { phase, tries: phase === 'retried' ? 1 : 0 } }));
      assert.match(html, /Reconnecting…/, `${which} (${phase}) did not say Kosmos is reconnecting`);
      assert.doesNotMatch(html, /Connection lost/, `${which} (${phase}) still says Connection lost while Kosmos is on it`);
    }
  });
  test(`${which}: once Kosmos has given up, or is not retrying at all, it is "Connection lost" again`, () => {
    for (const extra of [{ reconnect: { phase: 'gave_up', tries: 3 } }, { reconnect: null }, {}]) {
      const html = api[which](connLostAgent(extra));
      assert.match(html, /Connection lost/, `${which} ${JSON.stringify(extra)} lost the Connection lost label`);
      assert.doesNotMatch(html, /Reconnecting…/, `${which} ${JSON.stringify(extra)} claimed a reconnect`);
    }
  });
}

test('card: the sentence says what Kosmos is doing, and promises nothing when it is not retrying', () => {
  const says = (extra) => api.card(connLostAgent(extra));
  assert.match(says({ reconnect: { phase: 'waiting', tries: 0 } }), /Kosmos will try again for you\./);
  assert.match(says({ reconnect: { phase: 'retried', tries: 2 } }), /Kosmos has asked it to try again/);
  const gaveUp = says({ reconnect: { phase: 'gave_up', tries: 3 } });
  assert.match(gaveUp, /Kosmos tried a few times and stopped\./);
  assert.match(gaveUp, /If your internet is working, restart the agent\. It starts fresh, so anything it was in the middle of is lost\./);
  const off = says({});
  assert.match(off, /lost its internet connection/);
  assert.doesNotMatch(off, /Kosmos (will try|has asked)/, 'promised a retry with no self-heal running');
});

/* #3410: the 15-minute check-in does not ask the person to reconnect an agent Kosmos is already
   reconnecting. The shipped prompterCheckinQuestion, evaluated with a LAST it can read. */
test('check-in: while Kosmos is reconnecting it, the question does not ask the person to reconnect it', () => {
  const at = SCRIPT.indexOf('function prompterCheckinQuestion(n)');
  assert.ok(at > -1, 'prompterCheckinQuestion is gone from the page; this test is stale, not the code');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  // eslint-disable-next-line no-new-func
  const ask = (LAST, n) => new Function('LAST', body + '\n; return prompterCheckinQuestion;')(LAST)(n);
  // The LAST rows are the real fleet card (connLostAgent), keyed by its own sessionName.
  const n = { session: BASE.sessionName, to: 'connection_lost' };
  for (const phase of ['waiting', 'retried']) {
    const q = ask([connLostAgent({ reconnect: { phase, tries: 0 } })], n);
    assert.match(q, /Kosmos is reconnecting it/);
    assert.doesNotMatch(q, /Reconnect it/, `(${phase}) asked the person to reconnect it`);
  }
  // Given up: the same verb as the card ("restart the agent").
  assert.match(ask([connLostAgent({ reconnect: { phase: 'gave_up', tries: 3 } })], n), /Kosmos stopped trying\. Restart it, or is it done\?/);
  // Control: not running, or no board read yet: the original question.
  for (const LAST of [[connLostAgent({ reconnect: null })], []]) {
    assert.match(ask(LAST, n), /Reconnect it, or is it done\?/);
  }
});
