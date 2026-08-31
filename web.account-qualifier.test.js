/**
 * Two config directories can be signed in to ONE email, and the accounts screen
 * used to render both rows under the same name, with two `Disconnect` buttons
 * carrying the same accessible name. `docs/browser-checks/named-controls.js`
 * reported it as `settings: accounts: Disconnect josh@book.io x2`.
 *
 * Measured on this machine 2026-08-28 before the fix: four rows from
 * `accounts.list()`, and `josh@book.io` held two of them (`~/.claude`, the
 * default, and `~/.claude-account-d`). It is not a fixture condition.
 *
 * These pin the PROPERTY the screen promises, not a literal label, so renaming
 * the qualifier does not red them and losing the disambiguation does.
 *
 *   node --test web.account-qualifier.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Extracted and RUN, not matched by regex. A regex cannot call a function, so a
   pattern check would pass over a body that throws or returns nothing. */
function loadQualifiers() {
  const at = PAGE.indexOf('function accountQualifiers(');
  assert.notEqual(at, -1, 'accountQualifiers is gone from the page');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  return new Function(src + '; return accountQualifiers;')();
}
const qualifiers = loadQualifiers();

const DEFAULT_ROW = { email: 'josh@book.io', dir: '/Users/x/.claude', label: null, isDefault: true };
const SECOND_ROW  = { email: 'josh@book.io', dir: '/Users/x/.claude-account-d', label: 'account-d', isDefault: false };
const OTHER       = { email: 'josh@stuff.io', dir: '/Users/x/.claude-b', label: 'b', isDefault: false };

test('a name only one row carries is left exactly as it was', () => {
  const q = qualifiers([DEFAULT_ROW, OTHER]);
  assert.equal(q.get(DEFAULT_ROW.dir), '', 'a unique name picked up a qualifier, which is noise on the common case');
  assert.equal(q.get(OTHER.dir), '', 'a unique name picked up a qualifier');
});

test('when two rows share a login, BOTH are named, and differently', () => {
  const q = qualifiers([DEFAULT_ROW, SECOND_ROW, OTHER]);
  const a = q.get(DEFAULT_ROW.dir);
  const b = q.get(SECOND_ROW.dir);
  assert.notEqual(a, '', 'the default row is anonymous beside its twin, so a person cannot tell which is which');
  assert.notEqual(b, '', 'the second row is anonymous beside its twin');
  assert.notEqual(a, b, 'both rows got the SAME qualifier, so the two controls still answer to one name');
  assert.equal(q.get(OTHER.dir), '', 'an unrelated unique row was qualified because two OTHER rows collided');
});

/* The qualifier has to be total for a duplicated row. `list()` skips a directory
   it has already seen, so distinct rows always have distinct `dir`s, and `dir`
   is the last fallback -- but a row with no label must still come out named,
   because an empty qualifier puts the two controls back on one name. */
test('a duplicated row with no label still comes out named', () => {
  const bare = { email: 'josh@book.io', dir: '/Users/x/.claude-nolabel', label: null, isDefault: false };
  const q = qualifiers([DEFAULT_ROW, bare]);
  assert.notEqual(q.get(bare.dir), '', 'a duplicated row with no label came out unnamed, so its control shares a name again');
  assert.notEqual(q.get(bare.dir), q.get(DEFAULT_ROW.dir), 'the fallback produced the same name as its twin');
});

/* OpenAI rows are named by the key tail, not an email. Two key tails that match
   are the same collision wearing a different field. */
test('the key-tail rows collide on the name the SCREEN shows, not on email', () => {
  const k1 = { provider: 'openai', keyTail: '9f2a', dir: '/Users/x/.claude-k1', label: 'k1' };
  const k2 = { provider: 'openai', keyTail: '9f2a', dir: '/Users/x/.claude-k2', label: 'k2' };
  const q = qualifiers([k1, k2]);
  assert.notEqual(q.get(k1.dir), q.get(k2.dir), 'two rows showing one key tail are still indistinguishable');
  assert.notEqual(q.get(k1.dir), '', 'a duplicated key-tail row was left unqualified');
});

/* CONTROL. Every assertion above is about a Map this function returns, so a
   function that returned an empty Map would fail them loudly rather than pass
   quietly -- but nothing above proves the extraction found the REAL function
   instead of some other body. This does: a list with a known collision must
   produce a non-empty qualifier, and a list with none must produce all empty.
   Both arms, so agreement means something. */
test('control: the extracted function discriminates in both directions', () => {
  const collide = qualifiers([DEFAULT_ROW, SECOND_ROW]);
  const clean = qualifiers([DEFAULT_ROW, OTHER]);
  const collideNames = [...collide.values()].filter(Boolean);
  const cleanNames = [...clean.values()].filter(Boolean);
  assert.equal(collideNames.length, 2, 'the collision arm produced ' + collideNames.length + ' qualifiers, so this suite is not testing what it thinks');
  assert.equal(cleanNames.length, 0, 'the clean arm produced qualifiers, so the function qualifies unconditionally and the tests above are vacuous');
});

/* The screen half. The control's accessible name is what named-controls reads and
   what a screen reader announces, and it is a different string from the visible
   row, so it needs its own pin.
   🛑 BOTH BUTTONS, AND THE SECOND ONE IS WHY THIS IS TWO ASSERTIONS RATHER THAN
   ONE. The row builder had two branches: Anthropic rows a disabled `Disconnect`,
   OpenAI rows a live `Remove` (#1372 made it real earlier the same day).
   📌 THAT SPLIT IS GONE AS OF #1659: both providers now read `Disconnect`, both
   are live, and the DEFAULT Anthropic row is the only dead one. The history is
   kept because it explains why this is two assertions: the first version of the
   fix qualified `Disconnect` and left `Remove` naming itself by login alone, so
   the defect survived intact on the
   OpenAI arm while the visible span made the screen LOOK disambiguated. Angel
   caught it in review, on the exact case the key-tail test above constructs.
   ⇒ A guard covering one of two branches is how the other branch stays broken. */
test('the Disconnect control carries the qualifier, escaped, because that is the name the check reads', () => {
  assert.match(PAGE, /aria-label="Disconnect ' \+ who \+ \(qual \? ' \(' \+ esc\(qual\) \+ '\)' : ''\)/,
    'the Disconnect button either dropped the qualifier (two of them answer to one name again) or stopped escaping it (a directory name with a quote breaks out of the attribute)');
});

/* 🔑 #1659 RELABELLED THE OPENAI CONTROL FROM "Remove" TO "Disconnect", so this
   arm can no longer name its branch by its label: all three controls (OpenAI,
   the live Claude row, and the DISABLED default row) now read "Disconnect".
   ⇒ IT COUNTS INSTEAD. Every acct-disconnect button must carry the qualifier,
   so a branch added or edited without it drops the count and this goes red --
   which is the property the original two-arm version was protecting, kept
   rather than weakened into a single match that any one branch could satisfy. */
/* 🛑 #1659: THE TWO DISCONNECT BRANCHES, ASSERTED IN THE SOURCE. The real
   assertions that the default row is DISABLED and the others are LIVE live in
   the browser gate, which does not run under `yarn test`. So inverting
   `a.isDefault`, or dropping `disabled`, would keep the node suite green and
   ship a live Disconnect on ~/.claude -- the one row every user has, and the
   one the engine refuses. This is the cheap merge-time floor under that. */
/* 🛑 THIS TEST USED TO READ THE BRANCH'S TEXT AND COULD NOT SEE ITS GUARD.
   It sliced the disabled branch out of the page source and asserted the slice
   was `disabled` and carried no `data-forget`. Both are true of the branch no
   matter WHICH row reaches it, so inverting `a.isDefault` to `!a.isDefault`
   left every assertion green -- the default row got a live Disconnect the
   engine refuses on every click, and every removable account got a permanently
   dead one, with nothing red.
   ⭐ AND THE PERTURBATIONS THAT "VERIFIED" IT MISSED FOR ONE REASON: they broke
   the branch BODY (added data-forget, dropped disabled) and never the branch
   SELECTOR. A slice cannot see the condition that chooses it.
   ✅ SO IT RUNS THE BRANCH NOW instead of reading it: the ternary is extracted
   from the page and evaluated against a default row and a non-default row, and
   the two rendered strings are asserted separately. Inverting the guard swaps
   them and both assertions fail. */
/* 🛑 ONE FACT, TWO DERIVATIONS, NOTHING RECONCILING THEM. The default-refusal
   sentence is written in engine/accounts.js (what the API answers) and again in
   web/index.html (what the tooltip says). They have already drifted once during
   this card's own review, and because the button is disabled the engine's copy
   is unreachable from the UI for this case, so nothing would ever reveal a
   mismatch. This pins them until somebody gives the page a single source. */
/* 🛑 THE NO-OP HANDLER HAD NO GUARD AT ANY LAYER. Deleting the loop silently
   restores the state this branch found and fixed mid-review: the default row's
   control stays focusable and pressable and produces NOTHING on Enter or Space.
   The browser check reads that row's STATE (aria-disabled, forgets) and never
   presses it, so nothing downstream would catch the deletion either.
   📌 Same cheap merge-time floor already used for `data-forget-provider` and the
   `a.isDefault` branch: a browser-only property, pinned in source. */
test('#1659: the disabled default control has a handler, so a keypress is not silent', () => {
  assert.match(PAGE, /querySelectorAll\('\.acct-disconnect\[aria-disabled="true"\]'\)/,
    'the no-op handler binding is gone, so the focusable default button does nothing on Enter or Space with no feedback');
  assert.match(PAGE, /msg\.textContent = say;/,
    'the handler no longer writes the refusal into the message line, so pressing it is silent');
});

test('#1659: the engine refusal and the page tooltip say the SAME thing', () => {
  const engine = fs.readFileSync(path.join(__dirname, 'engine', 'accounts.js'), 'utf8');
  /* ⚠️ ANCHOR THE PAGE ON `title="`, NOT ON THE SENTENCE. The aria-label carries
     a deliberately SHORTER form of the same refusal (a label should be terse;
     the tooltip carries the whole thing), so the page holds two occurrences and
     a bare indexOf finds the label's. Pinning the label to the engine's full
     sentence would force the two to be identical, which is the wrong contract. */
  const pull = (text, anchor) => {
    const at = text.indexOf(anchor);
    assert.ok(at > -1, 'the default-refusal sentence is gone from one of the two files');
    const rest = text.slice(at + anchor.length - 'Kosmos does not remove'.length);
    const end = rest.indexOf('inside it.');
    assert.ok(end > -1, 'the sentence no longer ends where both copies expect');
    /* ⚠️ NORMALISE THE ENCODING, NOT ONLY THE WHITESPACE. Without this the test
       compares SOURCE SPELLINGS: `computer\u2019s` in one file and a literal
       curly apostrophe in the other would fail while rendering identically, so
       the guard would fire on a difference no person could see. */
    const unescape = (t) => t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return unescape(rest.slice(0, end + 'inside it.'.length).replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' '));
  };
  assert.equal(pull(engine, 'Kosmos does not remove'), pull(PAGE, 'title="Kosmos does not remove'),
    'the engine refusal and the page tooltip have drifted; a person would be told two different things about one act');
});

test('#1659: the default row renders DISABLED and a non-default row renders LIVE', () => {
  const at = PAGE.indexOf(': (a.isDefault');
  assert.ok(at > -1, 'the default-vs-live ternary is gone from acctRowHtml');
  /* +1 for the paren that closes `(a.isDefault ... )` itself: the end token is
     the LIVE branch's tail followed by `))`, and the slice needs exactly one of
     those two. Measured rather than guessed (open 10, close 9 without it). */
  const endAt = PAGE.indexOf(">Disconnect</button>'))", at);
  assert.ok(endAt > at, 'the ternary no longer closes the way this extraction expects');
  const body = PAGE.slice(at + 2, endAt + ">Disconnect</button>'".length + 1);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  const render = new Function('a', 'who', 'qual', 'esc', `return ${body};`);

  const onDefault = render({ isDefault: true, dir: '/h/.claude' }, 'main@example.com', '', esc);
  const onOther = render({ isDefault: false, dir: '/h/.claude-walk' }, 'walk@example.com', '', esc);

  /* 🛑 ANCHOR ON THE EXACT SPELLING. `/disabled/` matched the SUBSTRING inside
     `aria-disabled`, so the moment the markup moved from the native attribute to
     the ARIA one this floor silently stopped discriminating: it could no longer
     tell "the row is inert" from "the row carries an ARIA hint and nothing
     else", and the browser arm that DID depend on the difference went red
     unnoticed. Both spellings are pinned separately now. */
  assert.match(onDefault, /aria-disabled="true"/,
    'the DEFAULT row is no longer marked aria-disabled, so ~/.claude gets a button the engine refuses on every click');
  assert.ok(!/(^|\s)disabled(?=[\s>'"])/.test(onDefault),
    'the DEFAULT row went back to the NATIVE disabled attribute, which drops it out of the tab order so a keyboard user never reaches the reason');
  assert.ok(!/data-forget=/.test(onDefault),
    'the DEFAULT row now carries data-forget, so the shared handler fires on a row the engine refuses');
  assert.match(onOther, /data-forget="\/h\/\.claude-walk"/,
    'a NON-default row lost its data-forget, so a removable account cannot be removed');
  assert.ok(!/disabled/.test(onOther),
    'a NON-default row carries a disabled or aria-disabled marking, so a removable account got a dead button');

  /* 🛑 THE PROVIDER MARKER WAS GUARDED BY NOTHING AT ANY LAYER. The handler
     reads the endpoint off `data-forget-provider`, and since it now REFUSES an
     unmarked button rather than defaulting to OpenAI, dropping or misspelling
     this attribute ships a Claude Disconnect that renders live, is pressable,
     and only prints "we could not tell which provider" -- the exact
     nothing-that-looks-live-may-do-nothing shape this file refuses. Measured:
     misspelling it left the whole node suite AND the browser gate green, because
     the gate pins only the OPENAI marker. Same reasoning as the a.isDefault
     floor above: a browser-only property, so pin it here. */
  assert.match(onOther, /data-forget-provider="claude"/,
    'the live Claude row lost its provider marker, so the shared handler cannot route it and the button does nothing');
  assert.ok(!/data-forget-provider=/.test(onDefault),
    'the disabled default row now carries a provider marker, which only a wired button should have');

  /* The OpenAI branch sits outside the extracted ternary, so it is pinned in
     source rather than executed. Without this, the same misspelling on the
     other provider is equally invisible. */
  assert.match(PAGE, /data-forget-provider="openai"/,
    'the OpenAI row lost its provider marker, so its Disconnect cannot route either');
});

test('EVERY Disconnect control carries the qualifier, escaped, or one branch keeps the whole defect', () => {
  const qualified = (PAGE.match(/aria-label="Disconnect ' \+ who \+ \(qual \? ' \(' \+ esc\(qual\) \+ '\)' : ''\)/g) || []).length;
  const controls = (PAGE.match(/class="acct-disconnect"/g) || []).length;
  assert.ok(controls >= 3,
    `expected the three disconnect branches (OpenAI, live Claude, disabled default); found ${controls}`);
  assert.equal(qualified, controls,
    `${controls - qualified} disconnect control(s) name themselves by login alone (two rows sharing a key tail give two controls with one name) or interpolate the qualifier unescaped into the attribute`);
});

/* Angel's review, kept as an arm rather than a comment. The map was keyed on the
   row OBJECT, which is correct today and silently wrong the moment anyone maps,
   clones or spreads rows on the way in: every lookup misses, every qualifier
   becomes '', and the screen is back to the original bug with nothing thrown.
   Keyed on `dir`, a clone resolves exactly like the original. */
test('a CLONED row still resolves, so an unrelated map() cannot empty the qualifiers', () => {
  const q = qualifiers([DEFAULT_ROW, SECOND_ROW].map((r) => ({ ...r })));
  assert.equal(q.get(DEFAULT_ROW.dir), 'main',
    'a cloned row lost its qualifier, so the lookup is keyed on identity again and any map() upstream silently restores the bug');
  assert.equal(q.get(SECOND_ROW.dir), 'account-d',
    'a cloned row lost its qualifier');
});

/* `main` is the reserved qualifier for the default row. A non-default directory
   literally named `.claude-main` yields the label `main`, so before the guard
   both the default and that row answered to `... (main)` and the two controls
   were back on one name. The non-default row must fall back to its unique `dir`. */
test('a non-default row labelled "main" does not collide with the default row', () => {
  const clashMain = { email: 'josh@book.io', dir: '/Users/x/.claude-main', label: 'main', isDefault: false };
  const q = qualifiers([DEFAULT_ROW, clashMain]);
  assert.equal(q.get(DEFAULT_ROW.dir), 'main', 'the default row lost its reserved qualifier');
  assert.notEqual(q.get(clashMain.dir), '', 'the clashing row came out unnamed, so its control shares a name again');
  assert.notEqual(q.get(clashMain.dir), q.get(DEFAULT_ROW.dir),
    'a non-default row named "main" collided with the default, reintroducing the one-name-two-controls bug');
});

/* `list()` gives sibling directories distinct basenames, so two non-default rows
   in one group cannot share a label today. But this function is pure and
   exported, so it must guarantee distinctness itself rather than lean on a
   caller's invariant: two rows with the same label must still come out named
   differently, falling back to their unique `dir`. */
test('two non-default rows sharing a label do not collide either', () => {
  const a = { email: 'josh@book.io', dir: '/Users/x/.claude-dup', label: 'dup', isDefault: false };
  const b = { email: 'josh@book.io', dir: '/Users/y/.claude-dup', label: 'dup', isDefault: false };
  const q = qualifiers([a, b]);
  assert.notEqual(q.get(a.dir), '', 'a duplicated row came out unnamed');
  assert.notEqual(q.get(b.dir), '', 'a duplicated row came out unnamed');
  assert.notEqual(q.get(a.dir), q.get(b.dir),
    'two rows with the same label produced the same qualifier, so their controls share a name again');
});

/* The buttons are pinned to esc(qual) above, but the visible span and its
   tooltip are the other two surfaces the qualifier reaches, and a directory name
   is not Kosmos-sanitized. Pin esc() on all four, so a future edit dropping it
   from either surface reds a test rather than rendering raw. */
test('the visible qualifier and its tooltip are escaped too, not only the buttons', () => {
  assert.match(PAGE, /'">' \+ esc\(qual\) \+ '<\/span>'/,
    'the visible qualifier span dropped esc(), so a directory name with markup would render raw');
  assert.match(PAGE, /class="acct-qual" title="' \+ esc\(/,
    'the qualifier tooltip is no longer wrapped in esc(), so the login renders raw in the title attribute');
});
