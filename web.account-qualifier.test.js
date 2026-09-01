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
  assert.match(PAGE, /aria-label="Disconnect ' \+ who \+ ' \(' \+ esc\(qualName\) \+ '\)'/,
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
  /* 🛑 ANCHOR IT TO THE DEFERRED WRITE. A bare /msg\.textContent = say;/ IS UNANCHORED
     and the page holds THREE occurrences: this one, plus `dmsg.textContent = say;` and
     `rmsg.textContent = say;` in unrelated code. Measured: deleting the real line left
     every web*.test.js green at 909 pass, so the assertion could not fail for the
     property its own message names. The sibling assertion above pins the loop's
     EXISTENCE; only its body was unpinned. */
  assert.match(PAGE, /acctSayTimer = setTimeout\([\s\S]{0,200}?msg\.textContent = say;/,
    'the handler no longer writes the refusal into the message line on the deferred '
    + 'timer, so pressing the disabled default button is silent');
});

test('#1659: the tooltip and the route make the SAME history promise', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  /* 🔑 PIN THE CLAIM, NOT THE SENTENCE. These two are deliberately NOT identical:
     the tooltip PROMISES before the press ("Takes this account off the list") and
     the route REPORTS after it ("That account is off the list"). Forcing them to
     match whole would encode the wrong contract, exactly as pinning the aria-label
     to the engine's full refusal would in the test above.
     What must not drift is the consequence they both assert, which is the only part
     a person acts on and the only part that can become false: it holds because
     `status.js:198` skips anything not named `.claude` or `.claude-*`, so the
     renamed `.removed-claude-*` really does stop being read. */
  const CLAIM = 'Kosmos stops looking inside it, so any history kept only there will not appear any more.';
  const flat = (t) => t.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  /* 🛑 ANCHOR ON THE CLAUDE ROUTE'S OWN WORDING. A bare `includes(CLAIM)` PASSES
     ON THE OPENAI ROUTE'S COPY, which carries the same sentence for its default
     account. Measured: breaking the Claude copy alone left this green until the
     prefix was added, so the assertion was satisfied by a line it was not about. */
  assert.ok(flat(server).includes('so nothing was deleted. ' + CLAIM),
    'the CLAUDE route no longer makes the history promise, so the tooltip promises '
    + 'something the person is never told actually happened');
  assert.ok(flat(PAGE).includes(CLAIM),
    'the tooltip no longer makes the history promise the route reports, so the two copies '
    + 'of one claim have drifted with nothing to say so');
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
  /* `qualName` joins the signature because #1659 made the accessible name ALWAYS
     carry a parenthetical, falling back to the provider when the ambiguity
     qualifier is empty. This test EXECUTES the ternary rather than reading it,
     so a new free variable is a ReferenceError rather than a silent pass. That
     is the property worth having: it caught the change instead of ignoring it. */
  const render = new Function('a', 'who', 'qual', 'qualName', 'esc', `return ${body};`);

  const onDefault = render({ isDefault: true, dir: '/h/.claude' }, 'main@example.com', '', 'Claude', esc);
  const onOther = render({ isDefault: false, dir: '/h/.claude-walk' }, 'walk@example.com', '', 'Claude', esc);

  /* 🛑 ANCHOR ON THE EXACT SPELLING. `/disabled/` matched the SUBSTRING inside
     `aria-disabled`, so the moment the markup moved from the native attribute to
     the ARIA one this floor silently stopped discriminating: it could no longer
     tell "the row is inert" from "the row carries an ARIA hint and nothing
     else", and the browser arm that DID depend on the difference went red
     unnoticed. Both spellings are pinned separately now. */
  assert.match(onDefault, /aria-disabled="true"/,
    'the DEFAULT row is no longer marked aria-disabled, so ~/.claude gets a button the engine refuses on every click');
  /* 🛑 `(\b|$)`, NOT A LOOKAHEAD FOR `[\s>'"]`. That lookahead required the attribute
     to be followed by whitespace, `>` or a quote, and `=` IS IN NONE OF THEM. So it
     caught the BARE `disabled` (the spelling that happened to ship) and MISSED
     `disabled=""` and `disabled="disabled"`. Measured with the empty-value spelling
     planted: 914 pass, 0 fail, NO named test red, while the rendered row was natively
     disabled, out of the tab order, its no-op handler unreachable, and its fallback
     style 3.77:1 on the light surface, under AA. Controls: `aria-disabled="true"`
     alone, and a class containing "disabled", both correctly still fail to match. */
  assert.ok(!/(^|\s)disabled(\b|$)/.test(onDefault),
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
  const qualified = (PAGE.match(/aria-label="Disconnect ' \+ who \+ ' \(' \+ esc\(qualName\) \+ '\)'/g) || []).length;
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

/* 🛑 THE FALLBACK IS A FOURTH COPY OF THE REFUSAL AND WAS PINNED BY NOTHING. The
   drift test above anchors on `title="`, so it pins the TITLE against the engine
   and leaves the JS fallback (`btn.title || '...'`) free to diverge. That literal
   is what a screen-reader user hears on the day somebody drops the title from
   that branch, which is the case the fallback exists for, so it is the copy least
   likely to be noticed when it goes stale. */
test('#1659: the aria-disabled handler fallback says the SAME thing as the engine refusal', () => {
  const m = PAGE.match(/btn\.title \|\| '([^']+)'/);
  assert.ok(m, 'the aria-disabled handler no longer carries a fallback sentence; re-anchor this test');
  /* 🔑 DECODE BOTH SIDES. My first version decoded the page and compared against
     RAW engine source, which stores the same sentence with a literal \u2019
     escape. It failed, and the failure looked exactly like a drift. Same error
     the sibling drift test above already avoids by normalising both sides: a
     comparison that decodes one side is measuring two different worlds. */
  const un = (x) => x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const fallback = un(m[1]);
  const engine = un(require('fs').readFileSync(require('path').join(__dirname, 'engine', 'accounts.js'), 'utf8'));
  assert.ok(engine.indexOf(fallback.slice(0, 48)) > -1,
    'the handler fallback and the engine refusal have drifted: a person pressing the disabled row hears one sentence and the engine says another. fallback: ' + fallback);
});

/* 🛑 THE ONE SENTENCE A SCREEN-READER USER HEARS ABOUT THE DISABLED ROW, AND IT
   WAS PINNED BY NOTHING. The default row's aria-label carries the reason as a
   suffix, because a `title` on a control announced as unavailable is not read out.
   The qualifier assertion above matches only the label's PREFIX, so the appended
   clause is invisible to it, and the browser gate captures innerText, disabled,
   ariaDisabled, data-forget and the row text but never aria-label.
   ⇒ Measured before this was written: deleting the clause left every web test
   green. Same prefix-match shape this branch found on the OpenAI success sentence,
   in the half that only a screen-reader user experiences. */
test('#1659: the disabled default row explains itself IN THE ACCESSIBLE NAME, not only in a title', () => {
  const at = PAGE.indexOf(': (a.isDefault');
  assert.ok(at > -1, 'the default-vs-live ternary is gone; re-anchor this test');
  const endAt = PAGE.indexOf(">Disconnect</button>'))", at);
  const body = PAGE.slice(at + 2, endAt + ">Disconnect</button>'".length + 1);
  assert.match(body, /Unavailable: /,
    'the default row no longer says WHY in its accessible name, so a screen-reader user hears a name with no reason');
  /* Paired with the engine, so the two cannot drift into saying different things. */
  const un = (x) => x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  /* Ends at `."` because the clause closes an HTML ATTRIBUTE, not a JS string.
     My first version anchored on `.'` and failed, and the failure read exactly
     like the clause being absent. Third time today a test of mine has failed in a
     way that looked like a finding: check the raw text before believing your own
     assertion. */
  const m = un(body).match(/Unavailable: ([^"']+?)\."/);
  assert.ok(m, 'the Unavailable clause is no longer a literal this test can read; re-anchor it');
  const engine = un(require('fs').readFileSync(require('path').join(__dirname, 'engine', 'accounts.js'), 'utf8'));
  assert.ok(engine.indexOf(m[1].slice(0, 40)) > -1,
    'the accessible-name reason and the engine refusal have drifted: ' + m[1]);
});

/* 🛑 THE FOCUS TARGET MUST BE FOCUSABLE, and nothing checked. After a removal the
   repaint destroys the button the person was standing on, so the handler moves
   focus to #set-accounts. In a real browser `.focus()` on a div with NO tabindex
   is a silent no-op, and the unit fixture cannot catch that: its stub records
   `focused: true` unconditionally, whatever the markup says.
   ⇒ Two ends pinned, join uncovered: removing the attribute left every web test
   green while the post-repaint focus recovery silently stopped working. */
test('#1659: the post-removal focus target carries tabindex, or .focus() is a silent no-op', () => {
  assert.match(PAGE, /<div id="set-accounts" tabindex="-1"><\/div>/,
    'the account list is no longer programmatically focusable, so focus stays on <body> after the repaint '
    + 'and a keyboard user loses their place, while the unit fixture still reports focused:true');
  /* Paired with the handler, so the attribute cannot outlive the code that uses
     it, which is how the previous tabindex on the message line became dead. */
  assert.match(PAGE, /getElementById\('set-accounts'\)[\s\S]{0,200}?\.focus\(/,
    'nothing focuses #set-accounts any more, so the tabindex above is dead weight');
});

/* 🛑 THE PROVIDER FALLBACK ITSELF, which the executed-ternary test cannot reach
   because it PASSES qualName IN as a parameter: the derivation that computes it is
   never run. Measured: replacing `qual || (isOpenai ? 'OpenAI' : 'Claude')` with
   plain `qual` left every web test green, and the regression it ships is an
   accessible name reading `Disconnect walk@example.com ()`.
   📌 A SOURCE-level pin, and labelled as one. The rendered half is covered by the
   executed ternary above; this covers the half that feeds it, which is the only
   part a parameterised fixture structurally cannot see. */
test('#1659: qualName falls back to the PROVIDER, so no row can render an empty parenthetical', () => {
  assert.match(PAGE, /const qualName = qual \|\| \(isOpenai \? 'OpenAI' : 'Claude'\)/,
    'the provider fallback is gone, so a row yielding neither an email nor a key tail renders '
    + '"Disconnect <who> ()" and two such rows answer to the same name again');
});

/* 🛑 THE DISABLED ROW MUST LOOK DISABLED, and the rule was pinned by nothing.
   Measured: deleting `.acct-disconnect[aria-disabled="true"]` left every web test
   green, and the browser gate asserts the ATTRIBUTE rather than the appearance. The
   default row would then inherit the base style, full opacity and underlined with a
   pointer cursor, and render identically to the live controls next to it.
   ⚠️ The opacity is load-bearing for contrast, not taste: .8 clears AA for 13px
   text at 4.82:1 and .7 does not at 3.77:1, which is why this arm pins the VALUE
   and not merely the selector. */
test('#1659: the aria-disabled control has its own styling, at the opacity the contrast comment measured', () => {
  assert.match(PAGE, /\.acct-disconnect\[aria-disabled="true"\][^}]*opacity: \.8/,
    'the aria-disabled rule is gone or its opacity changed: the dead control now looks identical to the live '
    + 'ones, or it dropped below the AA threshold the comment above it measured');
});

/* 🛑 BROWSER-ONLY BEHAVIOURS WITH NO FLOOR ANYWHERE. Measured: deleting the
   catch-path `btn.focus(...)` AND all three `msg.scrollIntoView(...)` calls leaves
   the entire suite green. Neither is observable to the unit fixtures (their stubs
   have no layout and no focus model) and the browser gate asserts neither.
   ⇒ Source pins, the same class already used for `tabindex="-1"`, the
   aria-disabled opacity and the provider marker. They are floors, not proofs: they
   catch deletion, which is the failure that actually happened to their siblings.
   The catch-path focus restore matters most: it is what stops a keyboard or
   screen-reader user being stranded on <body> while the refusal naming the
   blocking agents renders below every account box. */
test('#1659: the failure path restores focus, and every message write scrolls itself into view', () => {
  /* Anchored on the call alone, not on adjacency to the disarm: a 15-line comment
     sits between them, and my first version required them on consecutive lines and
     failed. The call is unique in this file, so the looser anchor is not weaker. */
  assert.match(PAGE, /if \(btn\.focus\) btn\.focus\(\{ preventScroll: true \}\)/,
    'the catch path no longer restores focus, so a refused removal leaves a keyboard user on <body> '
    + 'while the sentence naming the blocking agents renders far below them');
  const scrolls = (PAGE.match(/msg\.scrollIntoView\(\{ block: 'nearest' \}\)/g) || []).length;
  assert.ok(scrolls >= 3,
    'a message write lost its scrollIntoView: the account list is long, so the line the person must '
    + 'act on renders off-screen. found ' + scrolls + ', expected at least 3');
});

test('#1659: the reauth label is CONDITIONAL while Disconnect is not, on purpose', () => {
  /* 🔑 PINNING AN ASYMMETRY, NOT A STRING. `qualName` falls back to the provider name
     so a Disconnect always says which account it removes; reauth appears on Claude rows
     ONLY, so the same fallback there is verbosity that can never disambiguate. That is a
     decision, and an unpinned decision reads as a leftover to the next person, who will
     "fix" the inconsistency in whichever direction they meet first. */
  assert.match(PAGE, /Sign in again as ' \+ who \+ \(qual \?/,
    'the reauth label no longer uses the conditional qualifier, so every ordinary machine '
    + 'announces "(Claude)" on a control that only ever appears on Claude rows');
  assert.doesNotMatch(PAGE, /Sign in again as ' \+ who \+ ' \(' \+ esc\(qualName\)/,
    'the reauth label took the unconditional provider fallback that belongs on Disconnect');
});

test('#1659: EVERY live Disconnect explains itself before the press, on both providers', () => {
  /* 🔑 THE TOOLTIP IS THE SURFACE READ BEFORE ACTING, and it was the last place the two
     providers still disagreed: Claude carried a reassurance and OpenAI carried none, for
     the same act under the same word. This branch already closed that asymmetry one layer
     down by porting `movedTo` onto the OpenAI route; this is the same fix on the surface
     the person actually reads first.
     ⚠️ Pinned on the SHARED half only. The history clause is default-only for OpenAI, so
     requiring the identical sentence would force a claim that is false for every labelled
     account. */
  const SHARED = 'so nothing is deleted';
  /* 🛑 STRIP COMMENTS FIRST, AND DO NOT MEASURE THE GAP IN CHARACTERS. The first
     version of this matched a fixed 900-character window from the anchor, so adding a
     comment between the anchor and the title pushed the title out of range and the test
     went red on a change that improved the code. A window measured in characters is a
     window measured in prose. */
  /* BOTH comment forms. Stripping only block comments left the adjacency lookback
     below spanning a long `//` block, so the first writer read as unguarded when its
     cancel was merely further away in PROSE than in code. Line comments are removed
     only when the line STARTS with `//`, so a `https://` inside a string survives. */
  const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const live = CODE.match(/<button class="acct-disconnect" type="button" data-forget=[\s\S]*?<\/button>/g) || [];
  assert.ok(live.length >= 2,
    'fewer than two live Disconnect branches were found, so this test is not looking at '
    + 'what it claims to look at. found: ' + live.length);
  for (const b of live) {
    const provider = (b.match(/data-forget-provider="(\w+)"/) || [])[1] || '(none)';
    assert.ok(b.includes('title="'),
      'the ' + provider + ' Disconnect carries no title, so a person gets a reassurance '
      + 'before pressing on one provider and nothing on the other');
    assert.ok(b.includes(SHARED),
      'the ' + provider + ' Disconnect no longer says nothing is deleted, which is the '
      + 'half that is true of both providers');
  }
});

test('#1659: the OpenAI tooltip carries the history clause PER ROW, not unconditionally', () => {
  /* The consequence is default-only for OpenAI, so both directions are wrong in a way
     a person feels: unconditional tells a labelled account it loses history it never
     had, and absent lets the DEFAULT row read as consequence-free before the press and
     then gain a consequence after it. The route already decides this per row; the
     tooltip is the surface read FIRST and must agree. */
  /* BOTH comment forms. Stripping only block comments left the adjacency lookback
     below spanning a long `//` block, so the first writer read as unguarded when its
     cancel was merely further away in PROSE than in code. Line comments are removed
     only when the line STARTS with `//`, so a `https://` inside a string survives. */
  const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const openai = CODE.match(/data-forget-provider="openai"[\s\S]*?>Disconnect<\/button>/);
  assert.ok(openai, 'the OpenAI Disconnect branch was not found, so this test asserts nothing');
  assert.match(openai[0], /a\.isDefault \?[\s\S]{0,160}stops looking inside it/,
    'the OpenAI tooltip states the history consequence unconditionally or not at all. '
    + 'Unconditional is false for every labelled account; absent means the default row '
    + 'reads consequence-free before the press and gains one after it');
});

test('#1659: the repaint path CANCELS the pending announcement, all writers', () => {
  /* 🛑 THE UNCOVERED HALF. The handler-side cancels are pinned by ask-first-1683
     (it records the stub rather than no-oping it), and the paintAccounts-side ones were
     guarded by nothing: deleting all three left the web suite green at 911 pass. That is
     the same mechanism this branch already had to fix mid-review, and the comment above
     it claims EVERY writer cancels, a claim that has been wrong three times.
     Pinned as a floor on the count, matching how this file already pins the other
     browser-only properties: they catch DELETION, which is the failure that actually
     happened to their siblings. */
  /* BOTH comment forms. Stripping only block comments left the adjacency lookback
     below spanning a long `//` block, so the first writer read as unguarded when its
     cancel was merely further away in PROSE than in code. Line comments are removed
     only when the line STARTS with `//`, so a `https://` inside a string survives. */
  const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* 🛑 COUNT BRACES, DO NOT REGEX A FUNCTION BODY. My first version matched to the
     next `\n}` and swallowed 11396 characters containing TEN cancels, so deleting the
     three that matter left the count at seven and the guard green. That is the exact
     defect this test was written to catch, in the test written to catch it. A brace
     scan cannot drift. */
  const start = CODE.indexOf('async function paintAccounts()');
  assert.ok(start > -1, 'paintAccounts was not found, so this test asserts nothing');
  let i = CODE.indexOf('{', start), depth = 0, end = -1;
  for (let k = i; k < CODE.length; k++) {
    if (CODE[k] === '{') depth++;
    else if (CODE[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  assert.ok(end > -1, 'could not find the end of paintAccounts, so the window is unbounded');
  const body = CODE.slice(start, end);
  /* 🛑 ASSERT THE ADJACENCY, NOT A COUNT. A floor on the count is the wrong
     instrument: this body legitimately holds ten cancels, so deleting the three that
     matter still cleared a floor of three. The property the comment above the module
     actually claims is that EVERY writer to the message line cancels first, so assert
     exactly that, per writer, and name the one that does not. */
  const writers = [...body.matchAll(/msg\.textContent\s*=/g)];
  assert.ok(writers.length >= 3,
    'fewer than three writers to the message line were found in paintAccounts, so this '
    + 'test is not looking at what it claims. found ' + writers.length);
  const unguarded = writers.filter((m) => !/acctCancelSay\(\)/.test(body.slice(Math.max(0, m.index - 400), m.index)));
  assert.equal(unguarded.length, 0,
    unguarded.length + ' of ' + writers.length + ' writers to #set-accounts-msg inside '
    + 'paintAccounts do not cancel the pending announcement first, so a deferred refusal '
    + 'can be written after a repaint has already wiped the line. First unguarded write: '
    + JSON.stringify(body.slice(Math.max(0, (unguarded[0] || {}).index - 90), ((unguarded[0] || {}).index || 0) + 40)));
});
