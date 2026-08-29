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
   ONE. The row builder has two branches: Anthropic rows get a disabled
   `Disconnect`, OpenAI rows get a live `Remove` (#1372 made it real earlier the
   same day). The first version of this fix qualified `Disconnect` and left
   `Remove` naming itself by login alone, so the defect survived intact on the
   OpenAI arm while the visible span made the screen LOOK disambiguated. Angel
   caught it in review, on the exact case the key-tail test above constructs.
   ⇒ A guard covering one of two branches is how the other branch stays broken. */
test('the Disconnect control carries the qualifier, because that is the name the check reads', () => {
  assert.match(PAGE, /aria-label="Disconnect ' \+ who \+ \(qual \? ' \(' \+ qual \+ '\)' : ''\)/,
    'the Disconnect button is back to naming itself by login alone, so two of them answer to one name again');
});

test('the Remove control carries it too, or the OpenAI arm keeps the whole defect', () => {
  assert.match(PAGE, /aria-label="Remove ' \+ who \+ \(qual \? ' \(' \+ qual \+ '\)' : ''\)/,
    'the Remove button names itself by login alone, so two OpenAI rows sharing a key tail give two controls called "Remove API key ending ...", which is the bug this branch exists to fix');
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
