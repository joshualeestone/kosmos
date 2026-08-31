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
 *   accounts/openaiaccounts    carry `email`, `dir` and `keyTail`
 *   runners.status()           carries `bin`, a filesystem path
 *
 * ⚠️ `keyTail` WAS MISSING FROM THIS LIST UNTIL ITERATION 13, AND IT IS THE ONE
 * THE PROOF ORIGINALLY MISSED. The leak test's first fixture had no keyTail, so
 * it passed while saying nothing about that field; the fixture was corrected and
 * this list, which is what a future reader consults, was not. The plan names its
 * own weakest premise as "the allowlist is only as good as its list", so a
 * sensitive field absent from the list is that premise failing quietly.
 *
 * A live sign-in URL is a BEARER CREDENTIAL for its window: an agent holding
 * one can complete a sign-in as the person. So the default is do not expose,
 * and the asymmetry is the whole argument -- verdict-only widens in a commit,
 * a leaked URL cannot be un-leaked.
 *
 * 🛑 SCOPE, BECAUSE THE SENTENCE ABOVE READS STRONGER THAN IT IS. This is a safe
 * OPTION, not a boundary that constrains anybody. The board binds loopback with
 * no auth, so any local process -- an agent's own shell included -- can read
 * `/api/connect` directly and get the URL and the tail. What this buys is that a
 * bearer credential stays OUT OF AN AGENT'S CONTEXT BY DEFAULT, and context
 * propagates into messages, commits, handoffs and other agents' transcripts.
 * The exposure addressed here is PROPAGATION, not ACCESS. Do not cite this as
 * protection against a hostile agent; three other reads walk around it.
 *
 * 🔑 THE RULE, chosen because it is provable rather than reviewable:
 *
 *   NOTHING IS PASSED THROUGH. Every string this module emits is either an
 *   enum value it allowlists, or a sentence from SAYS below.
 *
 * 🛑 ONE HONEST EXCEPTION, AND IT IS A CALLER CONTRACT RATHER THAN A PROPERTY OF
 * THIS FILE: `services[].name` is copied out of the `doorNames` map the caller
 * supplies. Resolving THROUGH an allowlist does not make the resolved value
 * stop being input, and an earlier comment here implied it did. It is safe
 * because `server.js` builds that map from THREE LITERALS AND NOTHING ELSE --
 * so the guarantee lives at the call site. (It used to add
 * `tokendoors.routes()`; the token doors were dropped from the agent view as a
 * money decision, and this sentence outlived them by one iteration. The map is
 * now NARROWER than the comment claimed, so the drift was in the safe direction
 * -- which is exactly why nothing caught it, and why it is worth fixing in a
 * branch whose subject is comments that stop matching their code.) **Anyone passing a `doorNames` built from
 * anything a person or a request can influence breaks this module's rule**, and
 * no assertion in here can catch them.
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

/**
 * 🛑 TWO VOCABULARIES, AND THEY DO NOT MATCH. An account row's `provider` is
 * `anthropic`; `runners.status()` keys the SAME provider as `claude`. Reading
 * `runners.anthropic` therefore returns undefined forever, which reports
 * `installed: null` for the primary provider and makes the "not installed yet"
 * sentence unreachable -- so an agent helping somebody install Claude Code is
 * told there is no sign-in instead. Mapped here, once, and asserted against a
 * real `runners.status()` in the test rather than against a fixture that
 * encodes what its author believed the shape to be.
 */
const RUNNER_KEY = { anthropic: 'claude', openai: 'openai' };

/**
 * 🔑 THE WORDS THAT ARE ON THE SCREEN, not words this module coined. The board
 * labels the two providers `Claude` and `GPT` (web/index.html), and this whole
 * feature exists so an agent and a screen describe the same thing the same way.
 * A third vocabulary here works directly against that: an agent saying "Claude
 * Code" at somebody looking at a row marked "Claude" is the two-accounts-of-what-
 * to-do failure the card names.
 */
const PROVIDER_LABEL = { anthropic: 'Claude', openai: 'GPT' };

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
 * 🛑 AN UNREADABLE ROW IS NOT A FAILING ROW. Counting only CONNECTED put every
 * `unknown` row in the denominator as NOT working, so two accounts of which one
 * was merely unreadable rendered as "1 of 2 sign-ins working" -- a settled
 * negative about a row nobody could read, which is the exact collapse the
 * three-state rule and the null count elsewhere in this module refuse.
 * Unreadable rows leave the comparison entirely: they are neither working nor
 * known-broken, and pretending otherwise is the thing this card is about.
 */
function workingCount(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r && r.connection && r.connection.state === subscription.STATE.CONNECTED).length;
}

/* 🛑 AN ALLOWLIST, LIKE EVERY OTHER CLASSIFIER IN THIS FILE. This was a DENYLIST
   (`state !== UNKNOWN`), which made it disagree with `stateOf` twelve lines up about
   the same row: `stateOf` treats an unrecognised state as `sawUnknown`, and this
   counted it as READABLE. One file, one row, opposite answers.
   ⚠️ The disagreement is invisible while `stateOf` returns UNKNOWN, because that nulls
   the counts. Mix one CONNECTED row with one malformed row and it surfaces: the
   malformed row lands in the denominator as known-broken, which is exactly the
   rendering the comment below and the CLI test "a row we could not read is not counted
   against the person" both promise cannot happen.
   📌 Not reachable today: `subscription.js` emits only these three values, and both
   account readers set UNKNOWN in their catch arms. It is the shape that goes live the
   day a fourth state is added upstream, which is precisely when nobody is looking at
   this function. */
function readableCount(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r && r.connection
    && (r.connection.state === subscription.STATE.CONNECTED
      || r.connection.state === subscription.STATE.NONE)).length;
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
    /* ⚠️ NULL, NOT 0, WHEN WE COULD NOT LOOK. A count printed beside
       `unknown` reads as a settled "you have none", which is the exact
       collapse the three-state rule exists to prevent. */
    howMany: state === subscription.STATE.UNKNOWN ? null : countOf(rows),
    /* 🛑 TWO NUMBERS, BECAUSE ONE OF THEM WAS BEING READ AS THE OTHER. `howMany`
       counts ROWS on this computer; it was rendered as "3 sign-ins" directly
       after "this computer has a working sign-in for it", so somebody with three
       accounts of which ONE works was told they had three working. That is the
       over-confident direction this card exists to avoid. */
    howManyWorking: state === subscription.STATE.UNKNOWN ? null : workingCount(rows),
    /* The denominator for "N of M working". Rows we could not read are excluded
       from BOTH halves rather than counted against the person. */
    howManyReadable: state === subscription.STATE.UNKNOWN ? null : readableCount(rows),
    because: saysFor(state, present),
  };
}

/**
 * The doors already answer verdict-only and three-state (`connected` true,
 * false or null), so they are composed rather than rebuilt. Their `who` is a
 * login and is dropped here; that field is for the operator's own screen.
 */
function serviceView(doors, allowed) {
  const out = [];
  if (!doors || typeof doors !== 'object') return out;
  /**
   * 🛑 THE NAME IS RESOLVED, NOT DERIVED FROM THE KEY. Stripping `/api/` off the
   * input key put the caller's string straight into the output, which breaks
   * this module's one rule and is invisible to a leak test that plants into
   * door VALUES only. Keys are ours today; the rule is that nothing from the
   * input travels, and a key is input.
   * ⚠️ It also fixes a second thing: `tokendoors.routes()` returns
   * `/api/svc/<slug>`, so the old strip printed `svc/discord` to a person.
   */
  const names = allowed && typeof allowed === 'object' ? allowed : {};
  /* Sorted by the name a person READS, not by the route key. Key order looks
     alphabetical and is not: `/api/cloudflare` and `/api/github` sort before
     `/api/svc/*` while `/api/vercel` sorts after, so the screen read
     Cloudflare, GitHub, Airtable, ... Vercel. */
  /* Own-property here too. The gate below already refuses inherited keys, so
     this is unreachable today -- but the two lookups reading the same map by
     different rules is how they stop agreeing. */
  const nameOf = (k) => (Object.prototype.hasOwnProperty.call(names, k) ? names[k] : k);
  const byName = (a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)));
  for (const route of Object.keys(doors).sort(byName)) {
    /* ⚠️ OWN PROPERTY, NOT A PLAIN LOOKUP. `names['constructor']` walks the
       prototype chain and answers a Function, which is truthy, so a door named
       after anything on Object.prototype sailed through the gate whose entire
       job is refusing input. Measured: two rows came back, each with a Function
       for a name, which JSON.stringify drops -- so the CLI printed
       `undefined: connected` at a person. */
    if (!Object.prototype.hasOwnProperty.call(names, route)) continue;
    const name = names[route];
    if (!name || typeof name !== 'string') continue;
    const d = doors[route] || {};
    const connected = d.connected === true ? true : (d.connected === false ? false : null);
    out.push({
      name,
      connected,
      because: connected === true ? SAYS.SERVICE_ON
        : (connected === false ? SAYS.SERVICE_OFF : SAYS.SERVICE_UNSURE),
    });
  }
  return out;
}

/**
 * 🛑 CLAUDE ONLY, AND IT SAYS SO ON THE WIRE. `connect.state()` is the Claude
 * download-and-sign-in flow (`engine/connect.js`'s own header); OpenAI is a
 * pasted key and never enters it. Reported unqualified beside a two-provider
 * array, an agent helping somebody paste an OpenAI key reads `phase: idle` and
 * honestly reports "no sign-in is going on" WHILE THE PERSON IS MID-FLOW --
 * which is the two-accounts-of-what-to-do failure this card exists to prevent,
 * arriving through a field name rather than a sentence.
 */
/**
 * 🛑 `anyConnected` IS A CORRECTNESS INPUT, NOT A RENDERING HINT.
 * `connect.state()` can return a PERSISTED `stuck`/`interrupted` written by a
 * previous board process: once `startedOnce` is false, which is the state at
 * every board boot, there is no freshness gate on the disk fallback. So this
 * module can be handed a terminal sign-in phase for a provider that is, right
 * now, connected. Reported side by side those two are a contradiction about one
 * computer, and the person is the one who has to reconcile it.
 *
 * ⚠️ THAT SUPPRESSION USED TO LIVE ONLY IN THE CLI RENDERER, WHICH MADE THE
 * SHIPPED PATH CORRECT AND THE DESIGN WRONG. This plan's whole shape is that the
 * module constructs the safe view and callers render it; a correctness property
 * held in one renderer is inherited by no other consumer. An agent curling the
 * route directly, or a future board panel, got the contradiction with nothing to
 * warn it, and would each have had to re-derive the same rule.
 *
 * ⇒ It is decided here now. A stale terminal phase beside a live connection is
 * reported as `unknown`, not as `stuck`: we genuinely cannot tell whether that
 * record still describes anything, and `unknown` is this module's word for
 * exactly that. Collapsing it to `idle` would be the confident-negative failure
 * this card exists to refuse, one field over.
 *
 * 📌 The CLI keeps its own `!anyConnected` check, and it is NOT dead code: the
 * CLI talks to a board over HTTP and that board may be an older build than the
 * CLI. Belt and braces across a version boundary.
 */
/* The phases that describe a sign-in that STOPPED. Derived rather than
   hand-listed: anything in the enum that is neither in flight nor one of the two
   resting states is a stopped one, so a new terminal phase upstream is covered
   here without an edit.
   ⚠️ `PHASES` IS EXACTLY `connect.PHASE` AND DOES NOT CONTAIN `unknown`. An
   earlier version of this comment claimed it did, and excluded `'unknown'` below
   on that basis: a no-op that read as load-bearing. `unknown` is this module's
   own word, produced by signinView when the phase is unrecognised, so it can
   never appear in the enum being filtered here. Measured: PHASES.includes(
   'unknown') === false, which is also why the leak test has to add the literal
   alongside `...verdict.PHASES` in its allowlist. */
const TERMINAL_PHASES = PHASES.filter((p) => !BUSY_PHASES.includes(p) && !['idle', 'connected'].includes(p));

function signinView(st, anyConnected) {
  const raw = st && typeof st.phase === 'string' ? st.phase : null;
  let phase = PHASES.includes(raw) ? raw : 'unknown';
  if (anyConnected === true && TERMINAL_PHASES.includes(phase)) phase = 'unknown';
  return { provider: 'anthropic', phase, busy: BUSY_PHASES.includes(phase) };
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
  const providers = [
    providerView('anthropic', PROVIDER_LABEL.anthropic, byProvider('anthropic'), runners[RUNNER_KEY.anthropic], blind.anthropic === true),
    providerView('openai', PROVIDER_LABEL.openai, byProvider('openai'), runners[RUNNER_KEY.openai], blind.openai === true),
  ];
  return {
    providers,
    /* The providers are built first ON PURPOSE: whether anything is connected is
       an input to how a stale sign-in record is read. See signinView. */
    /* 🛑 THE ANTHROPIC ROW SPECIFICALLY, NEVER `.some(...)`. The sign-in flow is
       CLAUDE ONLY (see signinView's header): `connect.state()` never describes a
       pasted OpenAI key. Asking "is ANYTHING connected?" means a machine with GPT
       connected and Claude genuinely stuck RIGHT NOW has its true `stuck` rewritten
       to `unknown` before any consumer can see it.
       ⚠️ install/kosmos ALREADY FIXED EXACTLY THIS at its own layer, in those words.
       An earlier version of this line used `.some(...)` and reintroduced it HERE,
       where the CLI's correctly-scoped check cannot recover it: the server rewrites
       the phase first, so the renderer never sees the truth to protect. Moving a
       rule inward is only safe if its SCOPE moves with it. */
    signin: signinView(src.connect, byProvider('anthropic').some((a) => a && a.connection && a.connection.state === subscription.STATE.CONNECTED)),
    services: serviceView(src.doors, src.doorNames),
  };
}

module.exports = { forAgent, SAYS, PHASES, BUSY_PHASES, RUNNER_KEY, PROVIDER_LABEL };
