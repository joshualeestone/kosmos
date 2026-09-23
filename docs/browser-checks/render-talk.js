'use strict';
/* The agent page's own thread: the question, the option buttons, the composer,
 * and every state the drawing names, in both themes.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-talk.js
 *      (HEADED=0 on a machine with no console session)
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT EXERCISE. Unlike its siblings here, it does
 * NOT spawn server.js: it loads the page over file:// and answers the poll from
 * fixtures, because the states worth looking at (an agent that cannot be
 * reached, a menu we refused to parse, a store that cannot be written) need a
 * machine state a sandboxed server has no way to be in. So it checks the PAINT
 * and not the route. The route is covered by the suite; the paint is what
 * `node --test` cannot see.
 *
 * It measures IN THE PAGE rather than judging from the picture: scrollWidth vs
 * clientWidth for overflow, computed backgrounds for the transparent-panel
 * class, and elementFromPoint for what is actually on top.
 *
 * ⚠️ THE SCREENSHOTS ONLY REPRODUCE IN THE MODE THEY WERE MADE IN, and the
 * failure looks exactly like a visual regression. Measured 2026-08-20 against
 * the 26 committed under docs/screenshots:
 *
 *   headed    26 of 26 byte-identical
 *   headless  26 of 26 differ
 *
 * Both runs report `problems: none`, because the ASSERTIONS pass either way --
 * they measure in the page, which is mode-independent. The pixels are not:
 * headless is SwiftShader software rendering and headed is the Metal
 * compositor. So regenerating these with HEADED=0 produces a 26-file diff
 * that reads as "something changed on screen" and means "I rendered on a
 * different GPU". Regenerate HEADED, or expect to throw the diff away.
 *
 * ⚠️ TWO THINGS IT LEARNED THE HARD WAY, both of which look like success:
 *   - Its first run screenshotted the FIRST-RUN OVERLAY with all eight states
 *     laid out correctly underneath it, every measurement green. A clip
 *     rectangle does not know what is painted over it.
 *   - Dismissing that overlay is not enough: the app sets `inert` on every body
 *     child while it is up. With inert left on, every elementFromPoint answers
 *     BODY and a Playwright click times out, on a page that screenshots
 *     perfectly. A picture cannot show you that nothing on it can be clicked.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

/**
 * A REAL agent card, from the real producer.
 *
 * ⚠️ NOT HAND-BUILT. `openDetail` reads fields this script has no business
 * knowing about (it wanted `context.percent` first), and a literal invented
 * here is exactly the fixture that made six rounds of review pass against a
 * world that does not exist. This asks `status.snapshot()` for a card off this
 * machine and renames it, so the shape is whatever the board really serves.
 */
function liveCard() {
  /* 🛑 AN ERROR IS NOT AN EMPTY BOARD, and collapsing them turned a loud red into a
     quiet green. The first version of this returned null for BOTH, so on a POPULATED
     box where status.js failed to load or snapshot() threw, the fallback quietly took
     over, printed a note saying "no live agent on this box" -- a claim nothing had
     measured -- and the cut passed. Before this branch that case FAILED 3b, correctly.
     So: a thrown error is re-thrown for the caller to turn into a failure, and `null`
     means no PANE card of ours was selectable.
     🛑 NOT "the board really has no card of ours", which is what this line said and which
     the same comment block contradicts twenty lines down. Null also arrives when every
     card of ours is PANELESS, and it would arrive if `isNamedOurs` itself regressed to
     false for all of them. In both of those the recording drives the arm on a POPULATED
     box, where the old code drove it with a live card. That is visible (source `golden`,
     the fallback NOTE prints) but it is not "no card of ours exists". */
  const status = require(path.join(__dirname, '..', '..', 'engine', 'status.js'));
  const board = status.snapshot();
  /* 🛑 A PANE CARD, matching what the fixture records. status.js emits PANELESS cards
     too and they also carry `isNamedOurs: true`, but their shape legitimately differs:
     a smaller `context`, and null session/target/runner/model.
     ⚠️ THE REASON IS SHAPE, NOT THE DRIFT GUARD. An earlier version of this comment
     justified the preference by "it made the drift guard report board COMPOSITION as
     drift" -- and this same change DELETES that guard, so the stated reason went stale
     in its own commit. The preference still earns its place: `openDetail` is driven with
     this card and the recording is pane-shaped, so a paneless card would exercise the
     reopen path with null session/target that the fallback never produces.
     ⚠️ THIS IS A BEHAVIOUR CHANGE ON A POPULATED BOX and it is deliberate. The old code
     was a bare find over `isNamedOurs`, taking whichever card status.js listed first.
     🛑 IT NARROWS THE ORDERING DEPENDENCE, IT DOES NOT REMOVE IT, and an earlier version
     of this sentence said "it now depends on shape" full stop. `find` still takes the
     FIRST pane card the board lists, so on a board with several pane cards the input is
     still pane-ordered; what changed is that a paneless card can no longer win. The
     capture tool has an evidence preference for exactly this reason (`chooseCard` prefers
     a card whose stateConfidence is not 'none'); `liveCard` has none, and adding one here
     would be a second, differently-ordered selection over the same board. Left as is and
     stated, rather than half-fixed.
     ⚠️ AND THE EDGE CASE THAT FOLLOWS FROM IT: on a board where EVERY card of ours is
     paneless (agents configured, none running in a pane), this returns null and the
     RECORDING drives the arm, where the old code drove it with a paneless card. That is
     the better of the two -- openDetail gets the shape it is written for instead of null
     session/target -- and it is not silent: realCard reports `golden` and the run prints
     the fallback NOTE, so the log distinguishes it from a live run. */
  const ourCards = (board.agents || []).filter((a) => a && a.isNamedOurs === true);
  const card = ourCards.find((a) => a.paneless !== true) || null;
  return card ? { ...card, sessionName: 'april', name: 'April', state: 'needs_you' } : null;
}

/**
 * #2519: the same card, RECORDED from the real producer, for a box with no agents.
 *
 * 🛑 THIS IS A CAPTURE, NOT A LITERAL, AND THE DIFFERENCE IS THE WHOLE POINT.
 * `fixtures/agent-card.json` was produced by `tools/capture-agent-card.js` on a machine
 * with live agents. Every KEY is the producer's and each field's TYPE is preserved.
 * ⚠️ NOT "only identifying string content is neutralised". That sentence was wrong here,
 * and it is the THIRD copy of it: the same claim was corrected in the capture tool, then
 * in the plan, then in the README, and missed here each time.
 *
 * THE FULL PIN SET, WHICH AN ARM CHECKS AGAINST THE CODE. PIN-LIST-BEGIN
 * `because`, `context.because`, `context.ceiling`, `context.ceilingAssumed`, `context.confidence`, `context.notYet`, `context.overCeiling`, `context.percent`, `context.tokens`, `disruption.cause`, `disruption.startedAt`, `disruption.timedOut`, `avatarVer`, `hasAvatar`, `model`, `modelName`, `name`, `role`, `session`, `sessionName`, `stateConflict`, `stateEvidence`, `stateProject`, `target`, `task`
 * PIN-LIST-END
 * (Paths, not names: `because` is pinned BOTH top-level and under `context`, and a list
 * of bare names could not say so.)
 * Separately RE-PINNED from the raw card because status.js enum-bounds them: `state`,
 * `stateConfidence`, `runner`.
 *
 * 🛑 THE PINS DO NOT MAKE A RE-CAPTURE BYTE-IDENTICAL, and the sentence claiming they do
 * stood here after the same sentence had been struck in the tool's own header. A file
 * asserting a thing and its negation is worse than either answer, which is the rule this
 * very header states twenty lines down. `state`, `stateConfidence` and `runner` come from
 * the RAW card, the structural booleans pass through as captured, and role, task,
 * stateEvidence, stateProject, stateConflict and disruption each vary between null and a
 * value. The recording holds `state: "working"`, a fact about one capture. What the pins
 * buy is that the volatile MEASUREMENTS do not move.
 *
 * ⚠️ "AND TWO PROFILE TIMESTAMPS" WAS WRONG TWICE OVER and sat in three copies. No pin
 * touches a profile timestamp. What exists is `scrubStrings`' date branch, which rewrites
 * ANY string matching an ISO date, at any depth, anywhere in the card, to one constant.
 * That is a SCRUB, not a pin, and it is neither two fields nor profile-specific.
 *
 * It scrubs EVERY value under `profile` (strings and numbers and booleans, at any depth)
 * rather than a listed subset, because `profile` is free-form and an allowlist there
 * rests on what the tree happens to write today: `profile.doctrineVersion` is a producer
 * number that reached the recording before this was structural.
 * ⚠️ AN EARLIER VERSION OF THAT SENTENCE ENDED "not the two ids", left dangling by an
 * edit, which read as though `id` and `idInstall` were EXEMPT from the scrub. They are
 * scrubbed to constants like everything else, and an arm exists to prove it.
 *
 * ⚠️ THAT PIN LIST HAS GONE STALE TWICE, in all four copies at once each time. If you add
 * a pin, grep for one of these field names before you finish; an arm now reds if a
 * document omits one.
 *
 * ⚠️ A capture rots, and ONE guard notices, not two. The TOP-LEVEL key set is compared
 * box-independently in `yarn test` (render-talk-goldencard-2519.test.js), using
 * test-support/fleet.js, which drives the real `status.snapshot()` over a fake pane
 * source.
 * 🛑 NESTED CONTEXT DRIFT IS NOW CHECKED TOO (#2553), box-independently and in `yarn test`,
 * NOT here in the cut. An earlier version of this header claimed a second guard "HERE, in
 * the reopen arm below", comparing the full nested shape live against live. That guard was
 * REMOVED nine hundred lines below (see the block at the reopen arm) because it fired on
 * board composition rather than drift: measured on an 18-agent board, two distinct
 * `profile` shapes among our pane cards, one of them empty.
 * ⇒ THE GAP IT LEFT: a rename inside `context` leaves the top-level key set identical,
 * the top-level anti-rot arm green, and this recording driving a shape the producer no
 * longer emits, on exactly the quiet boxes the fallback exists for. `openDetail` reads
 * `context.percent` (through the guarded `pctOf`), so that is not hypothetical.
 * ⇒ HOW #2553 CLOSES IT WITHOUT RE-ADDING THE REMOVED BUG: the COMPOSITION-AWARE DRIFT
 * GUARD arm in render-talk-goldencard-2519.test.js derives the SET of context key-sets
 * `status.js` can emit and asserts the recording matches one of them. It reads no board,
 * so composition cannot fire it; only a producer change that was not re-captured reds. It
 * lives in the unit test, not this check, so a false red costs a test run and never a cut.
 * `profile` is deliberately NOT guarded that way: it is free-form and every page read of it
 * is guarded, so a missing profile key is composition, never drift. */
function goldenCard(fixturePath) {
  /* `fixturePath` is a test seam, defaulted to the real fixture. Without it the shape
     floor below is unreachable from a test: with the committed fixture in place the
     floor never fires, so deleting it reds nothing and it would ship unarmed. That is
     the defect this tree keeps finding in its own guards. */
  try {
    const raw = fs.readFileSync(fixturePath || path.join(__dirname, 'fixtures', 'agent-card.json'), 'utf8');
    const card = JSON.parse(raw);
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      /* 🛑 SAY WHY HERE TOO. This branch returned SILENTLY, one line above the floor whose
         own comment says a cause that explains nothing is worse than a delete. Valid JSON
         that is an array, a number, a string or null is a FOURTH cause, outside the three
         the catch block enumerates, and it produced no diagnostic at all. */
      process.stdout.write('  NOTE  render-talk: the recorded card fixture parsed but is '
        + (Array.isArray(card) ? 'an array' : card === null ? 'null' : 'a ' + typeof card)
        + ', which is not a card object, so it is being ignored'
        + ' -- with no live agent card this FAILS the reopen arm below\n');
      return null;
    }
    /* 🛑 A SHAPE FLOOR, HERE AND NOT ONLY IN THE NODE SUITE. "An object that is not an
       array" accepts `{}`: openDetail would still run, the reopen arm would still pass,
       and the box the fallback exists for would get a hollow coverage claim. Anyone
       invoking tools/browser-checks.sh directly never reaches the node suite's floor,
       so it has to be enforced where the card is produced. A real card carries ~30
       fields; a trimmed one is the hand-built literal arriving by another door. */
    /* ⚠️ THE RENAME BELOW LEAVES THE CARD INTERNALLY INCONSISTENT, and it is inherited
       rather than introduced here: the reopen arm drives `{...card, state: 'needs_you'}`
       while `because` and `stateEvidence` still carry the CAPTURED card's own values,
       which describe whatever state that card was in, not needs_you. (Those exact strings
       are volatile -- the golden fixture is re-captured from a live card by
       tools/capture-agent-card.js, so quoting them here would go stale on the next capture;
       #2808 did exactly that.) The live path has always done the same to a live card, so
       this is main's behaviour, not a regression from the fallback.
       ⇒ Named rather than fixed, deliberately. This branch argued at length that a
       fixture contradicting itself is worse than a stale one and made `context` coherent
       on that basis, so leaving this unnamed would be the same overstatement the branch
       keeps correcting. Fixing it means changing what the arm feeds `openDetail` in a
       check that CANNOT be run from here, which trades an unverifiable rendering change
       for a consistency the arm does not read. */
    if (Object.keys(card).length < 20) {
      /* 🛑 SAY WHY HERE TOO. The catch below explains a missing, corrupt or unreadable
         fixture, and this branch used to be the one cause that explained nothing: a
         readable, valid-JSON, TRIMMED fixture returned null silently, so downstream it
         was indistinguishable from a delete while being harder to diagnose than one.
         An operator on a quiet box saw only "no agent card and no usable fixture". */
      process.stdout.write('  NOTE  render-talk: the recorded card fixture has only '
        + Object.keys(card).length + ' top-level fields, below the floor of 20, so it is'
        + ' being ignored as a trimmed or hand-built stand-in'
        + ' -- with no live agent card this FAILS the reopen arm below\n');
      return null;
    }
    return { ...card, sessionName: 'april', name: 'April', state: 'needs_you' };
  } catch (err) {
    /* Say WHY on the log the cut streams. A corrupt fixture, a missing one and an
       unreadable one all surface downstream as the same "no usable fixture" line, so an
       operator on a quiet box cannot tell rot from a delete without opening the file. */
    /* Say the CONSEQUENCE too. This returns null, and on the only path that reaches
       here at runtime (no live pane card of ours) that makes realCard report `none`,
       which pushes a problem and FAILS the arm. A bare NOTE reads as benign for
       something that is about to red the cut. */
    /* ⚠️ err.message ONLY, NEVER String(err). A native Error's toString() prepends the
       literal word "Error: ", and the release gate's reason grep matches `Error`
       UNANCHORED anywhere in a line (tools/browser-checks.sh:730), so the fallback would
       have turned this NOTE into a quotable failure reason. Unreachable today, since
       readFileSync and JSON.parse both carry a non-empty message, but the whole point of
       the NOTE channel is that it cannot be read as a failure, and a residual that
       depends on every future thrower having a message is not that guarantee. */
    /* 🛑 THE INTERPOLATED HALF HAS TO BE NEUTRALISED, NOT JUST THE LITERALS. The release
       gate quotes any output line matching Error|Timeout|REFUS|refus, UNANCHORED
       (tools/browser-checks.sh:730), and a thrown message is not ours to choose: Node
       embeds the PATH in it, so `readFileSync` on a path containing any of those words
       puts the word straight into this NOTE. Measured: reading '/tmp/x-Timeout-y.json'
       yields "ENOENT: no such file or directory, open '/tmp/x-Timeout-y.json'".
       ⇒ A hyphen is inserted into each trigger word. The diagnostic stays readable and
       the line cannot be quoted as the cause of a red. Note `refus` matches as a
       SUBSTRING, so "refused" triggers it too and a bracketing scheme would not help.
       ⚠️ RESIDUAL, NAMED RATHER THAN LEFT OFF THIS LIST: the four WORDS are covered, the
       gate's other alternative `^\s*(FAIL|✖)` is not. A thrown message containing a
       newline followed by FAIL would still be quotable. Not reachable with today's
       throwers (readFileSync and JSON.parse messages are single-line) and the runtime arm
       drives only single-line messages, so this is stated, not fixed. */
    const neutralise = (t) => String(t)
      .replace(/Error/g, 'Err-or').replace(/Timeout/g, 'Time-out')
      .replace(/REFUS/g, 'REF-US').replace(/refus/g, 'ref-us');
    const why = neutralise((err && typeof err.message === 'string' && err.message) || 'no message on the thrown value');
    process.stdout.write('  NOTE  render-talk: the recorded card fixture could not be read: '
      + why
      + ' -- with no live agent card this FAILS the reopen arm below\n');
    return null;
  }
}

/**
 * The card the reopen arm drives, and WHERE IT CAME FROM.
 *
 * Returns `{ card, source }` rather than a bare card, deliberately: the caller has
 * to be able to say which it used. A silent fallback would make a quiet box and a
 * populated box print identical output while exercising different inputs, and this
 * file has corrected that class three times already.
 */
function realCard() {
  let live;
  try {
    live = liveCard();
  } catch (err) {
    /* The producer itself is broken. That is a real failure on any box and must not be
       masked by the fallback: report it as its own source so the caller fails rather
       than quietly substituting a recording. */
    return { card: null, source: 'error', error: String((err && err.message) || err) };
  }
  if (live) return { card: live, source: 'live' };
  const golden = goldenCard();
  if (golden) return { card: golden, source: 'golden' };
  return { card: null, source: 'none' };
}

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'talk-shots-'));

/**
 * ⚠️ IT CARRIES A NEEDS-YOU MARKER, and the version without one described a
 * payload the route cannot serve.
 *
 * `questionIn` returns null unless some LINE matches `NEEDS_YOU_MARKERS`, and
 * it slices from six lines above the last match through to the end -- so every
 * real `question.text` contains a marker line by construction. The first
 * version of this fixture ended "Which is right?", which matches none of the
 * five (the `❯ 1.` marker wants the literal `Yes`), so the server could never
 * produce `{asking: true, question: <this>}` at all. Ten of the twenty-two
 * committed screenshots were drawn from it.
 *
 * That is the same class this file corrected twice already -- the `6-off`
 * no-Claude pairing and the borrowed menu -- caught the third time only
 * because a reviewer traced the PRODUCER rather than reading the fixture. The
 * check below now asserts it for every state, so the class is closed rather
 * than the instance.
 */
const QUESTION = {
  text: [
    '│ Two of the help docs disagree about the trial. One says 14 days, the',
    '│ other says 30. Would you like to go with one of them?',
    '│',
    '│ ❯ 1. 14 days',
    '│   2. 30 days',
  ].join('\n'),
};

/**
 * ⚠️ EXACTLY THE ROUTE'S OWN PAYLOAD, field for field. The first version also
 * carried `agent`, `viewport` and `agentsUnreadable` — three fields the route
 * deliberately does NOT serve, and whose absence `server.projects.test.js`
 * pins. A fixture that invents fields the producer does not make is how six
 * rounds of review passed against a world that does not exist (see the note at
 * `safeRoster`), and nothing lints this file: `fixture-discipline.test.js`
 * only reads `*.test.js`.
 */
const base = {
  messages: [],
  olderCount: 0,
  historyBecause: null,
  historyUnfilable: false,
  presence: 'on',
  presenceBecause: null,
  asking: false,
  question: null,
  questionBecause: null,
  options: null,
};

const placed = (text, wire) => ({
  at: new Date(Date.now() - 4 * 60000).toISOString(),
  text, wire: wire || null,
  delivery: { state: 'placed', because: null, paneState: 'working', paneNote: 'it was mid-task' },
});

/* A question wider than the box, the shape of Claude Code's own permission
   prompt with a real path in it. The box is `white-space: pre`, cut at the
   right edge, and two assertions below (a cut line stays reachable; a poll
   does not drag a reader back to the start of it) can only fire on a fixture
   that overflows. The 70-column QUESTION above stopped overflowing the day the
   page went full-width (#413), and both went UNCHECKED on every run. */
const WIDE_QUESTION = {
  text: [
    '│ Edit /Users/josh/Documents/Projects/kosmos-launch/help-centre/articles/getting-started/import-from-csv-and-spreadsheets.md?',
    '│ The previous version is kept alongside it.',
    '│',
    '│ ❯ 1. Yes',
    '│   2. Yes, and do not ask again for this file',
    '│   3. No',
  ].join('\n'),
};

/**
 * #3419: the live `needs_you` question rendered AS A THREAD MESSAGE, mirroring
 * what `engine/chat.js`'s `withQuestionRow` (ICK's #3455 engine seam) appends to
 * the served `messages`. The menu is gone: the question is now an agent-authored
 * bubble in `#d-dmthread`, answered in the composer, and `#d-qask` shows ONLY for
 * the #2129 folder-trust recovery (which carries `answerNote`; none of these
 * fixtures do, so `#d-qask` stays hidden for every state here).
 *
 * The shape is copied field-for-field from `withQuestionRow`: a STABLE per-agent
 * id, no `at` (a standing question is a state, not a dated event), `from` the
 * agent, `delivery: null`, `kind: 'question'`, and `reported`. `unreachableStates`
 * below asks the producer that the `text` is one `questionIn` can actually derive.
 */
const questionRow = (agent, q, reported) => ({
  id: 'needs-you-question:' + agent,
  at: null,
  text: q.text,
  from: agent,
  delivery: null,
  kind: 'question',
  reported: Boolean(reported),
});

const STATES = {
  '1-question': { ...base, messages: [questionRow('april', QUESTION)] },
  '1w-question-wide': { ...base, messages: [questionRow('april', WIDE_QUESTION)] },
  '2-answered-placed': { ...base, messages: [placed('14 days', '1')] },
  '3-unconfirmed': {
    ...base,
    messages: [{
      at: new Date().toISOString(), text: '14 days', wire: '1',
      delivery: { state: 'unconfirmed', because: 'we typed it and could not tell whether it arrived', paneNote: null },
    }],
  },
  /* ⚠️ A FAILED SEND, kept for the per-row receipt-vs-verdict check: "sent as 1"
     must never sit beside "Could not deliver". The `wire: '1'` is load-bearing --
     it is the only fixture pairing a recorded wire with a delivery that never
     reached the pane, so `sawFailedWire` below is asserted against something. */
  '4-failed': {
    ...base,
    messages: [{
      at: new Date().toISOString(), text: '14 days', wire: '1',
      delivery: { state: 'could_not', because: 'it stopped responding while we were sending', paneNote: null },
    }],
  },
  /* ⚠️ THE COPY-MODE ARM, and the other one is a world the producers cannot
     make. `addressable` picks its sentence on `card.isAgentSession`: false
     gives "there is no Claude running in its window", and `classify` returns
     STOPPED for exactly that pane BEFORE it ever reaches the needs-you check.
     So a live question beside that sentence cannot happen. Copy-mode is the arm
     that IS reachable while an agent is asking: Claude is running, the pane is
     scrolled back, and the question is on the screen we captured -- so the
     question row rides a presence:'off' payload here. */
  '6-off': {
    ...base,
    messages: [placed('are you there'), questionRow('april', QUESTION)],
    presence: 'off',
    presenceBecause: 'its window is scrolled back right now, so anything we typed would go to the scrollback instead of to the agent',
  },
  /* ⚠️ DRAWN ON PURPOSE FOR A STATE TODAY'S PRODUCERS ALMOST CANNOT SERVE, and
     recorded rather than quietly kept, which is the route's own posture for the
     same arm: a roster read that fails also fails `nameRefusal`, which fails
     closed at the 404, so `unsure` survives only in the race between that gate's
     `paneRoster()` and the later `safeRoster()`. Nothing here CONTRADICTS
     anything -- the composer stays open and says we could not check -- so the
     picture is honest about a state the product can be in, however rarely. */
  '7-unsure': { ...base, presence: 'unsure', presenceBecause: 'we could not check which agents are running, so we did not type anything anywhere', messages: [placed('are you there')] },
  '9-unfilable': { ...base, historyUnfilable: true, historyBecause: 'we cannot keep a conversation under this agent’s name' },
  '10-history-unreadable': { ...base, historyBecause: 'we cannot read what you have sent this agent' },
  /* ⚠️ A LONG UNBROKEN URL IN A BUBBLE, which is the arm that overflows the
     thread horizontally. It used to hang off the "long labels" menu fixture;
     the menu is gone, but a pasted path is still the ordinary way a row runs
     wider than the panel, so the message survives on its own. */
  '8-long-url': {
    ...base,
    messages: [placed('https://example.com/a/very/long/unbroken/path/that/people/actually/paste/into/agents/all-the-time')],
  },
};

/**
 * ⚠️ EVERY FIXTURE MUST BE A WORLD THE PRODUCERS CAN MAKE, asserted against
 * the producer itself rather than against a story about it.
 *
 * Three separate fixtures on this branch described states the server cannot
 * serve: `asking` beside "there is no Claude running" (twice), and a question
 * carrying no needs-you marker (ten screenshots). Each was plausible, which is
 * exactly why READING them did not catch it -- all three were found by tracing
 * the producer. A screenshot of an unreachable state is worse than no
 * screenshot, because it is the artifact somebody checks the design against
 * later.
 *
 * It asks the PRODUCER ITSELF -- `questionIn` -- rather
 * than restating their rules here, so it cannot drift from them at all.
 *
 * ⚠️ This paragraph used to recommend asking `status.NEEDS_YOU_MARKERS`, which
 * is what the FIRST version of this function did and what the comment 30 lines
 * below now describes as the weaker thing that shipped with its own
 * counter-example. The body was rewritten and its own header was left
 * recommending the design it had just abandoned.
 */
function unreachableStates() {
  let chat;
  try {
    chat = require(path.join(__dirname, '..', '..', 'engine', 'chat.js'));
  } catch (err) {
    return ['could not load engine/chat.js (' + err.message + '), so fixture reachability is UNCHECKED'];
  }
  if (typeof chat.questionIn !== 'function') {
    return ['engine/chat.js exports no questionIn, so fixture reachability is UNCHECKED'];
  }
  /* CONTROL: the producer really does refuse something, so a run of PASSes is
     this function agreeing with the engine rather than the engine agreeing with
     everything. */
  if (chat.questionIn('nothing here is a question') !== null) {
    return ['CONTROL FAILED: questionIn accepted a marker-less string, so it cannot be refusing anything'];
  }
  const bad = [];
  for (const [name, fx] of Object.entries(STATES)) {
    /* #3419: the question is now an injected message ROW (chat.withQuestionRow),
       not the `asking`/`question` banner. Its `text` is exactly `questionIn`'s
       output, so validate the ROW's text against the producer. */
    const qrow = (fx.messages || []).find((m) => m && m.kind === 'question');
    if (!qrow || typeof qrow.text !== 'string') continue;
    /* ⚠️ THE PRODUCER ITSELF, ASKED FOR THIS EXACT PAYLOAD, and the first
       version of this check asked something weaker: whether a marker exists
       ANYWHERE in the text. The constraint is not existence, it is POSITION.
       `questionIn` slices from six lines above the LAST marker through to the
       end, so a row whose last marker sits deep in the text describes a payload
       the route would have truncated. Comparing questionIn's output to the row
       cannot make that mistake, because it is not a restatement of the rule, it
       IS the rule -- and it is the SAME `question` withQuestionRow copies into
       the row, so a reachable row is proven reachable. */
    const served = chat.questionIn(qrow.text);
    if (served === null) {
      bad.push(name + ': the injected question row carries text `questionIn` returns null for, so the '
        + 'route could never derive it (no line matches NEEDS_YOU_MARKERS)');
    } else if (served.text !== qrow.text) {
      const kept = served.text.split('\n').length;
      const had = qrow.text.split('\n').length;
      bad.push(name + ': the route would derive ' + kept + ' of these ' + had + ' lines. `questionIn` slices '
        + 'from six lines above the LAST marker, so this row is not one the producers can make');
    }
  }
  return bad;
}

(async () => {
  /* ⚠️ HEADED by default, like render-thread and render-projects. Headless
     renders through SwiftShader rather than the real compositor, and this
     script's whole output is the class of evidence that weakens under it:
     contrast ratios, computed backgrounds, scrollWidth overflow and
     elementFromPoint. `HEADED=0` for a machine with no console session. */
  /* ⚠️ `--hide-scrollbars` IS REMOVED, and it is the whole reason this check
     could not see a scrollbar headless. Playwright passes that flag by default
     in headless mode, which suppresses scrollbars whatever the CSS says. Two
     wrong conclusions were drawn before the flag was found: "headless does not
     honour ::-webkit-scrollbar" (mine) and "Playwright's bundled Chromium
     differs from system Chrome" (Mona Lisa's, from a command-line Chrome that
     honoured it in both headless modes). Measured across four launches: the
     bundled Chromium AND system Chrome both honour the rule headless once the
     flag is gone, and layout moves by exactly the height the rule asks for.
     Neither the mode nor the binary was the cause. */
  const browser = await chromium.launch({
    headless: process.env.HEADED === '0',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const problems = unreachableStates();
  /* #2519: findings that are NOT failures. Kept separate from `problems` so they
     cannot reach the exit code or the gate's FAIL anchor. */
  const notes = [];
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      colorScheme: theme,
    });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      /* ⚠️ ONE EXEMPTION, NARROWLY: the page requests the open agent's avatar,
         and under file:// there is no server to serve it. That is this
         harness's own condition rather than the page's defect. Everything
         else -- including any other failed load -- still counts, because a
         console error is usually the only sign of a paint that half ran. */
      if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;
      problems.push(`[${theme}] console: ${m.text()}`);
    });
    // Installed BEFORE the page's own scripts run, so its startup polls are
    // answered rather than failing against file:// and filling the console
    // with errors that would mask a real one.
    await page.addInitScript(() => {
      window.__fx = null;
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      /* ⚠️ THE APP'S OWN 5s TICK IS REFUSED, and this is not tidiness. A
         Playwright page is VISIBLE, so `tick`'s `document.hidden` guards (two
         of them, one added by this branch) do not stop it here: from the moment
         `CURRENT` is set and the detail panel is unhidden it fires a background
         `paintTalk` every five seconds for the whole multi-minute run, racing
         every paint driven by hand. (An earlier version of this comment said
         `tick` has no such guard at all, which was true when it was written and
         stopped being true two commits later.) It matters most in the mid-flight block below, whose entire
         premise is exclusive ownership of the in-flight window: a tick landing
         inside the 120ms sample bumps `TALK_LOAD`, the paint under test returns
         at its own stale-load guard, and the measurement describes the
         BACKGROUND paint. Recorded rather than merely refused, so a run can
         assert the page really did try to install it. */
      window.__intervals = [];
      /* ⚠️ THE NAME AS WELL AS THE DELAY. The page installs TWO top-level 5s
         intervals (the projects poll and `tick`), so a control that asks only
         whether some 5000 exists stays true when the one this stub is for is
         deleted or re-delayed -- a control that cannot fail for the reason it
         names. */
      window.setInterval = (fn, ms) => {
        window.__intervals.push({ ms, name: (fn && fn.name) || '(anonymous)' });
        return 0;
      };
      window.__posted = [];
      window.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/thread') && opts && opts.method === 'POST') {
          window.__posted.push(JSON.parse(opts.body));
          return enc(window.__postAnswer || {
            delivery: { state: 'placed', because: null, at: '2026-08-19T12:00:00.000Z', paneNote: null },
            recorded: true, recordedBecause: null,
          });
        }
        if (u.includes('/thread')) return enc(window.__fx);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
        return enc({});
      };
    });
    await page.goto(PAGE);
    /* CONTROL: the stub is only meaningful if the page actually asked for the
       tick. If the app stops using setInterval this reports rather than going
       quietly unnecessary. */
    const asked = await page.evaluate(() => (window.__intervals || []).slice());
    if (!asked.some((a) => a.ms === 5000 && a.name === 'tick')) {
      problems.push(`[${theme}] tick: the page installed no 5s \`tick\` interval (${JSON.stringify(asked)}), `
        + 'so the stub below is guarding nothing -- or the poll this check neutralises has been renamed');
    }
    /* Kept so two states can be compared to each other AFTER the loop, which
       is the only way to make "these two render the same" a claim. */
    const measured = {};
    /* CONTROL for the receipt geometry below: several states have no bubble at
       all, so the per-state check skips. If it skipped EVERY state the selector
       has moved and the whole assertion went quiet. */
    let measuredMeta = 0;
    /* The positive half of the receipt check: some row somewhere must actually
       carry "sent as", or its absence proves nothing. */
    let sawWire = 0;
    let sawFailedWire = 0;
    // #1927: how many states actually rendered a message bubble, so the
    // pre-wrap assertion below is not passing because nothing reached it.
    let measuredBubbleWrap = 0;
    let measuredMineBubble = 0;
    /* #3419: how many states rendered the needs_you question as a thread bubble,
       so the bubble assertion is not passing because no fixture carried one. */
    let measuredQuestionBubble = 0;
    for (const [name, fx] of Object.entries(STATES)) {
      await page.evaluate((f) => {
        window.__fx = f;
        // ⚠️ A BARE ASSIGNMENT, not `window.CURRENT`. The page declares
        // `let CURRENT` at top level, which is a lexical binding and NOT a
        // window property -- setting window.CURRENT made a second, unrelated
        // global while paintTalk's guard read the real one and returned early,
        // painting nothing. Every measurement came back empty and green.
        CURRENT = { sessionName: 'april', name: 'April' };
        document.getElementById('panel-detail').hidden = false;
        // ⚠️ THE FIRST-RUN OVERLAY IS DISMISSED, and the assertion below
        // proves it: the first run of this script captured eight states of
        // the SETUP screen with the box perfectly laid out underneath it,
        // and every measurement came back green. A clip rectangle does not
        // know what is painted over it.
        const fr = document.getElementById('firstrun');
        if (fr) fr.hidden = true;
        // ⚠️ AND `inert` CLEARED, which is the app's own second half (it sets
        // `inert` on every body child except #firstrun while the overlay is
        // up, and clears it on dismissal). Hiding the overlay alone left the
        // WHOLE PAGE non-hit-testable: every elementFromPoint answered BODY
        // and a Playwright click timed out, on a page that screenshots
        // perfectly. A picture cannot show you that nothing on it can be
        // clicked.
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
        // (there is no panel-agents element; the board is the default view)
      }, fx);
      // #3419: no answer-hold arming any more. The menu is gone, so there is no
      // `TALK_ANSWERED`/`TALK_QUESTION` client state to seed -- the question is
      // an agent-authored bubble in the thread and the paint reads it straight
      // off `__fx.messages`.
      await page.evaluate(() => paintTalk('april', 'April'));
      const box = page.locator('#d-talk-box');
      await box.scrollIntoViewIfNeeded();
      /* ⚠️ THE COMMITTED NAME, `talk-<state>-<theme>.png`, and not a shorter
         one. render-thread's header states the rule this file was breaking:
         "a screenshot in the repo is evidence only if the next person can
         regenerate the same picture", and the committed set was a hand-picked
         subset renamed by hand (`4-failed` copied onto `talk-4-send-failed`).
         Nobody reproduces that, and a mismatched pair is how a stale image
         outlives the screen it claims to show. */
      await page.screenshot({ path: `${OUT}/talk-${name}-${theme}.png`, clip: await box.boundingBox() });

      // ⚠️ MEASURED IN THE PAGE, not judged from the picture: scrollWidth vs
      // clientWidth is the one comparison immune to a capture narrower than
      // the render.
      const m = await page.evaluate(() => {
        const el = (id) => document.getElementById(id);
        const vis = (n) => !!(n && !n.hidden && n.getClientRects().length);
        const bubble = document.querySelector('#d-dmthread .msg-bd');
        const cs = bubble ? getComputedStyle(bubble) : null;
        // #2660: the PERSON'S OWN bubble specifically. `bubble` above is the
        // first `.msg-bd`, which may be the agent's `.msg:not(.you)` (transparent
        // body); the royal-blue tint lives on `.msg.you`, so the colour check
        // reads this.
        const mineBubble = document.querySelector('#d-dmthread .msg.you .msg-bd');
        const qask = el('d-qask');
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          boxOverflow: el('d-talk-box').scrollWidth - el('d-talk-box').clientWidth,
          threadOverflowX: el('d-dmthread').scrollWidth - el('d-dmthread').clientWidth,
          // #3419: `#d-qask` shows ONLY for the #2129 folder-trust recovery
          // (`answerNote`); NO fixture here sets it, so it must stay hidden. A
          // plain needs_you question is a thread bubble, not this banner.
          qaskVisible: vis(qask),
          qaskBg: qask && vis(qask) ? getComputedStyle(qask).backgroundColor : null,
          bubbleBg: cs ? cs.backgroundColor : null,
          mineBubbleBg: mineBubble ? getComputedStyle(mineBubble).backgroundColor : null,
          /* ⚠️ #1927: the store keeps paragraph breaks now, and `.dm-b` renders
             them with `white-space: pre-wrap`. Read the REAL computed style off
             the real bubble, so removing the rule from web/index.html reds this
             (a copy of the rule in a fixture would be a guard that cannot fail).
             `null` when no bubble is on screen in this state; the post-loop
             counter refuses a run where no state ever showed one. */
          bubbleWhiteSpace: cs ? cs.whiteSpace : null,
          offVisible: vis(el('d-dmoff')),
          // Rendered text (#687): textContent would carry CSS-hidden children.
          offText: el('d-dmoff').innerText,
          sayDisabled: el('d-say').disabled,
          // textContent on purpose: this is compared between two states below,
          // never asserted present, so the DOM text is the fair comparison.
          threadText: el('d-dmthread').textContent.trim().slice(0, 220),
          // Per ROW, because a verdict belongs to one message and the thread's
          // whole text cannot say which. Rendered text of drawn rows only
          // (#687): a "sent as" nobody can see must not satisfy the control.
          rows: Array.from(document.querySelectorAll('#d-dmthread .msg'))
            .filter((r) => r.getBoundingClientRect().height > 0)
            .map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
          sendDisabled: el('d-send').disabled,
          /* ⚠️ THE RESOLVED ALIGNMENT OF THE RECEIPT, which is the property
             and not a proxy for it. `.dm.mine` is `align-items: flex-end`, so
             it right-aligns the SPAN -- and that stops being the same thing as
             right-aligning its TEXT the moment a long verdict makes the span
             full width, at which point the receipt jumps to the opposite side
             of the panel from the message it belongs to. Four committed
             screenshots carried it.
             ⚠️ Measured as COMPUTED style rather than by geometry, after a
             geometry version of this check produced false positives on
             single-line receipts (a Range's first rect ends where the pill
             begins, which is nowhere near the row's edge and is perfectly
             correct). Computed style is also what catches the failure this
             stylesheet keeps having: a rule that HAS its element and loses on
             specificity. */
          metaAlign: (() => {
            const row = document.querySelector('#d-dmthread .msg.you');
            const w = row && row.querySelector('.msg-t');
            return w ? getComputedStyle(w).textAlign : null;
          })(),
          label: el('d-talk-label').innerText,
          // textContent on purpose: qlab is an ABSENCE control -- the
          // folder-trust recovery label (#d-qask-lab), which must stay empty on
          // every state here since none carries `answerNote`. Hidden text
          // counts as a leak.
          qlab: el('d-qask-lab').textContent,
          // ⚠️ WHAT IS ACTUALLY ON TOP at the box's own centre. `hidden` on
          // an overlay is a claim; this is the pixel.
          rect: JSON.stringify(el('d-talk-box').getBoundingClientRect()),
          onTop: (() => {
            const r = el('d-talk-box').getBoundingClientRect();
            // Clamped INTO the viewport: elementFromPoint answers about a
            // point on screen, and a point above the fold answers BODY --
            // which reads exactly like an overlay and is not one.
            const y = Math.min(Math.max(r.top + 20, 10), window.innerHeight - 10);
            const hit = document.elementFromPoint(r.left + r.width / 2, y);
            return hit ? (el('d-talk-box').contains(hit) ? 'the box' : (hit.id || hit.className || hit.tagName)) : 'nothing';
          })(),
        };
      });
      const tag = `${name}/${theme}`;
      /* #3419: `#d-qask` is now ONLY the #2129 folder-trust recovery banner,
         gated on `answerNote`. NO fixture here carries `answerNote`, so on every
         state the banner must be HIDDEN and its label EMPTY. A leak here is the
         class the old `qlab`-while-idle check guarded: one agent's question
         sentence held over in a shared element and surfacing under another's
         name. A plain needs_you question is a thread bubble now, asserted below,
         not this banner. */
      if (m.qaskVisible) {
        problems.push(`${tag}: the #d-qask folder-trust banner is on screen where no answerNote is set`);
      }
      if (m.qlab) {
        problems.push(`${tag}: the folder-trust label carries text where nothing set answerNote: ${JSON.stringify(m.qlab)}`);
      }
      /* #3419: the injected needs_you question renders AS A THREAD BUBBLE
         (chat.withQuestionRow's `kind: 'question'` row), not as the removed
         option menu. Where the fixture carries that row, its text must appear in
         a drawn `#d-dmthread` row -- and, by the banner check above, NOT in
         `#d-qask`. A positive counter refuses a run where no state ever showed
         one, so a fixture change that drops the question cannot pass this
         vacuously. */
      const qrow = (fx.messages || []).find((msg) => msg && msg.kind === 'question');
      if (qrow) {
        const norm = (s) => String(s).replace(/[│❯]/g, '').replace(/\s+/g, ' ').trim();
        const needle = norm(qrow.text).slice(0, 30);
        if (needle && (m.rows || []).some((r) => norm(r).includes(needle))) {
          measuredQuestionBubble += 1;
        } else {
          problems.push(`${tag}: the needs_you question did not render as a thread bubble `
            + `(looked for ${JSON.stringify(needle)} among ${JSON.stringify(m.rows)})`);
        }
      }
      /* ⚠️ THE RECEIPT AGAINST THE VERDICT, PER ROW. "sent as 1" beside "Could
         not deliver" is two sentences contradicting each other, and it shipped
         in both themes because nothing read one against the other.
         ⚠️ AND PER ROW IS THE POINT: the first version tested the thread's whole
         truncated textContent, so a placed row above a failed one would have
         fired it falsely and a failed row past 220 characters would have
         silenced it. `rows` below is measured element by element.
         ⚠️ WITH ITS POSITIVE CONTROL. Asserting only the absence would stay
         green if `wire` were dropped everywhere or the suffix inverted, so a
         delivered row is required to CARRY the phrase. */
      for (const row of (m.rows || [])) {
        if (/could not deliver/i.test(row) && /sent as/i.test(row)) {
          problems.push(`${tag}: the receipt says a message was sent on a row whose verdict says nothing `
            + `reached the agent: ${JSON.stringify(row.slice(0, 150))}`);
        }
      }
      if ((m.rows || []).some((r) => /sent as/i.test(r))) sawWire += 1;
      /* ⚠️ THE INPUT THE NEGATIVE ARM ACTUALLY NEEDS, which "some row says
         sent as" is not. That counter is satisfied by states 2, 3 and 11, none
         of which can ever exercise "the suffix must not appear on a FAILED
         row". The only fixture that can is one whose record carries a `wire`
         AND whose delivery could not reach the pane -- and it exists today only
         because `4-failed` happens to set `wire: '1'`, which renders as nothing
         and so reads as dead. Delete that one field and the loop above goes
         vacuous while the old control stayed green. */
      if ((fx.messages || []).some((msg) => msg && msg.wire
        && msg.delivery && msg.delivery.state === 'could_not')) sawFailedWire += 1;
      if (m.metaAlign !== null) {
        measuredMeta += 1;
        if (m.metaAlign !== 'right') {
          problems.push(`${tag}: the receipt under the person's own bubble aligns ${m.metaAlign}, `
            + 'so a verdict long enough to wrap leaves its message behind');
        }
      }
      if (m.onTop !== 'the box') problems.push(`${tag}: something else is painted over the box: ${m.onTop}`);
      if (m.pageOverflow > 0) problems.push(`${tag}: the PAGE scrolls sideways by ${m.pageOverflow}px`);
      if (m.boxOverflow > 0) problems.push(`${tag}: the box overflows by ${m.boxOverflow}px`);
      if (m.threadOverflowX > 0) problems.push(`${tag}: the thread scrolls sideways by ${m.threadOverflowX}px`);
      // A transparent panel is the defect a screenshot flatters and a text
      // check cannot see at all.
      /* ⚠️ NAMED FOR WHAT IT CAN ACTUALLY SEE. This used to say it caught the
         `--k-sunk` failure; it cannot. Every usage site keeps the pack's
         fallback, so deleting the token yields a WRONG wash in dark, never a
         transparent one. What this detects is a question box with no ground at
         all, whatever the cause. The token's own protection is the text pin in
         server.test.js, which does work. */
      if (m.qaskVisible && (m.qaskBg === 'rgba(0, 0, 0, 0)' || m.qaskBg === 'transparent')) {
        problems.push(`${tag}: the question box has no background at all`);
      }
      /* #2660: the person's OWN bubble (`.dm.mine .dm-b`) wears the royal-blue
         `--usermsg-tint`, not the old gold, and the agent's row (`.dm.theirs`,
         which `dmRow` emits when `m.from` is set, since #175) takes the
         transparent `.dm-b` default. So read the MINE bubble specifically:
         reading the first `.dm-b` (which may be a transparent theirs row) would
         false-fire. #3267: `--usermsg-tint` is now SOLID (opaque), so this reads
         the painted pixel (light rgb(232,235,245), dark rgb(20,28,47)), not the
         old translucent rgba(65,113,227,...). Assert the blue channel LEADS
         (>=8), theme-agnostic, matching render-room-msgbox-2806.js's recalibrated
         floor -- it confirms the bubble reads as the royal-blue tint without
         pinning the exact opacity. `null` when no mine bubble is on screen in this
         state; the post-loop counter refuses a run where none ever was. */
      if (m.mineBubbleBg !== null) {
        measuredMineBubble += 1;
        const mineCh = (m.mineBubbleBg.match(/[\d.]+/g) || []).map(Number);
        const mineBlueLead = mineCh.length >= 3 ? mineCh[2] - Math.max(mineCh[0], mineCh[1]) : -999;
        if (mineBlueLead < 8) {
          problems.push(`${tag}: the person's own message bubble is not the royal-blue tint: ${m.mineBubbleBg} (blueLead ${mineBlueLead})`);
        }
      }
      /* #1927: the bubble must preserve paragraph breaks. `pre-wrap` is what
         shows a stored `\n`; `normal` (the default, and what a reverted rule
         gives) collapses paragraphs into a blob -- the exact operator-facing
         defect this card is about. `storeText` already collapsed space RUNS, so
         pre-wrap does not resurrect ragged whitespace. */
      if (m.bubbleWhiteSpace !== null) {
        measuredBubbleWrap += 1;
        if (m.bubbleWhiteSpace !== 'pre-wrap') {
          problems.push(`${tag}: the message bubble does not preserve paragraph breaks `
            + `(white-space is ${m.bubbleWhiteSpace}, not pre-wrap) -- a stored newline renders as a blob`);
        }
      }
      console.log(tag, JSON.stringify(m));
      measured[name] = m;
    }

    if (!sawWire) {
      problems.push(`[${theme}] receipt: no row carried a "sent as" suffix at all, so the check that it `
        + 'never appears on a failed send is UNCHECKED');
    }
    if (!sawFailedWire) {
      problems.push(`[${theme}] receipt: no fixture pairs a recorded wire with a delivery that never `
        + 'reached the pane, so "the suffix is absent on a failed row" is asserted against nothing');
    }
    if (!measuredQuestionBubble) {
      problems.push(`[${theme}] question: no state rendered the needs_you question as a thread bubble, `
        + 'so "the injected question row shows in the thread" is UNCHECKED (the fixtures or the render changed)');
    }
    if (!measuredMeta) {
      problems.push(`[${theme}] receipt: no state produced a .msg.you receipt, so its alignment is UNCHECKED`);
    }
    if (!measuredBubbleWrap) {
      problems.push(`[${theme}] bubble: no state rendered a message bubble, so #1927's `
        + 'paragraph-preserving white-space: pre-wrap is UNCHECKED');
    }
    if (!measuredMineBubble) {
      problems.push(`[${theme}] bubble: no state rendered the person's own (.msg.you) bubble, `
        + "so #2660's royal-blue --usermsg-tint on the person's own message is UNCHECKED");
    }

    /**
     * WARNING: THE STATE SWEEP ABOVE ONLY LOOKS. Both of the worst defects this
     * file has caught lived in what happens when a control is PRESSED -- a
     * focus rescue that was dead code, and a poll that destroyed the button
     * under the person's keyboard every five seconds. Neither is visible in a
     * screenshot or a computed style. So this pass touches things.
     */
    {
      // #3419: a plain thread state to prime the page before the reopen arm.
      // (Was the menu fixture; the menu is gone, so any painted thread does.)
      const primed = STATES['2-answered-placed'];
      await page.evaluate((f) => {
        window.__fx = f; window.__posted = [];
        CURRENT = { sessionName: 'april', name: 'April' };
      }, primed);
      await page.evaluate(() => paintTalk('april', 'April'));

      // 0. REOPENING THE SAME AGENT must not strand the thread box.
      // ⚠️ The bug this catches needs the SAME state painted twice with a
      // clear in between: only then does the paint's "nothing changed" cache
      // match what it is about to write, and skip a rebuild the clear has
      // already undone. A harness that always paints a fresh state cannot see
      // it, which is why this sequence is spelled out rather than implied.
      // ⚠️ THROUGH THE APP'S OWN CLEARING BLOCK, not a copy of it in this file.
      // `openDetail` is what runs when somebody goes back to the board and
      // opens an agent again, and its clear is where a cache can be left
      // speaking for markup that no longer exists. Clearing by hand here would
      // be testing this script's idea of the clear.
      const { card, source: cardSource, error: cardError } = realCard();
      if (cardSource === 'error') {
        // The producer threw. Before #2519 this failed 3b, and it still must.
        /* ⚠️ KNOWN AND DELIBERATELY NOT COLLAPSED: one broken producer pushes THREE
           problems per theme (here, the clear-path line, and the stranded-box line), and
           tools/browser-checks.sh quotes only `head -3` of the reason, so a producer
           failure fills the operator's quoted reason with restatements of itself and
           hides any other red. Collapsing them means changing control flow in a
           release-gating check that CANNOT be run from here (it needs a browser), to
           improve a log line. That trades an unverifiable regression risk for an
           ergonomic gain, so it is recorded rather than done. Each line is true and
           names a different unchecked path; the cost is noise, not a wrong verdict. */
        problems.push(`[${theme}] reopen: status.snapshot() failed (${cardError}), so the card path is BROKEN, not merely empty`);
      }
      if (cardSource === 'golden') {
        // #2519: covered, but say so. A quiet box and a populated box must not print
        // identical output while driving different inputs.
        notes.push(`[${theme}] reopen: no PANE-based agent card of ours was available, so the RECORDED card fixture drove the clear path`);
      }
      /* 🛑 THERE IS NO LIVE-VS-FIXTURE DRIFT GUARD HERE, AND REMOVING IT WAS THE FIX.
         TRACKED AS kosmos#2553, so this gap is open work rather than only a comment.
         An earlier version of this branch compared the live card's nested key paths
         against the recording and pushed a PROBLEM on any difference. It was unsound,
         and it would have redded release cuts on ordinary board composition.
         MEASURED on an 18-agent board: TWO distinct `profile` shapes among pane cards
         of ours -- 17 carrying id/idInstall/instructionsWrite/updatedAt and ONE empty,
         because store.readProfile() returns {} for an agent with no profile file. So
         one card in eighteen made the guard fire. `profile` is a free-form operator
         record and `context` has FOUR distinct key sets in status.js, counted rather than asserted: the NONE_BASE family (FIFTEEN objects share that one key set, derived by the arm; earlier versions said six by counting only readContext and missing readCodexContext and the two inline card literals, then eleven before #3296's readGeminiContext added the codex-mirrored UNREADABLE and NO_TRANSCRIPT branches for the third provider, then thirteen before #3391's readGrokContext added the same two branches for the fourth provider), neverRecordedResult (adds `neverRecorded`), measuredResult (adds `overCeiling`, `ceiling`, `ceilingAssumed`) and noCeilingResult (adds `ceiling`, `ceilingSource`, `noCeiling`) (an earlier version said FIVE) depending on
         whether that agent has a readable transcript and a known ceiling, so no two
         cards are guaranteed to share a nested shape at all.
         ⚠️ AND WHICH CARD IS COMPARED WAS ARBITRARY: liveCard() takes the first pane
         card tmux lists, while the capture tool deliberately prefers one with real
         evidence. The guard was comparing an arbitrary card against a recording of a
         hand-picked one, so whether a cut went red depended on pane ordering, and
         "re-capture it" would only have moved which card failed.
         ⇒ The fixture's anti-rot check lives in `yarn test` instead
         (render-talk-goldencard-2519.test.js), where it compares the TOP-LEVEL key set
         only. That set comes from status.js's PANE card literal, so it is the same for
         every pane card. ⚠️ AN EARLIER VERSION ADDED "a paneless card has its own literal
         and its own KEY SET, which is why liveCard prefers a pane card". Measured: the
         paneless literal emits the SAME 30 top-level keys, and status.js:5883 keeps it
         that way ON PURPOSE, calling it SHAPE PARITY "so a consumer sees one card shape
         rather than two". That sentence asserted a top-level difference the producer
         designed away, while doing duty as the justification for this top-level-only
         comparison. The comparison is still the right one (a false red on nested
         composition costs a release), and liveCard's pane preference is still right, but
         the reason is the NESTED difference this file states correctly at its head: null
         session/target/runner/model and a smaller context. A false red here costs a test
         run rather than a release. A guard that reds a cut on board composition is worse than no guard. */
      if (!card) {
        /* Worded from the SOURCE: on `error` the fixture was never consulted at all
           (realCard returns before goldenCard runs), so claiming "no usable fixture"
           there would assert something nothing measured. */
        problems.push(cardSource === 'error'
          ? `[${theme}] reopen: the card producer failed, so the clear path is UNCHECKED`
          : `[${theme}] reopen: no agent card and no usable fixture, so the clear path is UNCHECKED`);
      } else {
        const reopened = await page.evaluate((c) => {
          try { window.__card = c; LAST = [c]; openDetail(c.sessionName); return true; }
          catch (e) { return String(e && e.message); }
        }, card);
        if (reopened !== true) {
          problems.push(`[${theme}] reopen: could not drive openDetail (${reopened}) -- the clear path is UNCHECKED`);
        }
      }
      await page.evaluate(() => paintTalk('april', 'April'));
      /* ⚠️ THE THREAD BOX TOO, and with MESSAGES in it. The first version of
         this check reopened on a state whose fixture has none, so it exercised
         only the empty arms -- which were the arms that already cleared their
         cache. The stranded box needs a thread that renders rows and a repaint
         that produces byte-identical markup, which is every thread whose newest
         message is over an hour old. */
      /* ⚠️ GATED ON THE CARD, like the block above it. `window.__card` is only
         assigned when `realCard()` found one, and this block read it
         unconditionally: on a machine running no agent of ours, `LAST` became
         `[undefined]` and `openDetail` threw a TypeError INSIDE the evaluate,
         which rejects the top-level IIFE -- so the run died before printing
         the problem list at all. That is the same "a check that dies instead
         of reporting" failure the press pass documents forty lines down, and
         it would have hit whoever ran this on a quiet machine. */
      const threadAfterReopen = card ? await page.evaluate(async (f) => {
        window.__fx = f;
        await paintTalk('april', 'April');
        // textContent on purpose: a before/after change detection, not a presence read.
        const before = document.getElementById('d-dmthread').textContent.slice(0, 40);
        LAST = [window.__card];
        openDetail('april');
        await paintTalk('april', 'April');
        return { before, after: document.getElementById('d-dmthread').textContent.slice(0, 40) };
      }, STATES['2-answered-placed']) : null;
      if (!threadAfterReopen) {
        problems.push(cardSource === 'error'
          ? `[${theme}] reopen: the card producer failed, so the STRANDED-BOX path is UNCHECKED`
          : `[${theme}] reopen: no agent card and no usable fixture, so the STRANDED-BOX path is UNCHECKED`);
      } else if (threadAfterReopen.after !== threadAfterReopen.before) {
        problems.push(`[${theme}] reopen: the thread box is stranded after a reopen `
          + `(${JSON.stringify(threadAfterReopen.before)} -> ${JSON.stringify(threadAfterReopen.after)})`);
      }
      // #3419: the option-menu press pass is gone with the menu. What remains
      // TOUCHES the page rather than only looking -- the thread-scroll holds,
      // the composer send/paste, the clock-only repaint and the two 404s --
      // and none of it needs a button on screen, so it runs unconditionally.
      {


      /* 2c. THE SCROLL HALF, which nothing asserted. Mutating `setThread`'s
       * count key into an unconditional scroll-to-bottom -- the documented
       * "poll fighting the reader" defect -- left the whole suite green and
       * this file reporting no problems. The most documented half of the
       * newest function had no check at all. */
      const scroll = await page.evaluate(async () => {
        const many = Array.from({ length: 30 }, (_, i) => ({
          at: new Date(Date.UTC(2026, 0, 1, 9, 0, i)).toISOString(),
          text: 'message number ' + (i + 1), wire: null,
          delivery: { state: 'placed', because: null, paneNote: null },
        }));
        window.__fx = { ...window.__fx, asking: false, question: null, options: null, messages: many };
        await paintTalk('april', 'April');
        const box = document.getElementById('d-dmthread');
        box.scrollTop = 0;
        await paintTalk('april', 'April');           // identical repaint
        const held = box.scrollTop;
        window.__fx = { ...window.__fx, messages: many.concat([{
          at: new Date(Date.UTC(2026, 0, 1, 9, 0, 31)).toISOString(),
          text: 'a new one', wire: null,
          delivery: { state: 'placed', because: null, paneNote: null },
        }]) };
        await paintTalk('april', 'April');           // one more message
        const readingBack = box.scrollTop;

        /* THE POSITIVE CONTROL. Everything above proves the thread does NOT
           move; without this arm that is also true of a thread that never
           follows anything, and the check would pass on a product that had
           stopped bringing new messages into view entirely. */
        box.scrollTop = box.scrollHeight;
        window.__fx = { ...window.__fx, messages: window.__fx.messages.concat([{
          at: new Date(Date.UTC(2026, 0, 1, 9, 0, 32)).toISOString(),
          text: 'and another', wire: null,
          delivery: { state: 'placed', because: null, paneNote: null },
        }]) };
        await paintTalk('april', 'April');
        const followed = (box.scrollHeight - box.scrollTop - box.clientHeight) <= 4;

        /* THE FLAP (#1037). A poll that renders a not-a-list arm and then the
           rows again replaces the markup twice, which CLAMPS scrollTop to 0
           on the way through. This is what Josh timed at precisely five
           seconds while touching nothing, and no scroll assignment is
           involved -- so a check that only watches the scroll line cannot see
           it. `historyUnfilable` with no rows is one of the real null arms. */
        /* ⚠️ ASSERTED, NOT ASSUMED. If the fixture thread ever gets shorter than
           the panel needs for a 900px offset, `before` silently becomes the max
           offset -- and on unfixed code the flap ends at scrollHeight, which
           clamps to that same max, so afterFlap === before and this arm becomes
           unfalsifiable. `parkedProperly` is reported so it cannot go quiet. */
        box.scrollTop = 900;
        const before = box.scrollTop;
        const parkedProperly = before === 900;
        const keep = window.__fx.messages;
        window.__fx = { ...window.__fx, messages: [], historyUnfilable: true };
        await paintTalk('april', 'April');          // the null arm
        window.__fx = { ...window.__fx, messages: keep, historyUnfilable: false };
        await paintTalk('april', 'April');          // and the rows come back
        const afterFlap = box.scrollTop;
        return { held, readingBack, followed, before, afterFlap, parkedProperly };
      });
      if (scroll.held !== 0) {
        problems.push(`[${theme}] scroll: an identical repaint moved a reader from 0 to ${scroll.held}`);
      }
      /* ⚠️ THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, ON PURPOSE.
         It read "a new message did not bring the thread into view" and failed
         when the thread did not move. That encoded the yank #1037 removes: the
         reader is parked at offset 0 on a thirty-message thread, which is as
         scrolled-up as it is possible to be, and dragging them to the bottom
         is the defect. Following the tail is now proven by the at-the-bottom
         arm below instead, which is where it is actually correct. */
      if (scroll.readingBack !== 0) {
        problems.push(`[${theme}] scroll: a new message yanked a reader who had scrolled up, from 0 to ${scroll.readingBack}`);
      }
      if (!scroll.followed) {
        problems.push(`[${theme}] scroll: a reader who WAS at the bottom did not follow the new message`);
      }
      if (!scroll.parkedProperly) {
        problems.push(`[${theme}] scroll: the fixture could not park a reader at 900 (got ${scroll.before}), so the flap arm proves nothing`);
      }
      if (scroll.afterFlap !== scroll.before) {
        problems.push(`[${theme}] scroll: a poll through a not-a-list arm moved the reader from ${scroll.before} to ${scroll.afterFlap} (#1037)`);
      }

      // #3419: prime a composer-open thread state for the send/paste steps
      // below (was the menu fixture the removed option-hold pass left painted).
      await page.evaluate((f) => { window.__fx = f; }, STATES['2-answered-placed']);
      await page.evaluate(() => paintTalk('april', 'April'));

      // 3. Send with the keyboard: the same rescue, from the other control.
      await page.evaluate(() => {
        window.__posted = [];
        document.getElementById('d-say').value = 'typed by hand';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.evaluate(() => document.getElementById('d-send').focus());
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const landed2 = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
      if (landed2 === 'BODY') {
        problems.push(`[${theme}] press: focus was stranded on the document after Send`);
      }

      /* 4. A message with whitespace around it, which is what a paste is.
         ⚠️ THE BOX MUST BE EMPTY AFTERWARDS. `clearSent` clears only when the
         box still holds exactly the text this send took, and the composer was
         handing `say.value` RAW to a comparison against `say.value.trim()` --
         so a pasted line was delivered, recorded, and left sitting armed in
         the box under "Placed into April's session". Two presses of Enter on
         one paste is a message typed into a live agent twice. The room's own
         composer trims at the source; this is that, driven. */
      await page.evaluate(() => {
        window.__posted = [];
        document.getElementById('d-say').value = '  14 days  ';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      const pasted = await page.evaluate(() => ({
        sent: window.__posted[0],
        left: document.getElementById('d-say').value,
        draft: TALK_DRAFTS.april,
      }));
      if (!pasted.sent || pasted.sent.text !== '14 days') {
        problems.push(`[${theme}] paste: the untrimmed value was sent as ${JSON.stringify(pasted.sent)}`);
      }
      if (pasted.left !== '') {
        problems.push(`[${theme}] paste: the composer still holds ${JSON.stringify(pasted.left)} after a placed send`);
      }
      if (pasted.draft) {
        problems.push(`[${theme}] paste: the draft survived a placed send as ${JSON.stringify(pasted.draft)}`);
      }

      /* 4b. THE LINE UNDER THE COMPOSER IS SILENT ON A PLACED SEND (#402, #3419).
         The send in step 4 was placed with the agent at its prompt, so the line
         owes nothing; it used to print "Placed into April's session." on every
         message, which Josh ruled out of the room (2026-08-21). #3419 finished
         the job: a PLACED message is silent even against a MID-TASK agent, whose
         `paneState: 'working'` + paneNote used to earn the "it was mid-task, so
         it will not read this until it finishes" consequence clause Josh named
         as noise. Both halves are asserted -- an idle placed send (above) and a
         mid-task one (below) -- because the mid-task arm is the exact input the
         consequence keyed on, so a "restore the note" regression reds HERE. And
         because silence alone is also what a broken send looks like, the box is
         checked to have CLEARED (the placed path ran), not merely the line to be
         empty. */
      // textContent on purpose: an ABSENCE control, so hidden text counts too.
      const quiet = await page.evaluate(() => document.getElementById('d-say-msg').textContent);
      if (quiet.trim() !== '') {
        problems.push(`[${theme}] receipt: a healthy send still prints "${quiet}" under the composer`);
      }
      await page.evaluate(() => {
        window.__posted = [];
        window.__postAnswer = {
          delivery: { state: 'placed', because: null, at: '2026-08-19T12:00:00.000Z', paneState: 'working',
            paneNote: 'it was mid-task, so it will not read this until it finishes' },
          recorded: true, recordedBecause: null,
        };
        document.getElementById('d-say').value = 'and one more';
      });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.click('#d-send');
      await page.waitForFunction(() => window.__posted.length > 0 && !TALK_SENDING, null, { timeout: 4000 });
      // Rendered text of a drawn element (#687): a leaked consequence must be seen.
      const busy = await page.evaluate(() => {
        const m = document.getElementById('d-say-msg');
        const line = m.getBoundingClientRect().height > 0 ? m.innerText : '';
        const cleared = document.getElementById('d-say').value === '';
        delete window.__postAnswer;
        return { line, cleared };
      });
      // POSITIVE CONTROL: the placed send actually ran, so an empty line is the
      // #3419 silencing and not a send that never happened.
      if (!busy.cleared) {
        problems.push(`[${theme}] receipt: the mid-task placed send did not clear the composer, so its silence proves nothing`);
      } else if (busy.line.trim() !== '') {
        problems.push(`[${theme}] receipt: a placed send to a mid-task agent leaked a consequence clause (#3419 silenced it): "${busy.line}"`);
      }

      /* 6. A REPAINT WHERE ONLY THE CLOCK MOVED, on a thread long enough to
         scroll and new enough to say "a minute ago".
         ⚠️ THE SCROLL BLOCK'S OWN FIXTURES, 2c above, ARE DATED January 2026,
         so their verdict lines render a fixed "9:00 am, Jan 1" and a repaint
         there is byte-identical. THIS block is the opposite on purpose: its
         thread is 65 seconds old so the phrase moves, which is the whole point
         of it.
         (Twice corrected and worth recording as one lesson. The sentence first
         said "every fixture in this file", which was a confident absolute the
         file contradicts -- `placed()` and `3-unconfirmed` both render relative
         phrases. The correction then said "the fixtures THIS block uses", which
         moved the claim onto the block that deliberately does the opposite. A
         wrong absolute replaced by a wrong referent: the fix for an
         over-general claim is a precise one, not a smaller general one.)
         That makes the scroll block above an honest test of
         "an unchanged list does not move", and NO test at all of the case the
         product actually spends its first hour in: `pjWhen` returns a RELATIVE
         phrase under an hour, so the markup changes once a minute on a thread
         nobody touched, `setThread` rewrites `innerHTML`, and the count key is
         unchanged so the jump-to-bottom arm does not fire. Whether that moves
         a reader is a question about the browser, not about this code, and the
         answer measured here (2026-08-20, Chromium, headed) is that it does
         not: a same-height rewrite keeps `scrollTop`. This block exists so the
         day that stops being true is a failure rather than a discovery. */
      const clockOnly = await page.evaluate(async () => {
        const at = new Date(Date.now() - 65 * 1000).toISOString();
        /* ⚠️ COUNT RAISED 8 -> 30 (#3414). The agent-DM rebuild made
           #d-talk-box (and its #d-dmthread) fill the panel edge-to-edge, so a
           taller box no longer overflows on eight short lines and `scrolls`
           went false, which fires the "did not overflow, so the scroll-hold is
           UNCHECKED" control below. This is the same shape #413 hit with the
           70-column question the day the page went full-width. The scroll-hold
           behaviour is unchanged and still worth testing, so the fixture is
           lengthened to overflow the taller box rather than the control
           weakened. Thirty matches the sibling scroll block (2c). */
        window.__fx = {
          messages: Array.from({ length: 30 }, (_, i) => ({
            text: 'message number ' + (i + 1) + ' with enough words in it to take a line or two of the box',
            at, delivery: { state: 'placed', because: null, at, paneNote: null },
          })),
          olderCount: 0, historyBecause: null, historyUnfilable: false,
          presence: 'on', presenceBecause: null, asking: false, question: null,
          questionBecause: null, options: null,
        };
        await paintTalk('april', 'April');
        const t = document.getElementById('d-dmthread');
        t.scrollTop = t.scrollHeight;
        const before = { top: Math.round(t.scrollTop), key: t.__lastThread,
          scrolls: t.scrollHeight > t.clientHeight };
        const real = Date.now;
        Date.now = () => real() + 120000;
        try { await paintTalk('april', 'April'); } finally { Date.now = real; }
        return { ...before, after: Math.round(t.scrollTop), rewrote: t.__lastThread !== before.key };
      });
      if (!clockOnly.scrolls) {
        /* CONTROL: with nothing to scroll, `scrollTop` is 0 both times and the
           check below passes on a box that cannot demonstrate anything. */
        problems.push(`[${theme}] clock: the thread box did not overflow, so the scroll-hold is UNCHECKED`);
      }
      if (!clockOnly.rewrote) {
        /* CONTROL: and if the markup did NOT change, no rewrite happened and
           the check below is measuring the wrong thing entirely. */
        problems.push(`[${theme}] clock: a minute passing did not change the markup, so the rewrite is UNCHECKED`);
      }
      if (clockOnly.scrolls && clockOnly.rewrote && clockOnly.after !== clockOnly.top) {
        problems.push(`[${theme}] clock: a repaint where only the time phrase moved took the reader `
          + `from ${clockOnly.top} to ${clockOnly.after}`);
      }

      /* 7. THE TWO 404s, which are one status and two different facts.
         ⚠️ THE PAGE MUST NOT READ PERMANENCE OFF THE STATUS. A pane holding
         this name untied answers 404 on every poll forever ('borrowed'); a
         tmux read that failed once answers 404 too, because the gate fails
         closed ('unreadable'), and it clears by itself. Told apart only by the
         status, a five-second hiccup on an ordinary tied agent drew the
         written-for-forever sentence with no cause anywhere on the panel --
         `#d-untied` is hidden for a tied card. So the route sends the reason
         and this asserts BOTH arms off it. */
      const both = await page.evaluate(async () => {
        const out = {};
        const real = window.fetch;
        const four04 = (body) => async () => new Response(JSON.stringify(body),
          { status: 404, headers: { 'content-type': 'application/json' } });
        try {
          window.fetch = four04({ error: 'no agent by that name', because: 'borrowed' });
          await paintTalk('april', 'April');
          out.borrowed = document.getElementById('d-dmthread').innerText.trim();
          window.fetch = four04({ error: 'we could not check which agents are running', because: 'unreadable' });
          await paintTalk('april', 'April');
          out.unreadable = document.getElementById('d-dmthread').innerText.trim();
        } finally {
          window.fetch = real;
        }
        return out;
      });
      if (both.borrowed !== 'We cannot show a conversation for this name.') {
        problems.push(`[${theme}] refusal: the standing 404 drew ${JSON.stringify(both.borrowed)}`);
      }
      if (!/just now/.test(both.unreadable || '')) {
        problems.push(`[${theme}] refusal: a 404 we may recover from lost its time phrase: ${JSON.stringify(both.unreadable)}`);
      }
      if (/no agent by that name/i.test(both.borrowed || '')) {
        problems.push(`[${theme}] refusal: the route's own sentence reached the panel: ${JSON.stringify(both.borrowed)}`);
      }

      }
    }
    await page.close();
  }
  await browser.close();
  /* #2519: NOTES are not failures and must never read as one. They print on their own
     lines with a NOTE prefix and take no part in the exit code.
     ⚠️ AND THE GATE'S PATTERN IS WIDER THAN THE ANCHOR. An earlier version of this
     comment said the gate "anchors on `^\s*(FAIL|✖)`". tools/browser-checks.sh actually
     greps `'^\s*(FAIL|✖)|Error|Timeout|REFUS|refus'` when quoting a reason, so a note
     containing the word Error or refused would be quoted as the cause of an unrelated
     red. Today's note text matches none of those; whoever adds the next one should
     check against the real pattern rather than this sentence. */
  if (notes.length) {
    console.log('\n=== notes ===');
    console.log(notes.map((n) => `  NOTE  ${n}`).join('\n'));
  }
  console.log('\n=== problems ===');
  // Prefix each finding with FAIL at the PRINT site so the release gate's
  // anchored `grep -E '^\s*(FAIL|✖)|...'` can quote the reason (kosmos#1836).
  // The prefix must land on the printed LINE, not the pushed string: a bare
  // `problems.join` printed unquotable lines the gate reported as
  // `(no FAIL or error line in its output)`.
  console.log(problems.length ? problems.map((p) => `  FAIL  ${p}`).join('\n') : 'none');
  console.log('shots in', OUT);
  if (problems.length) process.exitCode = 1;
})();
