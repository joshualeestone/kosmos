'use strict';

/**
 * An agent answering the person, in the box on its own page.
 *
 * 🛑 WHAT DID NOT EXIST. Two calls in `server.js` wrote into a conversation and
 * both were operator-only; deeper than that, the stored record had no field for
 * a sender, so every row was the person's by definition. An agent answered in
 * its own session, which reaches nobody, and Josh watched an empty box for an
 * afternoon (#175).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
/* 🔑 THE BLESSED EXTRACTOR, not a second brace-walk. The one further down this
   file starts its walk at the first `{` after the NAME, which is the exact bug
   `test-support/page.js` exists to fix -- it closes on a destructured parameter
   list and returns a signature, and a test asserting an ABSENCE then passes
   silently because a signature contains none of the things a body would. Safe
   for the functions it is used on today; not a pattern to copy. */
const page = require('./test-support/page.js');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'answers-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const store = require('./engine/store');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

const readBack = (agent) => chat.readThread(chat.DIRECT, agent).messages;

test('a reply is kept with its sender, and the person’s messages are unchanged', () => {
  chat.appendMessage(chat.DIRECT, 'dana', { text: 'hello', at: '2026-08-21T20:00:00.000Z', delivery: { state: 'placed' } });
  chat.appendMessage(chat.DIRECT, 'dana', { text: 'hello back', at: '2026-08-21T20:01:00.000Z', from: 'dana' });

  const rows = readBack('dana');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].from, null, 'the person’s row grew a sender');
  assert.equal(rows[1].from, 'dana', 'the reply does not say who wrote it, which is the whole defect');
  assert.equal(rows[1].text, 'hello back');
});

test('a reply carries NO delivery, because there was no crossing to fail', () => {
  /**
   * 🛑 FOUND BY RUNNING AN APPEND AND READING THE RECORD BACK, not by looking
   * at the page. `state` falls back to COULD_NOT — right for the person's
   * messages, where it means "no evidence it arrived" — and an agent's reply is
   * written straight into the record the screen reads. COULD_NOT there is a
   * claim about a mechanism that never ran.
   *
   * ⚠️ The box looked FINE: `dmRow` skips the verdict for these rows. The
   * CONVERSATION view does not, and would have printed "Not sent." under a
   * reply that had arrived.
   */
  chat.appendMessage(chat.DIRECT, 'rho', { text: 'on it', at: '2026-08-21T20:02:00.000Z', from: 'rho' });
  const [row] = readBack('rho');
  assert.equal(row.delivery, null, 'the reply claims a delivery state for a crossing that never happened');

  // ⚠️ THE CONTROL: the person's own row must still carry one, or this has
  // removed the thing that tells them a message did not land.
  chat.appendMessage(chat.DIRECT, 'rho', { text: 'ok', at: '2026-08-21T20:03:00.000Z', delivery: { state: 'unconfirmed' } });
  assert.equal(readBack('rho')[1].delivery.state, 'unconfirmed');
});

test('a thread written before this field existed still reads', () => {
  /**
   * ⚠️ ABSENT MEANS THE OPERATOR, and it is load-bearing rather than tidy:
   * every thread file already on somebody's disk was written without this
   * field. A required one would have made the change a migration.
   */
  const file = nodePath.join(SANDBOX, store.APP, 'chats', 'direct..old.json');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: '@you', agent: 'old',
    messages: [{ at: '2026-08-01T00:00:00.000Z', text: 'from before', delivery: { state: 'placed' } }],
  }), 'utf8');

  const rows = readBack('old');
  assert.equal(rows.length, 1, 'an old thread stopped being readable');
  assert.equal(rows[0].from, undefined, 'the old row was rewritten rather than read as it is');
  assert.equal(rows[0].text, 'from before');
});

test('a sender that is not a string is refused, because it reaches the renderer', () => {
  const file = nodePath.join(SANDBOX, store.APP, 'chats', 'direct..bad.json');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    project: '@you', agent: 'bad',
    messages: [{ at: '2026-08-01T00:00:00.000Z', text: 'x', from: 42 }],
  }), 'utf8');
  assert.throws(() => readBack('bad'), (e) => e.code === 'UNPARSEABLE',
    'a non-string sender is passed to the page, where it becomes a TypeError in the renderer');
});

test('the instruction block TEACHES the command, asked of the block itself', () => {
  /**
   * 🛑 THE VERSION THIS REPLACES READ `engine/messages.js` AS TEXT. A reviewer
   * commented out the bullet that teaches the command — so no agent is ever
   * told it exists — and the test passed, because the characters survived on
   * the commented line.
   *
   * ⚠️ `blockBody` is exported, pure and takes no arguments. There was never a
   * reason to grep the file that produces it.
   */
  const messages = require('./engine/messages');
  const block = messages.blockBody();

  assert.match(block, /reply "your message"/, 'the block does not teach the reply command');
  assert.match(block, /from a room or from a person/,
    'the closing rule names one surface, which is how the room rule was learned and the person rule was not');
  assert.match(block, /post <project-id>/, 'the block stopped teaching the room command');
});

test('a reply is escaped on its way to the screen', () => {
  /**
   * 🛑 THE ONE ROW IN THIS THREAD WRITTEN BY SOMETHING OTHER THAN THE OPERATOR,
   * so it is the row where the escape is load-bearing — and the source-grep
   * version passed with `esc()` deleted from it.
   *
   * ⚠️ The renderer is executed here rather than read. `dmRow` needs `esc`,
   * `pjWhenPart`, `pjWhen` and `dmWho`, so they are sliced with it; `CURRENT`
   * is a module-level the function reads, so it is supplied.
   */
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const slice = (name) => {
    const at = page.indexOf(`function ${name}(`);
    assert.notEqual(at, -1, `${name} is not in the page`);
    let d = 0; let i = page.indexOf('{', at);
    for (; i < page.length; i++) { if (page[i] === '{') d++; else if (page[i] === '}') { d--; if (!d) break; } }
    return page.slice(at, i + 1);
  };
  /* ⚠️ A REAL CARD, from the fixture that produces them. The first version
     hand-wrote a two-field stand-in for one and this repo's own lint
     caught it — the same rule that caught a hand-built project member earlier
     today. `CURRENT` is a board card, so it is exactly the class the rule is
     about: a stand-in is free to carry fields the producer never emits. */
  /* Shorthand, which the lint permits and which is what a real construction
     looks like: these are the card's own fields, not invented ones. */
  const pick = ({ sessionName, name }) => ({ sessionName, name });
  const board = fleet.install([fleet.agent('dana')]);
  const card = board.agents.find((a2) => a2.name === 'dana');
  assert.ok(card, 'the fixture produced no card, so the renderer below has no identity');

  // eslint-disable-next-line no-new-func
  const dmRow = new Function(
    'let CURRENT = ' + JSON.stringify(pick(card)) + '; let LAST = []; let YOU_PIC = false; let DISC_TINTS = ["#dfe5ea"]; let DISC_INKS = ["#4a5560"];\n'
    + ['esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'pjAvatarVer', 'discTint', 'discInk', 'discIndex', 'initials', 'dmRow', 'pjRich', 'pjRichSpans', 'pjListDepth'].map(slice).join('\n')
    + '; return dmRow;',
  )();

  const html = dmRow({ from: card.sessionName, text: '<img src=x onerror=alert(1)>', at: new Date().toISOString() }, card.name);
  assert.doesNotMatch(html, /<img src=x/, 'the agent’s reply reaches the page unescaped (the avatar’s own quoted <img src="/api..." is fine; this pins the message’s raw <img src=x)');
  assert.match(html, /&lt;img/, 'the text was dropped rather than escaped');
  assert.match(html, /class="msg"/, 'the agent reply is rendered as a room-style agent bubble (#3414)');
  assert.doesNotMatch(html, /Sent|Placed|Could not/, 'a reply was given a delivery verdict it cannot have');

  // ⚠️ THE CONTROL: the person's own row still renders, and still as theirs.
  const mine = dmRow({ text: 'hi', at: new Date().toISOString(), delivery: { state: 'placed' } }, card.name);
  assert.match(mine, /class="msg you"/, 'the person’s rows stopped rendering as the user bubble');
  fleet.restore();
});

test('a placed message is silent whatever the agent was doing; the did-not-deliver states still speak', () => {
  /**
   * 🔑 THE #3419 RULE. Josh, as a white-collar end user, NEVER wants the
   * needs_you play-by-play about the agent's internal state (card #3419: "No
   * prompt box, no 'Clear this message', no 'It was waiting on an answer when
   * this was sent.' line, ever"). A PLACED message carries NO delivery-status
   * copy at all now -- `placedWords` returns '' -- because the message landed
   * and the row under it says so by existing.
   *
   * 🛑 THIS EXTENDS THE CARD'S EXPLICIT LINE. The card named the "waiting on an
   * answer" line (the engine `waitingNote`, ICK's lane). #3419 extended the same
   * end-user posture to the OTHER placed consequences -- the mid-task "it will
   * not read this until it finishes" and the "could not tell what it was doing"
   * play-by-play -- since all three are the internal-state noise Josh does not
   * want. (An earlier version of this test argued the mid-task line was worth
   * keeping as the answer to "why has nothing happened an hour later"; #3419
   * overrode that. Flagged on the card as a reversible copy call: restoring the
   * mid-task note alone is a one-line change to `placedWords`.)
   *
   * ⚠️ THE POSITIVE CONTROL is the two did-not-deliver arms below: they still
   * speak, so the silence above is the placed rule and not a renderer that
   * prints nothing.
   */
  const board = fleet.install([fleet.agent('dana')]);
  const card = board.agents.find((a2) => a2.name === 'dana');
  const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
  const lift = (n) => page.lift(SCRIPT, n);
  // eslint-disable-next-line no-new-func
  const pjVerdict = new Function(
    ['esc', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict'].map(lift).join('\n')
    + '; return pjVerdict;',
  )();
  const at = new Date().toISOString();
  const say = (delivery) => pjVerdict({ text: 'hi', at, delivery }, card.name);

  const idle = say({ state: 'placed', paneState: 'idle', paneNote: 'it was sitting at its prompt' });
  assert.equal(idle.said, '', 'a placed message carries no delivery-status copy');
  assert.equal(idle.mark, '');
  assert.ok(idle.when && idle.when.length > 1,
    'the time went silent with the sentence it used to live inside');

  // MID-TASK is silent too now: the placed rule does not consult paneState.
  const busy = say({
    state: 'placed', paneState: 'working',
    paneNote: 'it was mid-task, so it will not read this until it finishes',
  });
  assert.equal(busy.said, '',
    'a placed message spoke about the agent being mid-task, the play-by-play #3419 removed');
  assert.equal(busy.mark, '');

  /* An older row carries a note and no state; it is silent as well -- a placed
     message says nothing whatever the paneNote. */
  const older = say({ state: 'placed', paneNote: 'we could not tell what it was doing when this was sent' });
  assert.equal(older.said, '',
    'a placed message with a pane note but no state still printed a receipt');

  /* A placed message with nothing at all stays silent. */
  assert.equal(say({ state: 'placed' }).said, '');

  // The two failure arms are the positive control, and neither carries the time.
  const unsure = say({ state: 'unconfirmed', paneState: 'working', paneNote: 'it was mid-task', because: 'we typed it and could not tell whether it arrived' });
  assert.equal(unsure.mark, ' unsure');
  assert.match(unsure.said, /Could not confirm .* got that/);
  assert.match(unsure.said, /\(it was mid-task\)/, 'the note left the arm that still needs it');
  assert.doesNotMatch(unsure.said, /just now|ago| at /, 'the time is inside the sentence as well as on the row');

  const failed = say({ state: 'could_not', because: 'it is waiting on an answer from you' });
  assert.equal(failed.mark, ' failed');
  assert.match(failed.said, /^Could not deliver: /);
  assert.doesNotMatch(failed.said, /just now|ago| at /, 'the time is inside the sentence as well as on the row');

  fleet.restore();
});

test('the person’s own row carries its time now that the receipt may say nothing', () => {
  const board = fleet.install([fleet.agent('dana')]);
  const card = board.agents.find((a2) => a2.name === 'dana');
  const pick = ({ sessionName, name }) => ({ sessionName, name });
  const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
  const lift = (n) => page.lift(SCRIPT, n);
  // eslint-disable-next-line no-new-func
  const dmRow = new Function(
    'let CURRENT = ' + JSON.stringify(pick(card)) + '; let LAST = []; let YOU_PIC = false; let DISC_TINTS = ["#dfe5ea"]; let DISC_INKS = ["#4a5560"];\n'
    + ['esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'pjAvatarVer', 'discTint', 'discInk', 'discIndex', 'initials', 'dmRow', 'pjRich', 'pjRichSpans', 'pjListDepth'].map(lift).join('\n')
    + '; return dmRow;',
  )();
  const at = new Date().toISOString();
  const mine = dmRow({ text: 'hi', at, delivery: { state: 'placed', paneState: 'idle', paneNote: 'it was sitting at its prompt' } }, card.name);
  assert.match(mine, /class="msg you"/);
  /* #3414: the operator's own row drops the "You" label (matches the room's #3130 rule and
     Josh's UPDATED screenshot -- a user bubble shows only its time). The timestamp now lives
     INSIDE the bubble (.msg-t), so assert the time is present, without "You". */
  assert.match(mine, /class="msg-t">just now/, 'a message that worked lost its timestamp with its receipt');
  assert.doesNotMatch(mine, /Placed into/, 'the receipt Josh asked to have removed is still drawn');
  /* ⚠️ THE CONTROL: a row with a genuine did-not-deliver verdict DOES still say
     it, so the "no receipt on a placed message" assertion above cannot be
     satisfied by a renderer that prints nothing. #3419: placed is silent even
     mid-task now, so the control uses a `could_not` row, which still speaks. */
  const failed = dmRow({ text: 'hi', at, delivery: { state: 'could_not', because: 'it is waiting on an answer from you' } }, card.name);
  assert.match(failed, /Could not deliver/, 'CONTROL: the row cannot say anything at all');
  fleet.restore();
});

test('reports-to names you, is always offered, and never says Nobody', () => {
  /**
   * 🛑 THE CREATE FORM'S RULING ARRIVING ON THE SURFACE THAT MISSED IT. Josh,
   * 2026-08-22: "it defaults to the username, never to Nobody, that shouldn't
   * even be an option." He had already said the same thing for the create form
   * three weeks earlier and this panel kept the old shape, which is the same
   * one-ruling-two-surfaces gap as the delivery receipt.
   *
   * ⚠️ AND THE FIELD NO LONGER DISAPPEARS ON THE FIRST AGENT. The old rule --
   * nobody to name but yourself, so no choice -- was only true while the menu
   * could not name YOU. The person most likely to want to know who is in charge
   * is the one with one agent, and the field was absent exactly there.
   *
   * 📌 THE STORED VALUE IS UNTOUCHED: empty still means no agent above this one.
   * What changed is that the empty value now has an honest name on screen.
   *
   * ⚠️ REAL ROSTERS, from the producer. Hand-written `{ sessionName, name }`
   * literals are what this repo's own lint refuses, and it caught the first
   * version of this test: a stand-in is free to carry fields the route never
   * emits, which is how a renderer gets tested against a shape production
   * cannot produce.
   */
  const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
  const wrap = { hidden: true };
  const sel = { innerHTML: '' };
  const run = (youName, roster, forCard) => {
    // eslint-disable-next-line no-new-func
    new Function('document', 'LAST', 'YOU_NAME', 'esc', 'A', `${page.lift(SCRIPT, 'paintReportsTo')}
      paintReportsTo(A);`)(
      { getElementById: (id) => (id === 'd-reports-wrap' ? wrap : (id === 'd-reports' ? sel : null)) },
      roster, youName, (x) => String(x == null ? '' : x),
      /* ⚠️ THE REAL CARD, not a two-field stand-in for one. The first version
         passed `{ sessionName, profile: {} }` and the lint refused it, rightly:
         the renderer reads fields off this object, and a literal is free to
         carry a shape the route never produces. The fixture's card already
         carries an empty profile, which is the state this test wants. */
      forCard,
    );
  };

  /* ⚠️ `strict: false`, WITH THE REASON, which is the fixture's own contract for
     turning it off. `paintReportsTo` reads `a.profile.reportsTo`, and the route
     does not emit that key for an agent with no reporting line -- in production
     the read is `undefined` and the `typeof === 'string'` guard handles it. The
     strict proxy throws on it instead, so here the proxy is stricter than the
     product, and leaving it on would make this test refuse the ordinary case it
     exists to cover. */
  const alone = fleet.install([fleet.agent('dana')], { strict: false });
  /* One agent on the board: the case the field used to vanish on. */
  run('Josh', alone.agents, alone.agents[0]);
  assert.equal(wrap.hidden, false, 'the field is gone on the first agent, where the answer matters most');
  assert.match(sel.innerHTML, /<option value="">Josh<\/option>/,
    'the first option does not name the person it reports to');
  assert.doesNotMatch(sel.innerHTML, /Nobody/, 'Nobody is still on offer');

  /* With no record of a name, the honest stand-in, which is the org chart's own
     word for the same hub. */
  run('', alone.agents, alone.agents[0]);
  assert.match(sel.innerHTML, /<option value="">You<\/option>/);
  fleet.restore();

  /* And the other agents are still there to choose. */
  const pair = fleet.install([fleet.agent('dana'), fleet.agent('mara')], { strict: false });
  const dana = pair.agents.find((x) => x.sessionName.indexOf('dana') === 0);
  run('Josh', pair.agents, dana);
  assert.match(sel.innerHTML, /value="mara"/,
    'the other agents on the board are no longer offered');
  assert.doesNotMatch(sel.innerHTML, /Nobody/);
  fleet.restore();
});
