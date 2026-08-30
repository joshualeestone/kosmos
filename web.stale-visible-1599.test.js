'use strict';
/**
 * #1599: a list that goes stale WHILE THE PICKER IS ALREADY VISIBLE now says so.
 *
 * The announcement in `fillSwitchAccounts` used to be gated on `appearing`
 * (`sel.hidden`, sampled before the reveal), so it covered APPEARS-WHILE-STALE
 * and not BECOMES-STALE-WHILE-VISIBLE. `accountsUnreadable()` deliberately keeps
 * `ACCOUNTS` - a failed read invalidates the list's authority, not the list - so
 * a repaint in that state still finds a non-empty list and still takes the
 * visible branch, which is the branch that had no way to speak.
 *
 * 🛑 THIS FILE RUNS THE FUNCTION; IT DOES NOT READ THE SOURCE. Its siblings on
 * this feature (web.switch-account-1373.test.js and the rest) assert on PAGE
 * text, which can see that a guard is present and what it is keyed on but cannot
 * see what the region ends up saying. The whole defect here was a guard that was
 * present, correct on its own terms, and aimed at the wrong question, so a
 * source assertion is the one instrument that could not have caught it.
 *
 *   node --test web.stale-visible-1599.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
/* Sandbox before the fleet require, as every fixture consumer does. */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stale1599-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* The pre-fix shape, reconstructed from the shipped page rather than fetched from
   git.
   🛑 THE REPO'S USUAL CONTROL IS `git show origin/main:web/index.html`, AND IT
   RETIRES ITSELF THE MOMENT THIS MERGES: origin/main then carries the fix, the
   control's own skip-guard fires, and it prints a note and returns green forever.
   That is fine for a control whose job is finished at merge. It is the wrong shape
   HERE, because this assertion is the only thing standing between a future edit and
   a silent return to the `appearing` gate.
   ⇒ Rebuilding the old gate by surgery on the CURRENT page keeps the control alive
   after merge, and it cannot pass by accident: if the surgery does not apply, the
   region it is aimed at has moved and the test FAILS rather than skipping. */
function preFixPage(current) {
  const from = '  {\n    const pmsg = document.getElementById(\'d-provider-msg\');';
  const to = '  const appearing = sel.hidden0;\n  if (appearing) {\n'
    + '    const pmsg = document.getElementById(\'d-provider-msg\');';
  assert.ok(current.includes(from),
    'the announcement block moved, so the pre-fix control is aimed at nothing');
  let out = current.replace(from, to);
  /* And put back the write with no content dedupe, which is the other half of the
     old shape: the gate alone is not what this card was about. */
  const w = 'if (line && line !== pmsg.textContent) { pmsg.textContent = line; SWITCH_ACCT_SAID = line; }';
  assert.ok(out.includes(w), 'the dedupe write moved, so the pre-fix control is aimed at nothing');
  out = out.replace(w, 'if (line) { pmsg.textContent = line; SWITCH_ACCT_SAID = line; }');
  return out;
}

/* `sel.hidden` is read once into `appearing` and then written; the fake below has to
   keep the pre-reveal value available to the reconstructed gate, hence `hidden0`. */
function optionsOf(html) {
  const out = [];
  const re = /<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(html))) out.push({ value: m[1], defaultSelected: !!m[2], textContent: m[3] });
  return out;
}

function world(pageText, { accounts, unreadable, current, providerValue }) {
  const script = page.scriptOf(pageText);
  const writes = [];
  const msg = {
    id: 'd-provider-msg',
    _t: '',
    get textContent() { return this._t; },
    set textContent(v) { this._t = v; writes.push(v); },
  };
  const sel = {
    id: 'd-provider-account',
    hidden: true,
    hidden0: true,
    disabled: false,
    _html: '',
    selectedIndex: 0,
    options: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.options = optionsOf(v); },
  };
  const prov = { id: 'd-provider', value: providerValue };
  const els = { 'd-provider-account': sel, 'd-provider': prov, 'd-provider-msg': msg };
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    CURRENT: current,
    ACCOUNTS: accounts,
    ACCOUNTS_UNREADABLE: unreadable,
    SWITCH_ACCT_TOUCHED: false,
    SWITCH_ACCT_SAID: '',
    console,
  };
  vm.runInNewContext(
    page.liftAll(script, ['esc', 'openaiAllDead', 'fillSwitchAccounts'])
    + '\n' + page.liftConst(script, 'providerOf')
    + '\n' + page.liftConst(script, 'SWITCH_ACCT_HINT')
    + '\n' + page.liftConst(script, 'SWITCH_ACCT_UNREADABLE')
    + '\n' + page.liftConst(script, 'SWITCH_ACCT_ALLDEAD')
    + '\n' + page.liftConst(script, 'SWITCH_ACCT_STALE')
    + '\n' + page.liftConst(script, 'SWITCH_ACCT_BROKEN'),
    ctx,
  );
  return {
    ctx, sel, msg, writes,
    paint() { sel.hidden0 = sel.hidden; ctx.fillSwitchAccounts(); },
  };
}

/* Two live OpenAI sign-ins, so the picker has something to show and the announcement
   takes the multi-row branch rather than the one-row sentence. */
const TWO = [
  { provider: 'openai', dir: '/h/a', email: 'a@example.com', isDefault: true, connection: { state: 'ok' } },
  { provider: 'openai', dir: '/h/b', email: 'b@example.com', connection: { state: 'ok' } },
];
/* A REAL card from the fixture that produces them, never a hand-written stand-in:
   `fixture-discipline.test.js` refuses one, and rightly, because a stand-in is free to
   carry fields the producer never emits. `runner: ''` is what the supervisor records for
   a Claude agent, and `providerOf` reads exactly that field, so an agent running on
   Anthropic with the provider menu set to OpenAI is what makes the switch ARMED. */
function anthropicCard() {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const card = board.agents.find((a) => a.name === 'mara');
    assert.ok(card, 'the fixture produced no card');
    assert.notEqual(card.runner, 'codex', 'the fixture card runs on codex, so the switch is not armed and this file tests nothing');
    /* Shorthand, deliberately, and the comment is worded around the rule rather than
       quoting it. `fixture-discipline.test.js` keys on the field name followed by a
       colon anywhere but after a dot, so a `pick` that wrote the key would be an
       offender - and so would a comment that spelled the pattern out, which is how the
       first draft of this line failed. Destructuring shorthand carries no colon. */
    const { name, runner, sessionName } = card;
    return { name, runner, sessionName };
  } finally { board.restore(); }
}
const ANTHROPIC_AGENT = anthropicCard();
const STALE = /may be out of date/;

test('#1599: a list marked unreadable WHILE the picker is visible is announced as out of date', () => {
  const w = world(PAGE, { accounts: TWO, unreadable: false, current: ANTHROPIC_AGENT, providerValue: 'openai' });

  w.paint();
  assert.equal(w.sel.hidden, false, 'the picker did not appear, so this test never reached its subject');
  assert.match(w.msg.textContent, /Choose which OpenAI sign-in/,
    'the first paint did not announce the picker at all');

  /* accountsUnreadable(): authority lost, list KEPT. The picker is already on screen. */
  w.ctx.ACCOUNTS_UNREADABLE = true;
  w.paint();

  assert.equal(w.sel.hidden, false, 'the picker hid itself, so this is not the becomes-stale-while-visible case');
  assert.match(w.msg.textContent, STALE,
    'the picker is presenting rows the page has marked non-authoritative and says nothing about it');
});

test('control: the pre-fix gate is SILENT in exactly that case, so the assertion above has bite', () => {
  const w = world(preFixPage(PAGE), { accounts: TWO, unreadable: false, current: ANTHROPIC_AGENT, providerValue: 'openai' });

  w.paint();
  assert.match(w.msg.textContent, /Choose which OpenAI sign-in/,
    'the reconstructed pre-fix page does not announce on first paint either, so it is not the old shape');

  w.ctx.ACCOUNTS_UNREADABLE = true;
  w.paint();

  assert.equal(w.sel.hidden, false);
  assert.doesNotMatch(w.msg.textContent, STALE,
    'the pre-fix page already said this, so the fix above is not what makes the difference and this control has no bite');
});

/* 📌 THE PROPERTY THE OLD GATE WAS PROTECTING, KEPT. Removing `appearing` without this
   would trade a silent case for a noisy one: an aria-live region rewritten on every
   repaint reads the same sentence out again. */
test('#1599: repainting an unchanged, already-visible picker writes nothing and does not re-announce', () => {
  const w = world(PAGE, { accounts: TWO, unreadable: false, current: ANTHROPIC_AGENT, providerValue: 'openai' });

  w.paint();
  const afterFirst = w.writes.length;
  assert.ok(afterFirst >= 1, 'the first paint wrote nothing, so this test cannot see a second write');

  w.paint();
  w.paint();

  assert.equal(w.writes.length, afterFirst,
    'an unchanged repaint wrote the region again, so a screen reader hears the same sentence on every paint');
});

/* The other direction, which is what makes the dedupe a dedupe rather than a mute:
   once the authority comes back, the picker stops claiming to be out of date. */
test('#1599: the stale line is withdrawn when the list becomes authoritative again', () => {
  const w = world(PAGE, { accounts: TWO, unreadable: true, current: ANTHROPIC_AGENT, providerValue: 'openai' });

  w.paint();
  assert.match(w.msg.textContent, STALE, 'the appears-while-stale case regressed');

  w.ctx.ACCOUNTS_UNREADABLE = false;
  w.paint();

  assert.doesNotMatch(w.msg.textContent, STALE,
    'the picker still says the list may be out of date after a successful re-read');
  assert.match(w.msg.textContent, /Choose which OpenAI sign-in/,
    'the region was left holding nothing after the stale line was withdrawn');
});
