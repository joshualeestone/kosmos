/**
 * Two config directories can be signed in to ONE email, and the accounts screen
 * used to render both rows under the same name, with two `Disconnect` buttons
 * carrying the same accessible name. `docs/browser-checks/named-controls.js`
 * reported it as `settings: accounts: Disconnect agent@example.com x2`.
 *
 * Measured on this machine 2026-08-28 before the fix: four rows from
 * `accounts.list()`, and `agent@example.com` held two of them (`~/.claude`, the
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
  /* The key calls shared helpers, so the eval scope must include them or the
     extracted function throws ReferenceError.
     🔑 `acctPrimaryName` is here because the key IS `acctPrimaryName`, lowercased
     (kosmos#2612, iteration 9). Pulling it in rather than inlining its chain is
     the point: the defect that made this necessary was the key carrying its OWN
     COPY of that chain and falling behind it, so a test that stubbed it would
     re-open exactly the gap the fix closes. `acctChosenName` comes with it
     because acctPrimaryName calls it. */
  const helpers = ['acctChosenName', 'acctPrimaryName'].map((fn) => {
    const fnAt = PAGE.indexOf('function ' + fn + '(');
    assert.notEqual(fnAt, -1, fn + ' is gone from the page; the key depends on it');
    return PAGE.slice(fnAt, PAGE.indexOf('\n}', fnAt) + 2);
  }).join('\n');
  return new Function(helpers + '\n' + src + '; return accountQualifiers;')();
}
const qualifiers = loadQualifiers();

const DEFAULT_ROW = { email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
const SECOND_ROW  = { email: 'agent@example.com', dir: '/Users/x/.claude-account-d', label: 'account-d', isDefault: false };
const OTHER       = { email: 'other@example.com', dir: '/Users/x/.claude-b', label: 'b', isDefault: false };

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
  const bare = { email: 'agent@example.com', dir: '/Users/x/.claude-nolabel', label: null, isDefault: false };
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

/* #2584 (deferred finding 9, made live). `main` is reserved for the default row,
   but there can be MORE THAN ONE default in a key-group: each provider has its
   own default, so a Claude default and an OpenAI ChatGPT default that share one
   email land in the same group and BOTH used to take 'main'. #2584 gave the
   OpenAI default a reauth button, so the two controls then answered to one
   accessible name ("Sign in again as <email> (main)") -- the exact 3b browser
   check that red'd. This mirrors the real condition that produced it: one email
   with a Claude default in ~/.claude and an OpenAI ChatGPT default in ~/.codex.
   The qualifier must keep them distinct. Reds on the pre-fix page (both get
   'main'). */
test('two defaults sharing a login are named distinctly (cross-provider default collision)', () => {
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const q = qualifiers([claudeDefault, openaiDefault]);
  const a = q.get(claudeDefault.dir);
  const b = q.get(openaiDefault.dir);
  assert.notEqual(a, '', 'the first default row is anonymous beside its cross-provider twin');
  assert.notEqual(b, '', 'the second default row is anonymous beside its twin, so its reauth control shares a name');
  assert.notEqual(a, b, 'both defaults got the SAME qualifier, so the two reauth controls still answer to one accessible name -- deferred finding 9');
});

/* #2612: the arm above proves the two cross-provider defaults are DISTINCT, which
   the raw `dir` fallback already satisfied. It cannot tell a friendly name from a
   filesystem path, so it passed while the screen read "Sign in again as
   josh@you.com (/Users/josh/.codex)". This is the arm that can. */
test('#2612: a second cross-provider default is qualified by PROVIDER, not by its path', () => {
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const q = qualifiers([claudeDefault, openaiDefault]);
  assert.equal(q.get(claudeDefault.dir), 'main', 'the FIRST default still keeps the reserved qualifier');
  assert.equal(q.get(openaiDefault.dir), 'OpenAI',
    'the second default is not qualified by its provider; the path case is covered separately below');
  /* The negative half, stated separately: whatever it is, it must not be a path.
     An assertion that only checks the happy string cannot see a regression to a
     DIFFERENT path-shaped value. */
  assert.doesNotMatch(String(q.get(openaiDefault.dir)), /[/\\]/,
    'the qualifier contains a path separator, so a person is being shown a directory again');
});

/* The mirror, so the map is not one-directional: a Claude second default reads
   "Claude" rather than the long providerName or a path. Ordered with the OpenAI
   default FIRST so the Claude one is the row that falls past `main`. */
test('#2612: the provider map works in the other direction too', () => {
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const q = qualifiers([openaiDefault, claudeDefault]);
  assert.equal(q.get(openaiDefault.dir), 'main');
  assert.equal(q.get(claudeDefault.dir), 'Claude',
    'the short product name, not "Anthropic / Claude" and not the path');
});

/* 🛑 AN UNKNOWN PROVIDER MUST NOT BE GUESSED. A ternary defaulting anything that
   is not `openai` to "Claude" would label a future third provider wrongly, and
   being wrong about WHICH account this is defeats the point of a qualifier. The
   collision-proof `dir` is the correct answer when we cannot tell. */
test('#2612 CONTROL: a provider the map does not know falls back to the path, not to a guess', () => {
  const known = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const future = { provider: 'gemini', email: 'agent@example.com', dir: '/Users/x/.gemini', label: null, isDefault: true };
  const q = qualifiers([known, future]);
  assert.equal(q.get(known.dir), 'main');
  assert.equal(q.get(future.dir), '/Users/x/.gemini',
    'an unknown provider was given a friendly name it has not earned');
});

/* 🛑 THE PROVIDER QUALIFIER IS SUBJECT TO THE USED-SET, AND THE COMPARISON MUST
   BE CASE-INSENSITIVE. #2612 introduced the first mixed-case value this namespace
   has ever held. Every label is LOWERCASE by construction (`dirForLabel` and
   `cleanLabel` both `.toLowerCase()` and strip to `[a-z0-9-]`), so a label can
   be "OpenAI" only off a hand-made directory (`list()` reads the basename with
   no normalisation) and is very easily "openai". An exact `Set.has` waves that
   through while a screen reader announces the two identically, which is the
   defect this function exists to prevent, and it would have been a REGRESSION:
   the same rows previously produced a path, which is ugly and audibly distinct.

   ⚠️ MY FIRST VERSION OF THIS ARM USED `label: 'OpenAI'`, A SHAPE `list()` CANNOT
   PRODUCE. It pinned a guard that can never fire in production while the
   reachable lowercase variant went untested, which is exactly why the defect was
   invisible. It also ordered the decoy BEFORE the default, the opposite of the
   real payload. Both orderings are now armed, because fixing only the provider
   lookup leaves the real one broken: the default is emitted first, takes
   "OpenAI", and the labelled row then reaches the LABEL branch where an exact
   `used.has('openai')` misses. */
test('#2612: a lowercase label cannot collide audibly with the provider name, real payload order', () => {
  // `[...claude, ...openai]`, and within OpenAI the default comes first
  // (`openaiaccounts.list()` adds `defaultDir()` then the sorted `.codex-*`).
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const labelled = { provider: 'openai', email: 'agent@example.com', dir: '/Users/x/.codex-openai', label: 'openai', isDefault: false };
  const q = qualifiers([claudeDefault, openaiDefault, labelled]);
  const vals = [claudeDefault, openaiDefault, labelled].map((r) => q.get(r.dir));
  const heard = new Set(vals.map((v) => String(v).toLowerCase()));
  assert.equal(heard.size, vals.length,
    'two qualifiers differ only by CASE, so two controls answer to one spoken name: ' + JSON.stringify(vals));
});

test('#2612: and in the other ordering, where the labelled row is seen first', () => {
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const labelled = { provider: 'openai', email: 'agent@example.com', dir: '/Users/x/.codex-openai', label: 'openai', isDefault: false };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const q = qualifiers([claudeDefault, labelled, openaiDefault]);
  const vals = [claudeDefault, labelled, openaiDefault].map((r) => q.get(r.dir));
  const heard = new Set(vals.map((v) => String(v).toLowerCase()));
  assert.equal(heard.size, vals.length,
    'the other ordering collides: ' + JSON.stringify(vals));
  assert.equal(q.get(labelled.dir), 'openai', 'a row seen first keeps its own label');
  assert.equal(q.get(openaiDefault.dir), '/Users/x/.codex',
    'the default must yield the path once its provider name is audibly taken');
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
  /* 🛑 PREFIX-ANCHOR THE PAGE HALF TOO. The flattened page holds this CLAIM TWICE, at
     the OpenAI tooltip's conditional clause and at the Claude live row's title, so a bare
     includes() was kept green by the OpenAI copy: deleting the clause from the Claude
     title measured 913 pass, 0 fail. The sibling assertion above was prefix-anchored for
     EXACTLY this collision on the server half, and its comment says so. I fixed one half
     of a two-sided pin and left the other bare. */
  assert.ok(flat(PAGE).includes('so nothing is deleted, and ' + CLAIM),
    'the CLAUDE tooltip no longer makes the history promise the route reports, so the two '
    + 'copies of one claim have drifted with nothing to say so');
});

test('#2684: the default row renders a LIVE Disconnect (identity-clear) and keeps the folder', () => {
  // Extract the Claude disconnect button (the isOpenai-else in acctRowHtml) and EXECUTE it,
  // so a new free variable is a ReferenceError rather than a silent pass. #2684 removed the
  // old default-vs-live ternary; the default now renders the same live button, differing only
  // in its title branch.
  const anchor = 'data-forget-provider="claude" ';
  const ai = PAGE.indexOf(anchor);
  assert.ok(ai > -1, 'the Claude disconnect button is gone from acctRowHtml');
  const start = PAGE.lastIndexOf("'<button class=\"acct-disconnect\"", ai);
  assert.ok(start > -1 && ai - start < 200, 'could not find the Claude disconnect button opener');
  const endTok = ">Disconnect</button>'";
  const endAt = PAGE.indexOf(endTok, ai);
  assert.ok(endAt > start, 'the Claude disconnect button does not close as expected');
  const body = PAGE.slice(start, endAt + endTok.length);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  const render = new Function('a', 'who', 'qual', 'qualName', 'esc', `return ${body};`);
  const onDefault = render({ isDefault: true, dir: '/h/.claude' }, 'main@example.com', '', 'Claude', esc);
  const onOther = render({ isDefault: false, dir: '/h/.claude-walk' }, 'walk@example.com', '', 'Claude', esc);

  // #2684: the DEFAULT is LIVE now (data-forget), never disabled.
  assert.ok(!/aria-disabled="true"/.test(onDefault),
    'the DEFAULT Disconnect is still marked aria-disabled; #2684 makes it a live control');
  assert.ok(!/(^|\s)disabled(\b|=)/.test(onDefault),
    'the DEFAULT Disconnect went back to the native disabled attribute');
  assert.match(onDefault, /data-forget="\/h\/\.claude"/,
    'the DEFAULT row lost its data-forget, so its live Disconnect cannot fire');
  assert.match(onDefault, /data-forget-provider="claude"/, 'the DEFAULT Disconnect lost its provider marker');
  // its title states the #2684 kept-folder consequence, not the old refusal.
  assert.match(onDefault, /main connection off the list/,
    'the DEFAULT title no longer states the identity-clear (folder kept)');
  assert.match(onDefault, /the Claude folder and any history in it are kept/,
    'the DEFAULT title no longer promises the folder + history are kept');
  assert.ok(!/does not remove this computer/.test(onDefault),
    'the DEFAULT title still carries the OLD refusal copy that #2684 removed');

  // a NON-default row is also live, with the secondary title.
  assert.match(onOther, /data-forget="\/h\/\.claude-walk"/, 'a NON-default row lost its data-forget');
  assert.match(onOther, /data-forget-provider="claude"/, 'a NON-default row lost its provider marker');
  assert.match(onOther, /Its sign-in file stays on this computer/, 'a NON-default row lost its secondary title');

  // the OpenAI branch sits outside the extracted expression; pin its provider marker in source.
  assert.match(PAGE, /data-forget-provider="openai"/, 'the OpenAI Disconnect lost its provider marker');
});

test('EVERY Disconnect control carries the qualifier, escaped, or one branch keeps the whole defect', () => {
  const qualified = (PAGE.match(/aria-label="Disconnect ' \+ who \+ ' \(' \+ esc\(qualName\) \+ '\)'/g) || []).length;
  const controls = (PAGE.match(/class="acct-disconnect"/g) || []).length;
  // #2684 removed the disabled-default branch, leaving two live Disconnect branches (OpenAI, Claude).
  assert.ok(controls >= 2,
    `expected the two live disconnect branches (OpenAI, Claude); found ${controls}`);
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
  const clashMain = { email: 'agent@example.com', dir: '/Users/x/.claude-main', label: 'main', isDefault: false };
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
  const a = { email: 'agent@example.com', dir: '/Users/x/.claude-dup', label: 'dup', isDefault: false };
  const b = { email: 'agent@example.com', dir: '/Users/y/.claude-dup', label: 'dup', isDefault: false };
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
  /* 🛑 EXECUTE THE BRANCH. DO NOT PATTERN-MATCH IT. This assertion has now been wrong
     THREE TIMES, each time in a form the previous fix did not cover:
       v1  /a\.isDefault \?/            matched inside `!a.isDefault ?`   -> inversion passed
       v2  /\(a\.isDefault \?/          blocked that, but only required the sentence to
                                        appear WITHIN 160 CHARS. Swapping the ternary ARMS
                                        inverts the behaviour identically and leaves the
                                        sentence in place: measured 3401 pass, byte-identical
                                        to baseline.
       v3  this. Render both rows and read the titles.
     ⇒ A source pattern can always be satisfied by a different arrangement of the same
     characters. Rendering cannot: it asks what the person is actually shown. The Claude
     sibling above has done it this way all along, which is why it was never the one that
     broke. */
  const at = PAGE.indexOf('data-forget-provider="openai"');
  assert.ok(at > -1, 'the OpenAI Disconnect branch is gone; re-anchor this test');
  const open = PAGE.lastIndexOf("? '<button", at);
  assert.ok(open > -1 && open < at, 'the OpenAI branch no longer opens the way this extraction expects');
  const close = PAGE.indexOf(">Disconnect</button>'", at);
  assert.ok(close > open, 'the OpenAI branch no longer closes the way this extraction expects');
  const body = PAGE.slice(open + 1, close + ">Disconnect</button>'".length);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  const render = new Function('a', 'who', 'qual', 'qualName', 'esc', `return ${body};`);

  const onDefault = render({ isDefault: true, dir: '/h/.codex' }, 'main@example.com', '', 'OpenAI', esc);
  const onLabelled = render({ isDefault: false, dir: '/h/.codex-walk' }, 'walk@example.com', '', 'OpenAI', esc);

  const CLAIM = 'stops looking inside it';
  assert.ok(onDefault.includes(CLAIM),
    'the DEFAULT openai row is not told its history stops appearing, so it reads as '
    + 'consequence-free before the press and gains a consequence after it. rendered: ' + onDefault);
  assert.ok(!onLabelled.includes(CLAIM),
    'a LABELLED openai row is told it loses transcripts codex never kept there, which is '
    + 'false for every account but the default. rendered: ' + onLabelled);
  /* Both rows must still carry the half that IS true of both, or "fixing" the above by
     deleting the tooltip would pass. */
  for (const [name, out] of [['default', onDefault], ['labelled', onLabelled]]) {
    assert.ok(out.includes('so nothing is deleted'),
      'the ' + name + ' openai row lost the reassurance that is true of every row');
  }
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
  /* 🛑 CLIP THE LOOKBACK AT THE ENCLOSING BLOCK, NOT AT A CHARACTER COUNT. A flat
     400-character window reaches BACKWARDS ACROSS A BRANCH BOUNDARY: for the post-await
     success writer it ran back into the mutually-exclusive `catch` and matched THAT
     branch's cancel, so the one call this branch added was pinned by nothing. Measured:
     nine of the ten cancels red by name when deleted individually, and that one left
     913 pass, 0 fail.
     ⇒ A window measured in characters cannot see control flow. Cutting at the nearest
     enclosing brace means a cancel on a path that DID NOT RUN cannot satisfy a writer on
     the path that did. Third distinct failure of a character-counted window on this
     branch: pushed out by a comment, spanning two things it could not tell apart, and
     now crossing a branch boundary. */
  const guardWindow = (idx) => {
    const edge = Math.max(body.lastIndexOf('{', idx), body.lastIndexOf('}', idx));
    return body.slice(edge > -1 ? edge : Math.max(0, idx - 400), idx);
  };
  /* ⚠️ EXCLUDE THE TIMER'S OWN WRITE. `msg.textContent = say` inside the setTimeout
     callback IS the deferred announcement, so demanding a cancel before it is
     nonsensical: it would be cancelling itself. It is identified structurally, by the
     `acctSayTimer = null` the callback clears its handle with, not by position.
     The property being asserted is that every writer which OVERWRITES the line cancels
     the pending timer first. The timer's own write is not an overwrite. */
  const isTimerWrite = (idx) => /acctSayTimer = null/.test(guardWindow(idx));
  const unguarded = writers.filter((m) => !isTimerWrite(m.index)
    && !/acctCancelSay\(\)/.test(guardWindow(m.index)));
  assert.equal(unguarded.length, 0,
    unguarded.length + ' of ' + writers.length + ' writers to #set-accounts-msg inside '
    + 'paintAccounts do not cancel the pending announcement first, so a deferred refusal '
    + 'can be written after a repaint has already wiped the line. First unguarded write: '
    + JSON.stringify(body.slice(Math.max(0, (unguarded[0] || {}).index - 90), ((unguarded[0] || {}).index || 0) + 40)));
});

/* 🛑 A CASE-VARIANT OF THE RESERVED WORD, WHICH IS REACHABLE AND WAS A LIVE
   COLLISION. `list()` READS a label straight off the directory basename with no
   normalisation (engine/accounts.js:264, engine/openaiaccounts.js:166); only the
   CREATE path lowercases (`dirForLabel`, `cleanLabel`). So `.claude-Main` yields
   the label "Main", which is trivially makeable by hand, restored from a backup,
   or synced from another machine.

   ⚠️ THE SHAPE IS LOAD-BEARING AND MY FIRST PROBE HAD IT WRONG. The reserved
   word must NOT already be taken in this key-group, so the row holding `main`
   belongs to a DIFFERENT email. With the default in the same group there is no
   collision (the case-insensitive label lookup catches it), which is why a
   careless fixture shows nothing. Measured before the fix: `["Main","main"]`,
   two distinct strings and ONE sound. After: `["Claude","main"]`.

   📌 It also proves the comment that used to sit beside the `main` comparisons
   was wrong: it said "nothing can put a case-variant of `main` into `used`,
   since labels are lowercase", which is true only of labels this app creates. */
test('#2612: a case-variant of the reserved word cannot sound like it', () => {
  const otherPerson = { provider: 'anthropic', email: 'someone@else.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const namedMain = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude-Main', label: 'Main', isDefault: false };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const q = qualifiers([otherPerson, namedMain, openaiDefault]);
  const vals = [namedMain, openaiDefault].map((r) => q.get(r.dir));
  const heard = new Set(vals.map((v) => String(v).toLowerCase()));
  assert.equal(heard.size, vals.length,
    'two qualifiers differ only by CASE of the reserved word, so two controls answer to one '
    + 'spoken name: ' + JSON.stringify(vals));
});

/* 🛑 THE ARM ABOVE PINS THE PAIR OF `main` GUARDS, NOT EITHER ONE, AND FOR A
   WHILE THIS FILE READ AS THOUGH IT PINNED BOTH. Iteration 7 measured it, and
   then a wider sweep here corrected the measurement in a way worth recording,
   because the two runs answer DIFFERENT questions and only the second one
   settles it:

     revert `String(qual).toLowerCase() === 'main'`  (call it M1)
     revert `!takenAlready('main')`                  (call it M2)

     over 110,592 three-row fixtures, OUTPUTS that differ from unmutated:
       M1 alone  25088     M2 alone  0      M1+M2  25088
     over 64,000 of the same fixtures, AUDIBLE COLLISIONS produced:
       base 0   M1 alone 0   M2 alone 0   M1+M2  7680   <- the control

   ⇒ Two separate facts, and conflating them is how this stayed unpinned:
     - **Neither guard is individually load-bearing for the INVARIANT.** Each
       covers the other's single-revert path, so no arm asserting "no two
       qualifiers sound alike" can ever red one alone. They are belt and braces,
       deliberately, on an accessibility property.
     - **But M1 is very much observable in OUTPUT** (25,088 fixtures), so it can
       be pinned by asserting the CHOSEN QUALIFIER instead of the invariant.
       That is what the arm below does, and it is the only way to hold this
       guard, since the invariant cannot see it.

   📌 M2 stays genuinely unpinned and this file no longer pretends otherwise:
   0 differences in either sweep. It is a redundant guard kept on purpose, and
   a redundant guard that is honestly labelled is better than a vacuous arm
   claiming to hold it. The sweeps bound the claim to three-row fixtures over
   this label/provider/default space; they are not a proof for all inputs. */
test('#2612: the reserved word stays reserved case-insensitively, even with no default holding it', () => {
  const E = 'agent@example.com';
  /* NEITHER row is a default, so nothing has taken `main` and `takenAlready`
     cannot be what rejects the label. Only the lowercased compare can, which is
     precisely why this shape is the one that pins it. */
  const plain = { provider: 'anthropic', email: E, dir: '/Users/x/.claude-a', label: null, isDefault: false };
  const namedMain = { provider: 'anthropic', email: E, dir: '/Users/x/.claude-Main', label: 'Main', isDefault: false };
  const q = qualifiers([plain, namedMain]);
  assert.equal(q.get(namedMain.dir), '/Users/x/.claude-Main',
    'a row labelled "Main" kept the reserved word because the compare stopped being '
    + 'case-insensitive; `main` is reserved for the first default whether or not one is present');
  /* CONTROL: the lowercase spelling must already behave this way, or the
     assertion above is pinning something other than the case-insensitivity. */
  const qCtl = qualifiers([plain, { ...namedMain, label: 'main' }]);
  assert.equal(qCtl.get(namedMain.dir), q.get(namedMain.dir),
    'the lowercase spelling and the mixed-case spelling disagree, so this arm is not '
    + 'measuring the case-insensitivity it claims to');
});

/* 🛑 A ROW WHOSE LABEL IS LITERALLY `main`, WITH THE `provider` FIELD PRODUCTION
   ACTUALLY EMITS. `dirForLabel` has no reserved-word guard, so `~/.claude-main`
   is creatable, and beside `~/.claude` on one email that row reaches the LABEL
   branch, finds `main` reserved, and falls through.

   ⚠️ The pre-existing arm for this shape uses a fixture with NO `provider` field,
   which `/api/accounts` never emits (server.js sets `provider:'anthropic'` on
   every Claude row), so it passed unchanged through this card. This is the
   reachable version.
   📌 IT DID NOT EXERCISE THE UNKNOWN-PROVIDER PATH, which an earlier version of
   this comment claimed. With no `provider` on either row `providersHere` is
   `{''}`, so `providerDistinguishes` is false and the provider ternary is never
   reached at all. The conclusion held; the named mechanism was wrong.

   📌 AND THE ANSWER IS THE DIR, NOT THE PROVIDER, because both rows are Claude:
   the provider distinguishes nothing inside a single-provider group, so the
   chain stays label-then-dir there. That also keeps the chosen name visible in
   the qualifier, which is what the old fallback did well. */
test('#2612: a row labelled `main` beside the default keeps its identifying path, not a provider name', () => {
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const named = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude-main', label: 'main', isDefault: false };
  const q = qualifiers([claudeDefault, named]);
  assert.equal(q.get(claudeDefault.dir), 'main', 'the default still holds the reserved word');
  assert.equal(q.get(named.dir), '/Users/x/.claude-main',
    'a single-provider group gained a provider qualifier, which identifies nothing there and '
    + 'replaces a path that named the account');
});

/* The mirror: the SAME shape in a group that DOES span providers still gets the
   provider name, so the scoping above did not simply disable the feature.

   🛑 THIS TEST USED TO BE A DUPLICATE OF ANOTHER ONE, AND ITS COMMENT WAS THE
   ONLY THING THAT SAID OTHERWISE. Challenge-loop iteration 6 caught it: the
   fixture was `[claudeDefault, openaiDefault]`, byte-for-byte the rows of "a
   second cross-provider default is qualified by PROVIDER" far above, so it
   re-asserted a subset of that test while its comment claimed to mirror the
   `label: 'main'` collision directly above it. THE COMBINED CASE THE COMMENT
   DESCRIBES WAS EXERCISED BY NOTHING. The `named` row is what makes this a
   mirror rather than a repeat, so it is now in the fixture.
   ⚠️ The distinction is the whole point of the pair: the SAME `label: 'main'`
   row answers `/Users/x/.claude-main` in a single-provider group (above) and
   "Claude" here, because the provider only becomes a usable qualifier once the
   group actually spans providers. One fixture without the other cannot show
   that, which is why a duplicate read as coverage. */
test('#2612: the same collision in a cross-provider group still gets the provider name', () => {
  const claudeDefault = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude', label: null, isDefault: true };
  const named = { provider: 'anthropic', email: 'agent@example.com', dir: '/Users/x/.claude-main', label: 'main', isDefault: false };
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: 'agent@example.com', dir: '/Users/x/.codex', label: null, isDefault: true };
  const q = qualifiers([claudeDefault, named, openaiDefault]);
  assert.equal(q.get(named.dir), 'Claude',
    'the label="main" row fell past the provider step in a group that DOES span providers, '
    + 'so the scoping went too far and it is back to announcing a path');
  assert.equal(q.get(openaiDefault.dir), 'OpenAI',
    'the provider qualifier is gone even where it DOES distinguish, so the scoping went too far');
  assert.equal(q.get(claudeDefault.dir), 'main', 'the first default still holds the reserved word');
  /* All three must still be audibly distinct, which is the invariant the whole
     function exists for and is not implied by the three equalities above. */
  const heard = [q.get(claudeDefault.dir), q.get(named.dir), q.get(openaiDefault.dir)]
    .map((s) => String(s).toLowerCase());
  assert.equal(new Set(heard).size, 3,
    'two of the three qualifiers sound the same to a screen reader: ' + JSON.stringify(heard));
});

/* 🔑 THE PROVIDER ID IS MATCHED CASE-INSENSITIVELY, both where the group's
   provider set is built and where the name is chosen. Every other membership
   test in `accountQualifiers` was made case-insensitive after being burned
   twice; this one was left exact until iteration 6 flagged the asymmetry.
   ⚠️ It is a correctness arm, not a style arm. A case-variant id inflates the
   provider set, so `providerDistinguishes` goes TRUE for a group holding ONE
   real provider, and a row in it is then qualified by a provider name that
   identifies nothing (the #1917 shape the scoping exists to prevent). Measured
   before the fix: ["main","work","Claude"], against a control of the same rows
   with consistent lowercase ids giving ["main","work","/Users/x/.claude-work"].
   📌 Not reachable through `/api/accounts` today (server.js writes 'anthropic'
   and 'openai' as lowercase literals), so this pins the property rather than
   guarding a live path, and #2634 is when a third provider could arrive. */
test('#2612: a case-variant provider id does not fake a cross-provider group', () => {
  const E = 'agent@example.com';
  const rows = [
    { provider: 'anthropic', email: E, dir: '/Users/x/.claude', label: null, isDefault: true },
    { provider: 'Anthropic', email: E, dir: '/Users/x/.claude-alt', label: 'work', isDefault: false },
    { provider: 'anthropic', email: E, dir: '/Users/x/.claude-work', label: 'work', isDefault: false },
  ];
  const q = qualifiers(rows);
  assert.equal(q.get('/Users/x/.claude-work'), '/Users/x/.claude-work',
    'a case-variant provider id made a single-provider group look cross-provider, so a row '
    + 'was qualified by a provider name that distinguishes nothing there');
  /* CONTROL: the same three rows with consistent ids must give the same answer.
     Without this the assertion above could pass for the wrong reason (any change
     that disabled the provider step entirely would also satisfy it). */
  const qCtl = qualifiers(rows.map((r) => ({ ...r, provider: r.provider.toLowerCase() })));
  assert.equal(qCtl.get('/Users/x/.claude-work'), q.get('/Users/x/.claude-work'),
    'normalising the ids by hand changed the answer, so the function is still case-sensitive here');
  /* And the arm can still see the feature working: the same shape with a REAL
     second provider must give the provider name, or the two assertions above
     would be satisfied by a function that never qualifies by provider at all. */
  const qReal = qualifiers([
    { provider: 'anthropic', email: E, dir: '/Users/x/.claude', label: null, isDefault: true },
    { provider: 'openai', email: E, dir: '/Users/x/.codex', label: 'work', isDefault: false },
    { provider: 'openai', email: E, dir: '/Users/x/.codex2', label: 'work', isDefault: false },
  ]);
  assert.equal(qReal.get('/Users/x/.codex'), 'work', 'the first labelled row keeps its label');
  assert.equal(qReal.get('/Users/x/.codex2'), 'OpenAI',
    'a genuinely cross-provider group no longer reaches the provider step at all');
});

/* 🛑 THE OTHER HALF OF THE SAME FIX, AND THE ARM ABOVE DOES NOT COVER IT.
   Iteration 6 added TWO normalisations (the group's provider set, and `provId`
   at the ternary) and pinned ONE. Iteration 7 measured it: reverting `provId`'s
   `.toLowerCase()` left all 37 arms GREEN, because the fixture above is
   all-Anthropic, so `providerDistinguishes` is false and the ternary is never
   reached there. ⭐ An arm written to cover a fix can cover half of it and read
   as complete, which is the same class as the duplicate iteration 6 found.

   The shape that reaches the ternary needs the case-variant row NOT to be the
   first default (or it takes `main` and never falls through) AND the group to
   genuinely span providers (or the provider step is skipped). So: an OpenAI
   default first, then a case-variant Anthropic row.
   ⚠️ MEASURED BOTH ARMS before writing this:
     unmutated                  -> ["main", "Claude"]
     provId not lowercased      -> ["main", "/h/.claude"]   <- falls to the path */
test('#2612: a case-variant provider id still RESOLVES where the group does span providers', () => {
  const E = 'agent@example.com';
  const openaiDefault = { provider: 'openai', authMode: 'chatgpt', email: E, dir: '/Users/x/.codex', label: null, isDefault: true };
  const oddCase = { provider: 'Anthropic', email: E, dir: '/Users/x/.claude', label: null, isDefault: false };
  const q = qualifiers([openaiDefault, oddCase]);
  assert.equal(q.get(openaiDefault.dir), 'main', 'the first default still holds the reserved word');
  assert.equal(q.get(oddCase.dir), 'Claude',
    'a case-variant provider id counted toward providerDistinguishes and then failed to resolve '
    + 'to a name, so the row fell to its path: the two normalisations have drifted apart');
});

/* 🔑 AND THE MISSING PROVIDER, which is the same class as the case-variant one
   arm above and was left open when that one was closed. A row with no
   `provider` must not vote on whether the group spans providers: an absent
   provider is not evidence of a SECOND one.
   ⚠️ This is the arm that is reachable FROM THE TESTS rather than from
   `/api/accounts`: DEFAULT_ROW, SECOND_ROW and OTHER at the top of this file
   all omit `provider`, so mixing one with a provider-bearing row is a fixture
   any future author would write without thinking about it. */
test('#2612: a row with no provider does not fake a cross-provider group', () => {
  const E = 'agent@example.com';
  const noProvider = { email: E, dir: '/Users/x/.claude', label: null, isDefault: true };
  const anthropic = { provider: 'anthropic', email: E, dir: '/Users/x/.claude-w', label: null, isDefault: false };
  const q = qualifiers([noProvider, anthropic]);
  assert.equal(q.get(anthropic.dir), '/Users/x/.claude-w',
    'a provider-less row inflated the group\'s provider set, so a group with ONE real provider '
    + 'qualified a row by a provider name that distinguishes nothing there');
  /* CONTROL: the same two rows with the provider present must agree, or the
     assertion above could pass for a reason unrelated to the empty string. */
  const qCtl = qualifiers([{ ...noProvider, provider: 'anthropic' }, anthropic]);
  assert.equal(qCtl.get(anthropic.dir), q.get(anthropic.dir),
    'naming the provider on the first row changed the answer, so the empty string is still voting');
  /* And the feature still works when a real second provider is present, so the
     two assertions above are not satisfied by a disabled provider step. */
  const qReal = qualifiers([
    { provider: 'openai', email: E, dir: '/Users/x/.codex', label: null, isDefault: true },
    anthropic,
  ]);
  assert.equal(qReal.get(anthropic.dir), 'Claude',
    'a genuinely cross-provider group stopped reaching the provider step');
});

/* ─────────────────────────────────────────────────────────────────────────────
 * #2612 + CLAUDE.md convention 5: THE PROVIDER DISPLAY-NAME DERIVATIONS ARE
 * PINNED, because the same fact is written in several places and must not drift.
 *
 * The repo convention is explicit about the remedy when a fact IS duplicated:
 * "Prefer one source of truth that both sites read; if you must duplicate, add a
 * test that pins them equal (that test asserts the SHAPE, not a count, so a new
 * caller has to be deliberate rather than merely plausible)."
 *
 * 🔑 THEY ARE NOT ALL THE SAME STRING, AND THAT IS DELIBERATE, so this pins the
 * relationship rather than equality. Read the MEMBERSHIP, not the number:
 *
 *   SHORT pair, "Claude" | "OpenAI", must agree exactly:
 *     accountQualifiers   the qualifier          "Claude" | "OpenAI" | ""
 *     qualName fallback   the accessible name    "Claude" | "OpenAI"
 *     provName            switch-account screen  "Claude" | "OpenAI"
 *   LONG pair, pinned separately, must CONTAIN the short one:
 *     accountGroupsHtml   the group head         "Anthropic / Claude" | "OpenAI"
 *   A THIRD pair entirely, deliberately out of scope and documented at its sites:
 *     "OpenAI" | "Anthropic"  (changeModelNow and its sibling)
 *
 * ⚠️ AN EARLIER VERSION OF THIS TABLE LISTED THE GROUP HEAD AS ONE OF THE THREE
 * SHORT SITES AND OMITTED `provName` ENTIRELY, which is how `provName` went
 * unpinned while a banner said it was covered. That is the whole failure this
 * pin exists to prevent, committed by the pin, and the note below records how it
 * then got miscounted a second time while being fixed.
 *
 * ⚠️ NOT CONSOLIDATED HERE, and kosmos#2634 records why: folding a refactor of
 * the other call sites into a one-step qualifier change makes a small reviewable
 * diff into a broad one. This pin is what makes that refactor safe to do later:
 * change any one short derivation and this goes red.
 *
 * 🛑 IT ALSO RECORDS THE DISAGREEMENT THAT ALREADY EXISTS, rather than asserting
 * a harmony the code does not have. For an UNKNOWN provider the two ternaries
 * guess "Claude" while `accountQualifiers` answers "" and falls through to the
 * dir. That is the real gap #2634 exists for, and the arm below asserts it
 * EXPLICITLY so nobody reads this pin as proof the sites agree everywhere.
 * 📌 That dir is NOT "the collision-proof last resort", which is what this
 * paragraph used to call it: collision-proof as a STRING, not as a SOUND. See
 * `distinctly()` in the page and the case-variant-dir arm in this file.
 */
/* 🛑 THE COUNT IN THIS PIN'S OWN NAME HAS NOW BEEN WRONG TWICE, IN OPPOSITE
   DIRECTIONS, WHICH IS THE FAILURE THE PIN EXISTS TO PREVENT COMMITTED BY THE
   PIN. Worth the space, because the second version was written while FIXING the
   first and was more confident than either.

     v1  "THREE derivations", listing the ternary, `qualName` and the GROUP HEAD.
         Count right, MEMBERSHIP wrong: the group head is the LONG form, and the
         real third short producer (`provName`) was matched by nothing.
     v2  "FOUR sites producing the short pair", adding `provName` and KEEPING the
         group head in the list, while annotating it "LONG form, not required to
         equal the short three" in the same breath. Self-contradictory, and it
         moved the count away from the truth to fix a membership error.
     now THREE producers of the short `OpenAI | Claude` pair, enumerated by
         reading every `'OpenAI'` in the page rather than by recall.

   The three, all pinned below:
     the qualifier ternary in accountQualifiers   (via the helper, run not matched)
     `const qualName = qual || (isOpenai ? ...)`  (regex)
     `const provName = (providerOf(CURRENT) ...)` (regex, the switch-account screen)

   📌 NAMED SO THEY ARE NOT RE-COUNTED AS GAPS, since two readers have now tried:
     `const name = a.providerName || (...)`   the GROUP HEAD, "Anthropic / Claude".
         A different fact (long form) and pinned separately below.
     `const provName = want === 'openai' ? 'OpenAI' : 'Anthropic'`  and
     `const label = toOpenai ? 'OpenAI' : 'Anthropic'`
         the `OpenAI | Anthropic` pair, a third fact, documented at its own site
         as deliberately different from the short pair.

   ⭐ A count is the most attractive thing to write and the least likely to be
   re-derived. Both wrong versions were written by someone who had just read the
   code. So the assertions below pin the SHAPE of every site they claim, and the
   membership list above is the part to check, not the number. */
const PROVIDER_SITES = {
  groupHead: /const name = a\.providerName \|\| \(a\.provider === 'openai' \? '([^']+)' : '([^']+)'\)/,
  qualName: /const qualName = qual \|\| \(isOpenai \? '([^']+)' : '([^']+)'\)/,
  provName: /const provName = \(providerOf\(CURRENT\) === 'openai'\) \? '([^']+)' : '([^']+)'/,
};

test('#2612: the three short provider-name derivations agree for every provider that exists', () => {
  const head = PAGE.match(PROVIDER_SITES.groupHead);
  const qual = PAGE.match(PROVIDER_SITES.qualName);
  const prov = PAGE.match(PROVIDER_SITES.provName);
  assert.ok(head, 'the group-head derivation moved or changed shape; restate this pin');
  assert.ok(qual, 'the qualName fallback moved or changed shape; restate this pin');
  assert.ok(prov, 'the provName derivation moved or changed shape; restate this pin');
  /* The fourth site carries the SHORT pair, so it must equal the qualName pair
     exactly. Asserted before the loop below so a drift here names itself rather
     than surfacing as a confusing qualifier mismatch. */
  assert.deepEqual([prov[1], prov[2]], [qual[1], qual[2]],
    'the provName derivation disagrees with the qualName fallback on the short provider names, '
    + 'so one screen says ' + JSON.stringify([prov[1], prov[2]]) + ' and another says '
    + JSON.stringify([qual[1], qual[2]]) + ': that is exactly the drift kosmos#2634 exists to end');

  const headFor = { openai: head[1], anthropic: head[2] };
  const qualFor = { openai: qual[1], anthropic: qual[2] };
  // The third derivation, read through the real helper rather than by regex.
  const qualifierFor = (provider) => {
    const a = { provider, email: 'x@e.com', dir: '/h/.a', label: null, isDefault: true };
    const b = { provider: provider === 'openai' ? 'anthropic' : 'openai', email: 'x@e.com', dir: '/h/.b', label: null, isDefault: true };
    return qualifiers([b, a]).get('/h/.a');   // `a` second, so it falls past `main`
  };

  for (const provider of ['openai', 'anthropic']) {
    assert.equal(qualFor[provider], qualifierFor(provider),
      `the two SHORT provider names disagree for ${provider}: the accessible-name fallback says `
      + `${JSON.stringify(qualFor[provider])} and the qualifier says ${JSON.stringify(qualifierFor(provider))}, `
      + 'so one account is called two things on one screen');
    assert.ok(headFor[provider].includes(qualFor[provider]),
      `the group head ${JSON.stringify(headFor[provider])} does not contain the short name `
      + `${JSON.stringify(qualFor[provider])} for ${provider}, so the box and the control disagree`);
  }
});

test('#2612 CONTROL: the pin can see a disagreement, and records the one that already exists', () => {
  /* 🛑 THE CONTROL EXERCISES THE PIN'S OWN COMPARISON, and the first version of
     this line did not: it was `assert.notEqual('Claude', 'Anthropic', ...)`, two
     literals, which cannot fail and established only that `assert.notEqual`
     works. Labelled a control, it would have told a future reader the pin had
     been shown able to red when nothing of the sort had happened. A vacuous
     assertion inside a test about vacuous assertions.
     ⇒ This feeds the real comparison a deliberately wrong provider key and
     requires it to DISAGREE, so the arm above is known to be capable of failing. */
  const shortFor = (provider) => {
    const a = { provider, email: 'x@e.com', dir: '/h/.a', label: null, isDefault: true };
    const b = { provider: provider === 'openai' ? 'anthropic' : 'openai', email: 'x@e.com', dir: '/h/.b', label: null, isDefault: true };
    return qualifiers([b, a]).get('/h/.a');
  };
  assert.notEqual(shortFor('openai'), shortFor('anthropic'),
    'the qualifier returns the same short name for both providers, so the pin above compares '
    + 'two values that cannot disagree and proves nothing');

  /* And the REAL disagreement, asserted rather than glossed: for a provider the
     map does not know, the two ternaries guess and the qualifier does not. This
     is kosmos#2634, and pinning it here means the day somebody fixes #2634 this
     arm goes red and has to be updated deliberately. */
  const unknown = { provider: 'gemini', email: 'x@e.com', dir: '/h/.gemini', label: null, isDefault: true };
  const other = { provider: 'anthropic', email: 'x@e.com', dir: '/h/.claude', label: null, isDefault: true };
  assert.equal(qualifiers([other, unknown]).get('/h/.gemini'), '/h/.gemini',
    'the qualifier now guesses a name for an unknown provider, which is what #2612 refused to do');
  const qual = PAGE.match(PROVIDER_SITES.qualName);
  assert.equal(qual[2], 'Claude',
    'the qualName fallback stopped guessing "Claude" for a non-openai provider: #2634 may be fixed, '
    + 'in which case this arm and the qualifier above should now AGREE and this pin needs rewriting');
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 🛑 THE GROUPING KEY IS CASE-INSENSITIVE TOO, AND IT WAS THE LAST EXACT-CASE
 * COMPARISON IN A FUNCTION WHOSE COMMENTS ALREADY CLAIMED OTHERWISE.
 *
 * Iterations 6 and 7 hardened every membership test (the reserved word, the
 * label, the provider id) and each of those sits DOWNSTREAM of the grouping.
 * The key itself stayed raw, and that is the one place where being wrong costs
 * the entire fix: rows that do not group are never counted ambiguous, so they
 * get NO qualifier at all and both controls answer to the person's bare name.
 *
 * ⭐ Worth keeping past this card: a claim of the form "X is true EVERYWHERE"
 * is a claim about a set, and the cheapest way to be wrong about it is to
 * enumerate the members you were already thinking about. Every exact-case
 * comparison this branch found and fixed was one it had already looked at; the
 * one it missed was upstream of all of them.
 * ───────────────────────────────────────────────────────────────────────────*/
test('#2612: two accounts whose NAME differs only by case still get qualifiers', () => {
  /* `name` is free-form text kept verbatim in a per-account `.kosmos-name`
     sidecar (engine/openaiaccounts.js), with no cross-account uniqueness, so
     naming two accounts "Work" and "work" is ordinary rather than contrived. */
  const a = { provider: 'openai', name: 'Work', dir: '/h/.codex-a', label: null, isDefault: false };
  const b = { provider: 'openai', name: 'work', dir: '/h/.codex-b', label: null, isDefault: false };
  const q = qualifiers([a, b]);
  assert.notEqual(q.get(a.dir), '',
    'a case-variant name did not group, so the row was never counted ambiguous and got NO '
    + 'qualifier: both controls now read the bare name and sound identical');
  assert.notEqual(q.get(b.dir), '', 'the sibling row is unqualified for the same reason');
  const heard = [q.get(a.dir), q.get(b.dir)].map((s) => String(s).toLowerCase());
  assert.equal(new Set(heard).size, 2, 'the two qualifiers sound alike: ' + JSON.stringify(heard));
  /* CONTROL: the exact-match spelling must already behave this way, or the
     assertions above are measuring something other than the case-insensitivity. */
  const qCtl = qualifiers([{ ...a, name: 'work' }, b]);
  assert.deepEqual(
    [qCtl.get(a.dir), qCtl.get(b.dir)], [q.get(a.dir), q.get(b.dir)],
    'the same two rows named identically get a different answer, so the key is still exact-case',
  );
});

/* The same defect via `email`, which is the key for every Claude row and is the
   field the original #2584 collision was keyed on. Kept separate from the name
   arm because they are different branches of the key expression: a change that
   normalises one and not the other must red exactly one of these. */
test('#2612: two accounts whose EMAIL differs only by case still get qualifiers', () => {
  const a = { provider: 'anthropic', email: 'Agent@Example.com', dir: '/h/.a', label: null, isDefault: false };
  const b = { provider: 'anthropic', email: 'agent@example.com', dir: '/h/.b', label: null, isDefault: false };
  const q = qualifiers([a, b]);
  const heard = [q.get(a.dir), q.get(b.dir)].map((s) => String(s).toLowerCase());
  assert.ok(heard.every((h) => h !== ''),
    'a case-variant email did not group, so neither row was qualified: ' + JSON.stringify(heard));
  assert.equal(new Set(heard).size, 2, 'the two qualifiers sound alike: ' + JSON.stringify(heard));
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 🛑 THE KEY IS `acctPrimaryName`, AND IT USED TO BE A STALE COPY OF IT.
 *
 * Iteration 9 (BLOCKER). The key was `name || email || keyTail` while the screen
 * renders `name || email || keyTail || label || dir`, so the key was a strict
 * PREFIX of what the row actually shows. Any row identified only by its label or
 * its dir keyed to '', was never counted ambiguous, and got NO qualifier: the
 * original #2584 bug, shipping, in the one function written to prevent it.
 *
 * ⭐ The cause is worth more than the fix: the key CARRIED ITS OWN COPY of
 * acctPrimaryName's chain and fell behind when that chain grew. It is the same
 * duplicated-fact drift as the two provider-id derivations, and the same remedy
 * applies, so the key now READS the helper instead of restating it.
 * ⚠️ Which is why the harness at the top of this file pulls acctPrimaryName in
 * rather than stubbing it: a stub would re-open exactly this gap.
 * ───────────────────────────────────────────────────────────────────────────*/
test('#2612: rows identified only by their LABEL still group and get qualifiers', () => {
  /* Both reachable, and read rather than assumed: engine/accounts.js returns a
     truthy account with email:null when oauthAccount carries neither
     emailAddress nor email, and engine/openaiaccounts.js returns
     {email:null, keyTail:null} for a chatgpt auth.json whose id_token will not
     decode. `.claude-work` and `.codex-work` are different namespaces, so this
     needs no case-sensitive volume. */
  const claude = { provider: 'anthropic', dir: '/home/.claude-work', label: 'work', email: null, apiKey: false };
  const openai = { provider: 'openai', authMode: 'chatgpt', dir: '/home/.codex-work', label: 'work', email: null, keyTail: null, name: null };
  const q = qualifiers([claude, openai]);
  const heard = [q.get(claude.dir), q.get(openai.dir)].map((s) => String(s).toLowerCase());
  assert.ok(heard.every((h) => h !== ''),
    'a label-identified row keyed to "" and was never counted ambiguous, so both reauth '
    + 'controls read "Sign in again as work" and answer to one name: ' + JSON.stringify(heard));
  assert.equal(new Set(heard).size, 2, 'the two qualifiers sound alike: ' + JSON.stringify(heard));
  /* CONTROL: the same pair WITH an email must already have worked, or this arm
     is measuring something other than the label branch of the key. */
  const qCtl = qualifiers([{ ...claude, email: 'a@x.com' }, { ...openai, email: 'a@x.com' }]);
  assert.equal(new Set([qCtl.get(claude.dir), qCtl.get(openai.dir)]).size, 2,
    'the email-identified pair collides too, so this arm is not isolating the label branch');
});

/* 🛑 `dir` IS THE LAST RESORT AND IT IS NOT EXEMPT FROM THE USED-SET. The
   comments called it "the collision-proof last resort", which is true of STRINGS
   and false of SOUNDS, and sound is the only thing this function protects.
   `list()` never yields one dir twice, but on a case-SENSITIVE volume
   `~/.claude-main` and `~/.claude-Main` are two directories that announce
   identically. This was the FIFTH instance of the case class on this card, in
   the last branch still exempt from it. */
test('#2612: two dirs differing only by case do not collide audibly', () => {
  const E = 'a@x.com';
  const lower = { provider: 'anthropic', email: E, dir: '/h/.claude-main', label: 'main', isDefault: false };
  const upper = { provider: 'anthropic', email: E, dir: '/h/.claude-Main', label: 'Main', isDefault: false };
  const q = qualifiers([lower, upper]);
  const heard = [q.get(lower.dir), q.get(upper.dir)].map((s) => String(s).toLowerCase());
  assert.equal(new Set(heard).size, 2,
    'both rows fell to a dir and the two dirs differ only by case, so the last-resort '
    + 'qualifier is the collision: ' + JSON.stringify(heard));
  /* CONTROL: a group with no case-variant dirs must be untouched, or the
     disambiguator is firing where nothing was wrong and every path grows a
     suffix nobody asked for. */
  const a = { provider: 'anthropic', email: E, dir: '/h/.claude-one', label: 'x', isDefault: false };
  const b = { provider: 'anthropic', email: E, dir: '/h/.claude-two', label: 'x', isDefault: false };
  const qCtl = qualifiers([a, b]);
  assert.equal(qCtl.get(b.dir), '/h/.claude-two',
    'a non-colliding dir was rewritten, so the disambiguator fires when it should not');
});

/* 🔑 `''` IS THE ONE VALUE AN AMBIGUOUS ROW MUST NEVER GET, because it is the
   signal for "not ambiguous, no qualifier needed": a row handed '' renders its
   bare name beside a sibling doing the same, which is the defect this function
   exists to prevent. An empty `dir` used to produce exactly that.
   ⚠️ Unreachable through `/api/accounts` (`list()` always supplies a real path),
   so this pins a property rather than guarding a live path, for the same reason
   the dir-keying guard exists: the function is pure and exported, and its whole
   defence is that a future caller cannot break it from a distance. */
test('#2612: an ambiguous row never receives the empty qualifier, even with no dir', () => {
  const E = 'a@x.com';
  const noDir = { provider: 'anthropic', email: E, dir: '', label: null, isDefault: false };
  const normal = { provider: 'anthropic', email: E, dir: '/h/.b', label: null, isDefault: false };
  const q = qualifiers([noDir, normal]);
  assert.notEqual(q.get(''), '',
    'a row sharing an ambiguous key got the empty qualifier, so it renders its bare name '
    + 'beside a sibling doing the same');
  const heard = [q.get(''), q.get(normal.dir)].map((s) => String(s).toLowerCase());
  assert.equal(new Set(heard).size, 2, 'the two sound alike: ' + JSON.stringify(heard));
  /* CONTROL: an UNAMBIGUOUS row must still get '' , or the assertion above has
     been satisfied by making every row carry a qualifier, which would put a
     pointless tag on every single-account screen. */
  const solo = qualifiers([{ provider: 'anthropic', email: 'only@x.com', dir: '', label: null }]);
  assert.equal(solo.get(''), '',
    'a row with no ambiguous sibling gained a qualifier, so every solo account now renders a tag');
});

/* 🔑 A NULL ROW MUST NOT THROW. Every other read in `accountQualifiers` guards
   with `a &&`; the `dir` read did not, so a caller handing in a sparse array got
   a TypeError from the single line that had no guard. Same pure-and-exported
   argument that justifies the dir-keying guard and the empty-dir fallback: this
   function's whole defence is that a caller cannot break it from a distance, and
   defending two of three reads is not that. */
test('#2612: a null row does not throw and does not disturb its neighbours', () => {
  const E = 'a@x.com';
  const a = { provider: 'anthropic', email: E, dir: '/h/.a', label: null, isDefault: false };
  const b = { provider: 'anthropic', email: E, dir: '/h/.b', label: null, isDefault: false };
  let q;
  assert.doesNotThrow(() => { q = qualifiers([null, a, b]); },
    'a null row threw; the dir read is missing its `a &&` guard');
  /* CONTROL: the real rows must still be qualified exactly as they are without
     the null, or "does not throw" has been satisfied by bailing out early. */
  const clean = qualifiers([a, b]);
  assert.deepEqual([q.get(a.dir), q.get(b.dir)], [clean.get(a.dir), clean.get(b.dir)],
    'the null row changed the answer for its neighbours, so it is not being skipped cleanly');
});
