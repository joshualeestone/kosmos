'use strict';

/**
 * #980 spec pins (Josh, 2026-08-26 08:31): the boxless consolidated view's
 * rulings that no other test file pins -- one pin per ruling, so none of
 * them can be reverted silently. The grid skeleton, the flat thread and the
 * Files/Members order are pinned in their pre-existing files; this file
 * carries the rest.
 *
 *   node --test web.consolidated-980.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const cons = 'html\\[data-layout="consolidated"\\] body\\.consolidated';

test('the open project stays lit: a persistent .open state, written on click and on repaint', () => {
  assert.match(PAGE, new RegExp(cons + ' \\.pj-row\\.open \\{ background: var\\(--k-surface\\); box-shadow: 0 0 0 1px var\\(--k-rule\\); \\}'),
    'the selected-project style is gone; hover alone cannot say which project is on screen');
  assert.match(PAGE, /p\.id === PJ_CURRENT \? ' open' : ''/,
    'the painter no longer writes .open on repaints');
  assert.match(PAGE, /querySelectorAll\('#pj-list \.pj-row'\)\.forEach\(\(r\) => r\.classList\.toggle\('open', r\.dataset\.project === id\)\)/,
    'openProject no longer toggles .open on the click itself (selection would wait for the next repaint)');
});

test('the search placeholder follows the EFFECTIVE view, in showTab, not the saved layout', () => {
  const st = PAGE.slice(PAGE.indexOf("document.body.classList.toggle('consolidated', cons)"), PAGE.indexOf("document.body.classList.toggle('consolidated', cons)") + 1400);
  assert.match(st, /roomSearch\.placeholder = cons \? 'Search' : roomSearch\.dataset\.longPlaceholder/,
    'the placeholder swap left showTab (or the tab-view restore stopped reading the markup-captured wording, so a markup edit could be silently reverted)');
  assert.match(st, /if \(!roomSearch\.dataset\.longPlaceholder\) roomSearch\.dataset\.longPlaceholder = roomSearch\.placeholder/,
    'the long wording is no longer captured from the markup once at first toggle');
  const al = PAGE.slice(PAGE.indexOf('function applyLayout('), PAGE.indexOf('function applyLayout(') + 1200);
  assert.doesNotMatch(al, /placeholder =/,
    'applyLayout swaps the placeholder again -- that keys on the SAVED layout and goes stale across the 960px resize');
});

test('the state chatter is hidden, but a needs-you row keeps its inline Answer action', () => {
  assert.match(PAGE, new RegExp(cons + ' \\.lrow > \\.lstate:not\\(:has\\(\\.ansgo\\)\\) \\{ display: none; \\}'),
    'the .lstate hide lost its Answer carve-out (or hides unconditionally again, severing the needs-you action)');
  assert.match(PAGE, new RegExp(cons + ' \\.lrow:has\\(\\.lstate \\.ansgo\\) > \\.lav \\{ grid-row: 1 \\/ span 3; \\}'),
    'the avatar no longer spans the Answer row, so the kept .lstate misaligns');
});

test('each fold hides its OWN rail label, and only its own', () => {
  assert.match(PAGE, new RegExp(cons + '\\.fold-a #rail-agents \\.railname \\{ display: none; \\}'),
    'the fold-a railname hide lost its #rail-agents scope (unscoped, folding agents blanked the PROJECTS label)');
  assert.match(PAGE, new RegExp(cons + '\\.fold-p #rail-projects \\.railname \\{ display: none; \\}'),
    'folding projects no longer hides its own label, which overflowed the 48px strip as clipped letters');
});

test('the pre-rail grid rows are auto, never 0: the notice surfaces must be able to show', () => {
  // #askcard (a phone asking to pair), #conn (subscription unreachable) and
  // #board-msg are auto-placed body children. In a 0-height track they
  // painted under the rails' opaque grounds -- a pairing request nobody
  // can see. auto tracks collapse while hidden and give them height the
  // moment they show; this is the layout's load-bearing safety property.
  assert.match(PAGE, new RegExp(cons + ' \\{[^}]*grid-template-rows: repeat\\(38, auto\\) auto minmax\\(0, 1fr\\) auto;', 's'),
    'the pre-rail rows are not auto tracks -- a visible notice surface can vanish under the rails again');
  for (const id of ['id="askcard"', 'id="conn"', 'id="board-msg"']) {
    assert.ok(PAGE.includes(id), id + ' is gone; re-derive whether the auto-rows invariant still protects the right surfaces');
  }

  // The 38-track headroom is a real number: the 39th simultaneously
  // renderable auto-placed body child would spill into an implicit row
  // below the clipped viewport -- the same invisible-surface failure the
  // auto rows exist to prevent. Count the body's direct element children
  // with a small depth tracker (comments stripped) and hold the margin.
  // Script BODIES are stripped before counting (their JS builds tag-like
  // strings that drift the depth tracker; verified: without this the depth
  // ends at +23 and only ordering luck kept the count right); the empty
  // <script></script> shells stay so the elements themselves are counted.
  const bodyHtml = PAGE.slice(PAGE.indexOf('<body'), PAGE.indexOf('</body>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2');
  let depth = 0, children = 0;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  const voidTags = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'use', 'stop',
    'area', 'base', 'col', 'embed', 'track', 'wbr', 'param']);
  let m2;
  while ((m2 = tagRe.exec(bodyHtml)) !== null) {
    const [, close, tag, attrs] = m2;
    if (tag === 'body') continue;
    if (close) { depth--; continue; }
    if (depth === 0) children++;
    if (!voidTags.has(tag.toLowerCase()) && !/\/\s*$/.test(attrs)) depth++;
  }
  assert.ok(children <= 38, 'the body has ' + children + ' direct children; the consolidated grid reserves 38 pre-rail auto rows, and past it a visible notice can be silently clipped. Widening repeat(38, auto) is a FIVE-site renumbering: the rails\' explicit rows must move with it (#rail-agents 39, #alist 40, #rail-me 41, #panel-projects 39 / span 3), or all four land inside the widened pre-rail range');
  assert.ok(children >= 20, 'the body child counter read ' + children + ', implausibly low -- the counter itself has likely broken, re-derive before trusting the headroom claim');
  assert.equal(depth, 0, 'the child counter ended at depth ' + depth + ', not 0 -- it is mis-parsing the markup and its count cannot be trusted');
});

test('the remaining #980 rulings each keep their pin', () => {
  // One pin per ruling is this file's contract; these four had none.
  assert.match(PAGE, new RegExp(cons + '\\.fold-a #alist \\.pj-empty \\{ display: none; \\}'),
    'the folded 48px strip shows the letter-wrapped empty-state card again');
  assert.match(PAGE, new RegExp(cons + ' \\.pj-member \\.lav\\.pj-face \\{ width: 28px; height: 28px; flex: 0 0 28px; aspect-ratio: 1; \\}'),
    'the member avatar lost its shrink-proof 1:1 pin; a long name can squish it out of round again');
  assert.match(PAGE, new RegExp(cons + ' \\.pjmidhead \\.pjhead \\.pj-desc \\{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; \\}'),
    'the header description no longer truncates to one line');
  assert.match(PAGE, /desc\.title = p\.description \|\| ''/,
    'the truncated description lost its full-text hover (the title the truncation comment promises)');
  assert.match(PAGE, new RegExp(cons + ' \\.pjmid \\.composerbox textarea\\.cinput \\{ scrollbar-width: none; -ms-overflow-style: none; \\}'),
    'the composer textarea shows its scrollbar track again');
});

test('every projects sub-view scrolls inside the no-page-scroll grid', () => {
  // The page used to grow and scroll; with body overflow hidden, a view
  // without its own overflow is clipped with no scrollbar and no wheel
  // target -- Project settings' bottom controls unreachable.
  assert.match(PAGE, new RegExp(cons + ' #pj-settings-view, ' + cons + ' #pj-task-view,\\n\\s*' + cons + ' #pj-docs-view, ' + cons + ' #pj-add-view \\{ min-height: 0; overflow-y: auto; \\}'),
    'a projects sub-view lost its scroll path under the viewport-height grid');
  assert.match(PAGE, new RegExp(cons + ' #pj-list-view \\{ min-height: 0; overflow-y: auto;'),
    'the projects list view lost its scroll');
});

test('the projects rail header pins over its scrolling list, like the agents header', () => {
  assert.match(PAGE, new RegExp(cons + ' #rail-projects \\{ position: sticky; top: 0; z-index: 4; background: var\\(--k-side, #f3f1ec\\);'),
    'the projects header scrolls away with a long list while the agents header stays -- the two rails answer the same gesture differently');
});

test('the two auto-row cards carry viewport caps a tall list cannot game', () => {
  // Measured in review: with 30 rows in Tasks and Files, %-caps against
  // content-sized tracks let both grow ~460px and push Members off-screen.
  assert.match(PAGE, new RegExp(cons + ' \\.pj3 > aside\\.pjcol:not\\(\\.pjsplit\\), ' + cons + ' \\.pj3 > \\.pjsplit > \\.pjcard:last-child \\{ max-height: 38vh; \\}'),
    'Tasks/Files lost their viewport caps; tall content can push Members off the bottom again');
  assert.match(PAGE, new RegExp(cons + ' \\.pj3 > \\.pjsplit > \\.pjcard:first-child \\{ max-height: 100%; \\}'),
    'Members lost its track-bounded cap');
});
