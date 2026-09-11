/**
 * #2762: every avatar URL the page RENDERS must bust its cache, or be listed with a
 * reason.
 *
 * 🔑 THE DEFECT CLASS. Renderers painted through an identical-HTML repaint skip
 * (`setLive`: `if (el.__lastLive === html) return`) never recreate their <img>, so a
 * BARE `/api/agent/<name>/avatar` keeps the OLD picture after a profile-image update.
 * #2698 fixed the org chart. #2762 was the same bug on the project task list, found
 * separately, months later. A third instance was found while fixing #2762, and a
 * fourth is carded (#2770). The class needs one check that asks the question of the
 * WHOLE PAGE, not one arm per renderer.
 *
 * 🛑 THIS FILE HAS BEEN WRONG THREE TIMES AND THE THIRD IS WHY IT LOOKS LIKE THIS.
 *   v1: the regex required `/api/agent/` and `/avatar` to be CONTIGUOUS. Most
 *       renderers concatenate with quotes between, so it matched almost nothing;
 *       reverting two renderers left it green. Its control used a single-literal URL
 *       no renderer on this page uses, so the control certified the blind spot.
 *   v2: it claimed to cover "every renderer, including ones nobody has written yet"
 *       and was a hardcoded four-NAME array, with a known-broken fifth silently
 *       outside it.
 *   v3: it enumerated emissions but keyed on (a) a per-line `<img` filter and (b) the
 *       nearest preceding `function` declaration. A review broke it four ways, each
 *       leaving the file green:
 *         - an SVG `<image href=` emission (the shape `face()` ALREADY USES in this
 *           file: `<img` is not a prefix of `<image`, so the filter never saw it);
 *         - a `const`/arrow renderer placed after a carved-out function, which
 *           INHERITED that function's carve-out;
 *         - the URL extracted into a helper (the page already does this for
 *           `youPicUrl`), so neither line had both halves;
 *         - a concatenation wider than the fixed 3-line lookback.
 *
 * ⇒ SO THIS VERSION CLASSIFIES LINES, NOT FUNCTIONS, AND HAS NO WINDOW. Every line
 * carrying an avatar URL must be one of: cache-busted (`/avatar?...`), a `fetch()`
 * call rather than a rendering, or listed in ALLOWED_BARE with a reason. There is no
 * function-name attribution left to inherit and no window to overflow, which is what
 * killed all four escapes.
 *
 * ⚠️ It is still a source-shape check. It cannot tell you a version is CORRECT, only
 * that an un-busted URL is not being rendered. The behavioural arms live in
 * web.task-card-761.test.js and docs/browser-checks/render-alltasks.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./test-support/code-only');

const PAGE_PATH = path.join(__dirname, 'web', 'index.html');
/* Comments stripped both directions (#1080's shared helper): this file's prose
   mentions avatar URLs, and a renderer's comment must never satisfy or break an
   assertion about its code. */
const RAW = fs.readFileSync(PAGE_PATH, 'utf8');
const CODE = codeOnly(RAW);

/* 🛑 A POSITIVE TEST FOR A QUERY STRING, NOT "not followed by a quote".
   The previous version asked `/\/avatar(["'`])/` and called everything else busted,
   which FAILS OPEN: anything that is not immediately a quote passes. Measured, these
   all classified as busted while carrying no query at all:
       `/avatar${avQ(a)}"`          template interpolation
       '/avatar' + EOL              the closing quote on the next line
   And the realistic one, which is the next thing somebody will write when they fix
   the carded #2770 by routing every avatar URL through one helper:
       function avQ(row) { return row.avatarVer ? '?v=' + row.avatarVer : ''; }
   Message rows carry no avatarVer, so that returns '', the URL is bare at runtime, it
   is painted through paintThreadInto -> setLive, and it is #2762 verbatim.
   Asking for the `?` instead means every one of those fails CLOSED. */
const BUSTED = /\/avatar\?/;

/* Lines that carry an avatar URL and are NOT renderings. `fetch(...)` for upload and
   delete puts the same path in a string whose closing quote looks identical.

   🛑 AND THE EXEMPTION IS NARROWED, because `contains fetch(` alone is too broad: a
   single line can BOTH render markup and call fetch, and would then be exempted while
   shipping a bare URL. Measured, the loose rule exempts this:
       el.innerHTML = '<img src="/api/agent/' + n + '/avatar">'; fetch("/x");
   So a line only counts as a call if it ALSO emits nothing image-shaped. That is the
   same "an exemption must not be wider than the thing it names" rule the ALLOWED_BARE
   count guard enforces. */
const LOOKS_LIKE_MARKUP = /<img|<image|src=|href=/;
const NOT_A_RENDERING = (line) => /\bfetch\(/.test(line) && !LOOKS_LIKE_MARKUP.test(line);

/**
 * Bare URLs that are FINE, each with the paint call that makes it fine. Keyed on a
 * distinctive substring of the LINE, not on a function name: a name is something a
 * stranger's code can be written next to and inherit (that was escape 2), and a
 * rename leaves a name-shaped hole behind.
 */
const ALLOWED_BARE = [
  {
    match: '<image href="/api/agent/${encodeURIComponent(a.sessionName)}/avatar"',
    /* 🔑 THE PAINT STRING NAMES THE RENDERER, not just the element. An element can be
       painted from more than one place: `getElementById('alist').innerHTML =` appears
       TWICE (the lrow paint and an error message), so a guard keyed on the element
       alone stayed satisfied by the OTHER site when the renderer's own paint was moved
       behind setLive. Measured: that mutant survived 11/11. Same shape as the
       ALLOWED_BARE count bug, one field over. */
    paint: "getElementById('grid').innerHTML = shown.length ? shown.map(card)",
    why: 'face(): the agent-grid SVG ring. Reaches the DOM only through card() -> '
      + "document.getElementById('grid').innerHTML = ..., a direct assignment that "
      + 'recreates the element every poll, and the avatar route is no-store.',
  },
  {
    match: '`<img src="/api/agent/${encodeURIComponent(a.sessionName)}/avatar" alt="">`',
    /* lrow draws this twice (the not-running row and the live row), so the expected
       count is 2. Declared rather than loosened to "one or more": a THIRD copy is a
       new renderer inheriting this exemption, which is the hole the count closes. */
    count: 2,
    paint: "getElementById('alist').innerHTML = shown.length ? shown.map(lrow)",
    why: "lrow(): the agents list. document.getElementById('alist').innerHTML = ..., "
      + 'a direct assignment, rebuilt every poll.',
  },
  {
    match: "encodeURIComponent(fresh.sessionName) + '/avatar\" alt=\"\"></div>'",
    paint: '.innerHTML = busyRow(',
    why: 'busyRow(): el.innerHTML = busyRow(...), a direct assignment.',
  },
  {
    match: "encodeURIComponent(m.from) +",
    /* No `paint:`: this one is NOT excused by a direct assignment. It IS behind a
       skip and IS stale, which is why it carries a card instead. */
    why: 'pjRoomRow(): room message senders, painted via paintThreadInto -> setLive, '
      + 'so this one IS behind a skip and IS stale. kosmos#2770. A message row is not '
      + 'a member row, so there is no avatarVer to pass through yet; that is the work '
      + 'of that card.',
  },
];

/* 🛑 LINE NUMBERS COME FROM THE RAW FILE, NOT THE STRIPPED COPY. `codeOnly` DELETES
   comment lines (44,975 raw -> 23,785 stripped here), so numbering the stripped copy
   made every location this sweep reports point at unrelated code: the `face` emission
   was reported as :6640, which in web/index.html is a comment about buttons. The list
   of locations IS this check's entire output when it fires, so a wrong number is the
   failure. Raw lines are walked for numbering; the stripped copy decides only whether
   a line is CODE, which keeps one derivation of comment-stripping (#1080). */
const CODE_LINES = new Set(CODE.split('\n').map((l) => l.trim()).filter(Boolean));

/** Every line carrying an agent-avatar URL, numbered against web/index.html itself. */
function avatarLines() {
  return RAW.split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter((e) => /\/avatar/.test(e.text))
    .filter((e) => CODE_LINES.has(e.text));   // drop lines codeOnly removed (comments)
}

function classify(e) {
  if (BUSTED.test(e.text)) return 'busted';
  if (NOT_A_RENDERING(e.text)) return 'call';
  const hit = ALLOWED_BARE.find((a) => e.text.includes(a.match));
  return hit ? 'allowed' : 'UNCLASSIFIED';
}

test('#2762: no rendered avatar URL is bare, unless it is listed with a reason', () => {
  const all = avatarLines();
  /* A floor with slack lets a refactor that collapses emissions keep this green. The
     real count today is 14; assert close to it, and make a DROP say so loudly. */
  assert.ok(all.length >= 12,
    'the sweep found ' + all.length + ' avatar URLs and expected at least 12. Either the '
    + 'matcher stopped working, or emissions were collapsed and this floor needs revisiting '
    + 'DELIBERATELY rather than by leaving slack.');

  const bad = all.filter((e) => classify(e) === 'UNCLASSIFIED');
  assert.deepEqual(bad.map((e) => 'web/index.html:' + e.line + '  ' + e.text.slice(0, 90)), [],
    'these lines RENDER a bare avatar URL and are on no list. If the markup is painted through '
    + 'setLive / setIfChanged / paintThreadInto, the <img> is never recreated and the face goes '
    + 'stale after a profile-image update: append `?v=` the avatar version (#2698, #2762). If it '
    + 'is assigned straight to innerHTML every poll, add it to ALLOWED_BARE with the paint call '
    + 'as the reason.');
});

test('#2762: every ALLOWED_BARE entry still matches something, so the list cannot rot', () => {
  /* Mirrors the guard KNOWN_BROKEN had and DIRECT_ASSIGNMENT (v3) did not: an entry
     for a renderer that has been renamed, deleted or FIXED is a permanent hole in the
     sweep, and nothing would say so. */
  const all = avatarLines();
  for (const a of ALLOWED_BARE) {
    const hits = all.filter((e) => e.text.includes(a.match));
    assert.ok(hits.length > 0,
      'ALLOWED_BARE entry matches nothing any more: ' + JSON.stringify(a.match)
      + '. It was renamed, deleted, or fixed. Remove the entry so the sweep covers that ground again.');
    assert.ok(hits.some((e) => !BUSTED.test(e.text)),
      'ALLOWED_BARE entry no longer matches an un-busted url (it has been fixed): ' + JSON.stringify(a.match)
      + '. Remove the entry.');
    /* 🔑 EXACTLY ONE. A carve-out that matches two lines excuses the second one for
       free, which is how a new renderer inherits an old renderer's exemption: it was
       escape 2 keyed on a function name, and it came straight back when the key was a
       generic substring instead. An entry names ONE line or it is not specific enough. */
    const want = a.count === undefined ? 1 : a.count;
    assert.equal(hits.length, want,
      'ALLOWED_BARE entry ' + JSON.stringify(a.match) + ' matches ' + hits.length
      + ' lines, expected ' + want + ': ' + JSON.stringify(hits.map((e) => 'web/index.html:' + e.line))
      + '. If a NEW renderer copied this shape it is inheriting an exemption it was never '
      + 'granted; give it its own entry or version its URL. If this renderer legitimately '
      + 'draws N times, set `count`.');
  }
});

test('#2762: each carve-out PROVES its reason, so it cannot outlive the paint path', () => {
  /* The three existing guards catch renamed / deleted / fixed. None catches THE PAINT
     PATH CHANGING, which is the only way a direct-assignment excuse becomes wrong.
     Measured on the previous version: rewriting `el.innerHTML = busyRow(...)` to
     `setLive(el, busyRow(...))` put a real stale face on screen and left the sweep
     9/9 green, with the entry still reading "a direct assignment, rebuilt every poll".
     The reason is the whole justification, so it has to be checkable. */
  for (const a of ALLOWED_BARE) {
    if (!a.paint) continue;   // the known-stale entry is excused by a card, not a paint call
    assert.ok(CODE.includes(a.paint),
      'the paint call that justifies this carve-out is gone: ' + JSON.stringify(a.paint)
      + '. If that renderer moved behind setLive / setIfChanged / paintThreadInto it is now '
      + 'STALE and must version its URL (#2762); the entry is no longer true.');
  }
});

test('#2762: the operator own picture is versioned too, and that is ASSERTED not assumed', () => {
  /* 🛑 THE ONE CARVE-OUT WITH NO GUARD. `/api/you/avatar` lines are filtered out of the
     sweep entirely by avatarLines(), on the grounds that the operator's picture has its
     own route and its own version. That is true today and nothing kept it true -- and
     it matters, because `youPicUrl()` is rendered INSIDE pjRoomRow, which the plan
     itself documents as painted through paintThreadInto -> setLive. Measured: removing
     the version from youPicUrl left the whole file 9/9 green while putting the exact
     #2762 defect on the operator's own face, behind the exact same skip. */
  assert.match(CODE, /function youPicUrl\(\)\s*\{[^}]*\/api\/you\/avatar\?v=/,
    'youPicUrl no longer versions the operator picture. It is rendered inside pjRoomRow, '
    + 'which is painted through paintThreadInto -> setLive, so a bare URL there is #2762 '
    + 'on the operator own face. Either version it or stop filtering /api/you/avatar out '
    + 'of this sweep.');
  const youLines = RAW.split('\n').filter((l) => /\/api\/you\/avatar/.test(l) && /<img|src=/.test(l));
  for (const l of youLines) {
    assert.ok(/youPicUrl\(\)/.test(l) || /\/avatar\?/.test(l),
      'a rendered /api/you/avatar URL bypasses youPicUrl() and carries no query: ' + l.trim().slice(0, 100));
  }
});

test('#2762: the one KNOWN-STALE entry names its card', () => {
  const stale = ALLOWED_BARE.find((a) => /kosmos#\d+/.test(a.why));
  assert.ok(stale, 'no entry cites a card. pjRoomRow is behind a repaint skip and IS stale; '
    + 'if it has been fixed, remove its entry rather than leaving an uncited exclusion.');
  assert.match(stale.why, /kosmos#2770/);
});

/* ─────────── controls: the sweep must CATCH the shapes that escaped v3 ───────────
   These inject a renderer into a COPY of the page source and re-run the classifier.
   v3's control tested the regex against two hand-written strings and never tested the
   filter or the function-attribution, which is where every escape lived. A control
   has to resemble its subject. */
function classifyInjected(snippet) {
  const injected = CODE.replace('function tkFace(', snippet + '\nfunction tkFace(');
  assert.notEqual(injected, CODE, 'the injection anchor no longer matches, so this control is vacuous');
  return injected.split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter((e) => /\/avatar/.test(e.text) && !/\/api\/you\/avatar/.test(e.text))
    .filter((e) => classify(e) === 'UNCLASSIFIED')
    .length;
}

test('#2762 CONTROL: an SVG <image href> renderer is CAUGHT (escape 1, the shape face() uses)', () => {
  assert.ok(classifyInjected(
    'function newSvgFace(who) {\n'
    + '  return `<svg viewBox="0 0 40 40"><image href="/api/agent/${encodeURIComponent(who.sessionName)}/avatar" x="0"/></svg>`;\n'
    + '}') > 0,
    'an SVG <image href> avatar renderer was not flagged. `<img` is not a prefix of `<image`, '
    + 'which is exactly how face() escaped the previous version of this sweep.');
});

test('#2762 CONTROL: an arrow renderer next to a carved-out one is CAUGHT (escape 2)', () => {
  assert.ok(classifyInjected(
    "const roomFace = (a) => a.hasAvatar\n"
    + "  ? '<span class=\"lav\"><img src=\"/api/agent/' + encodeURIComponent(a.sessionName) + '/avatar\" alt=\"\"></span>'\n"
    + "  : '<span class=\"lav\">?</span>';") > 0,
    'an arrow-function renderer was not flagged. The previous version attributed emissions to the '
    + 'nearest preceding `function` declaration, so a renderer written next to a carved-out one '
    + 'inherited its carve-out.');
});

test('#2762 CONTROL: a renderer whose URL comes from a helper is CAUGHT (escape 3)', () => {
  /* The helper line itself carries the bare URL, which is the point: classifying LINES
     means the URL cannot hide by being one function away from the markup. */
  assert.ok(classifyInjected(
    "function agentPicUrl(n) { return '/api/agent/' + encodeURIComponent(n) + '/avatar'; }") > 0,
    'a URL-building helper was not flagged, so a renderer can put the bare URL one function away');
});

test('#2762 CONTROL: a wide multi-line concatenation is CAUGHT (escape 4)', () => {
  assert.ok(classifyInjected(
    "function wideFace(a) {\n  const p1 = '<span class=\"lav\">';\n  const p2 = '<img src=\"';\n"
    + "  const p3 = '/api/agent/';\n  const p4 = encodeURIComponent(a.sessionName);\n"
    + "  const p5 = '/avatar\" alt=\"\">';\n  return p1 + p2 + p3 + p4 + p5;\n}") > 0,
    'a renderer whose markup spans more lines than any fixed lookback was not flagged');
});

test('#2762 CONTROL: a correctly VERSIONED renderer is NOT flagged', () => {
  /* The other direction: a sweep that flags everything is as useless as one that
     flags nothing, and would train the next reader to add carve-outs to quiet it. */
  assert.equal(classifyInjected(
    "function okFace(a) {\n"
    + "  return '<img src=\"/api/agent/' + encodeURIComponent(a.sessionName) + '/avatar?v=' + (a.avatarVer || 0) + '\" alt=\"\">';\n"
    + "}"), 0,
    'a correctly versioned renderer was flagged, so this sweep would fail on correct code');
});

test('#2762 CONTROL: a line that BOTH renders and fetches is not exempted by the fetch rule', () => {
  /* The exemption for upload/delete calls must not become a way to carry a bare
     rendering. Measured: the loose `contains fetch(` rule exempted this line. */
  const both = `el.innerHTML = '<img src="/api/agent/' + n + '/avatar">'; fetch("/x");`;
  assert.equal(NOT_A_RENDERING(both), false,
    'a line that renders a bare avatar URL was exempted merely because it also calls fetch()');
  const realCall = `    const res = await fetch('/api/agent/' + encodeURIComponent(forAgent) + '/avatar', { method: 'DELETE' });`;
  assert.equal(NOT_A_RENDERING(realCall), true,
    'a genuine upload/delete fetch is no longer exempted, so the sweep would flag calls as renderings');
});
