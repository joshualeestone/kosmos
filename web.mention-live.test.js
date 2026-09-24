'use strict';
/**
 * #2922 part 2: the LIVE @-mention highlight in the project-room composer.
 *
 * Part 1 (PR #2954) blued @agent mentions in the POSTED message. This is the
 * other half Josh asked for: the name turns bright blue live in the input
 * (#pj-post) as it becomes a recognized agent on the project, so the person sees
 * it will flag that agent before they post. A native <textarea> cannot colour a
 * substring, so #pj-post is backed by a mirror (#pj-post-mirror) that renders the
 * same text with recognized @mentions in a colour-only span.
 *
 * The recognized-name rule MUST match the posted-message highlighter and the
 * backend (engine/messages.js), or the input and the message disagree about what
 * is a real mention. pjMentionHighlightHTML is self-contained (does its own
 * escaping, shares no helper) so it lifts and runs here in isolation. The render
 * contract (a real .pj-live-mention span, both themes, both engines) and the two
 * alignment-critical properties a source read cannot see -- colour-only-not-bold
 * and the mirror's metrics matching #pj-post -- are proven by
 * docs/browser-checks/render-mention-blue-2922.js. This pins the RULE and the
 * wiring that a browser check does not exercise on the input side.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* Lift the self-contained highlighter and run it against a fixed key set. */
function liftHighlighter() {
  const start = PAGE.indexOf('function pjMentionHighlightHTML');
  assert.ok(start > 0, 'pjMentionHighlightHTML must exist in web/index.html');
  const end = PAGE.indexOf('function pjMentionKeys', start);
  assert.ok(end > start, 'the highlighter must be bounded by pjMentionKeys');
  const body = PAGE.slice(start, end);
  // The function must not reach for any outside helper, or this lift would throw
  // ReferenceError -- which is itself the isolation guarantee the browser check relies on.
  return new Function(body + '; return pjMentionHighlightHTML;')();
}

const H = liftHighlighter();
const KEYS = new Set(['mona', 'renet-tilley', 'ice-cream-kitty']);
const h = (s) => H(s, KEYS);

test('a recognized @agent becomes a colour-only .pj-live-mention span', () => {
  assert.equal(h('hi @mona'), 'hi <span class="pj-live-mention">@mona</span>');
  assert.equal(h('@ice-cream-kitty'), '<span class="pj-live-mention">@ice-cream-kitty</span>');
});

test('a partial or unrecognized @name stays plain (only recognized names blue)', () => {
  // Josh: it turns blue when it RECOGNIZES the name, not while you are still typing it.
  assert.equal(h('hi @mon'), 'hi @mon');
  assert.equal(h('@nobody'), '@nobody');
  assert.equal(h('@Mona'), '@Mona'); // keys are exact-case, like the backend
});

test('@mona- highlights mona (the backend flags it by stripping the trailing -)', () => {
  assert.equal(h('@mona-'), '<span class="pj-live-mention">@mona</span>-');
  assert.equal(h('cc @mona.'), 'cc <span class="pj-live-mention">@mona</span>.');
  // not a key, and no trailing ._- to strip -> the backend does not flag it -> plain
  assert.equal(h('@mona_bar'), '@mona_bar');
});

test('leading emphasis and an open paren are peeled and re-attached around the span', () => {
  assert.equal(h('**@mona**'), '**<span class="pj-live-mention">@mona</span>**');
  assert.equal(h('(@mona)'), '(<span class="pj-live-mention">@mona</span>)');
  assert.equal(h('~@mona~'), '~<span class="pj-live-mention">@mona</span>~');
});

test('a leading underscore is NOT peeled, matching the backend boundary', () => {
  // engine/messages.js left boundary is (^|[^A-Za-z0-9._-])@ and _ is IN that class,
  // so _@mona_ is not a recipient; blueing it would falsely promise delivery.
  assert.equal(h('_@mona_'), '_@mona_');
});

test('trailing punctuation after a valid mention stays plain', () => {
  assert.equal(h('@renet-tilley, @mona!'),
    '<span class="pj-live-mention">@renet-tilley</span>, <span class="pj-live-mention">@mona</span>!');
});

test('HTML in the input is escaped', () => {
  assert.equal(h('<b>x</b> @mona'), '&lt;b&gt;x&lt;/b&gt; <span class="pj-live-mention">@mona</span>');
  assert.equal(h('a & b @mona'), 'a &amp; b <span class="pj-live-mention">@mona</span>');
});

test('whitespace and newlines are preserved; a trailing newline is padded', () => {
  // pre-wrap renders the whitespace; a trailing \n needs a character or the mirror is one line short.
  assert.equal(h('a\n@mona'), 'a\n<span class="pj-live-mention">@mona</span>');
  assert.equal(h('a\n@mona\n'), 'a\n<span class="pj-live-mention">@mona</span>\n ');
  assert.equal(h('two  spaces @mona'), 'two  spaces <span class="pj-live-mention">@mona</span>');
});

test('empty, null and undefined input are total (no throw, empty out)', () => {
  assert.equal(h(''), '');
  assert.equal(H(null, KEYS), '');
  assert.equal(H(undefined, KEYS), '');
});

test('an array of keys works as well as a Set', () => {
  assert.equal(H('@mona', ['mona']), '<span class="pj-live-mention">@mona</span>');
  assert.equal(H('@mona', []), '@mona');
});

test('the mirror markup and the aria-hidden wrapper ship with the composer', () => {
  assert.match(PAGE, /<div id="pj-post-mirror" aria-hidden="true"><div class="pj-mirror-in"><\/div><\/div>/);
});

test('the live mention is colour-only in CSS (no font-weight), so glyph widths do not drift', () => {
  const rule = PAGE.match(/\.pj-mirror-in \.pj-live-mention \{[^}]*\}/);
  assert.ok(rule, '.pj-live-mention rule must exist');
  assert.doesNotMatch(rule[0], /font-weight/, 'bolding the live mention would widen glyphs and drift the overlay');
  assert.match(rule[0], /color:\s*var\(--pj-mention\)/, 'the live mention wears the shared --pj-mention blue');
});

test('#pj-post text goes transparent under .mention-live but keeps an inked caret', () => {
  const rule = PAGE.match(/#pj-post\.mention-live \{[^}]*\}/);
  assert.ok(rule, '#pj-post.mention-live rule must exist');
  assert.match(rule[0], /color:\s*transparent/);
  assert.match(rule[0], /caret-color:\s*var\(--k-ink\)/, 'the caret must stay visible -- it is the focus signal');
});

test('the composerbox is positioned so the mirror can overlay the textarea, scoped to the room box', () => {
  assert.match(PAGE, /\.pjmid \.composer \.composerbox \{ position: relative; \}/);
});

test('pjGrowComposer repaints the mirror for #pj-post (covers every programmatic value set)', () => {
  const start = PAGE.indexOf('function pjGrowComposer');
  const body = PAGE.slice(start, PAGE.indexOf('\nfunction ', start + 1));
  assert.match(body, /el\.id === 'pj-post'/);
  assert.match(body, /pjMentionPaint\(\)/);
});

test('the mirror stays live via the scroll/resize listeners and the pjGrowComposer input path', () => {
  // The input case rides on pjGrowComposer (asserted above) to avoid painting twice per
  // keystroke, so there is deliberately NO direct 'input' -> pjMentionPaint binding.
  assert.doesNotMatch(PAGE, /getElementById\('pj-post'\)\.addEventListener\('input', pjMentionPaint\)/,
    'a direct input->pjMentionPaint binding would repaint twice per keystroke (grow already paints)');
  assert.match(PAGE, /getElementById\('pj-post'\)\.addEventListener\('scroll'/);
  assert.match(PAGE, /window\.addEventListener\('resize', pjMentionPaint\)/);
});
