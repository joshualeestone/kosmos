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
const CODE = codeOnly(fs.readFileSync(PAGE_PATH, 'utf8'));

/* A BARE avatar URL: `/avatar` closing its string literal rather than continuing into
   a query string. `?v=` (the fix) and `?t=` (a timestamp bust) both continue. */
const BARE = /\/avatar(["'`])/;

/* Lines that carry an avatar URL and are NOT renderings. `fetch(...)` for upload and
   delete puts the same path in a string whose closing quote looks identical. */
const NOT_A_RENDERING = /fetch\(/;

/**
 * Bare URLs that are FINE, each with the paint call that makes it fine. Keyed on a
 * distinctive substring of the LINE, not on a function name: a name is something a
 * stranger's code can be written next to and inherit (that was escape 2), and a
 * rename leaves a name-shaped hole behind.
 */
const ALLOWED_BARE = [
  {
    match: '<image href="/api/agent/${encodeURIComponent(a.sessionName)}/avatar"',
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
    why: "lrow(): the agents list. document.getElementById('alist').innerHTML = ..., "
      + 'a direct assignment, rebuilt every poll.',
  },
  {
    match: "encodeURIComponent(fresh.sessionName) + '/avatar\" alt=\"\"></div>'",
    why: 'busyRow(): el.innerHTML = busyRow(...), a direct assignment.',
  },
  {
    match: "encodeURIComponent(m.from) +",
    why: 'pjRoomRow(): room message senders, painted via paintThreadInto -> setLive, '
      + 'so this one IS behind a skip and IS stale. kosmos#2770. A message row is not '
      + 'a member row, so there is no avatarVer to pass through yet; that is the work '
      + 'of that card.',
  },
];

/** Every line carrying an agent-avatar URL, with its 1-based line number. */
function avatarLines() {
  return CODE.split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter((e) => /\/avatar/.test(e.text))
    .filter((e) => !/\/api\/you\/avatar/.test(e.text));   // the operator's own picture, its own route and its own version
}

function classify(e) {
  if (!BARE.test(e.text)) return 'busted';
  if (NOT_A_RENDERING.test(e.text)) return 'call';
  const hit = ALLOWED_BARE.find((a) => e.text.includes(a.match));
  return hit ? 'allowed' : 'UNCLASSIFIED';
}

test('#2762: no rendered avatar URL is bare, unless it is listed with a reason', () => {
  const all = avatarLines();
  assert.ok(all.length >= 8,
    'the sweep found almost no avatar URLs, so its matcher has probably stopped working: ' + all.length);

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
    assert.ok(hits.some((e) => BARE.test(e.text)),
      'ALLOWED_BARE entry no longer matches a BARE url (it has been fixed): ' + JSON.stringify(a.match)
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
