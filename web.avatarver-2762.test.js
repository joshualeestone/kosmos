/**
 * #2762: every avatar emission in the page is CLASSIFIED, and the ones behind an
 * identical-HTML repaint skip must version their URL.
 *
 * 🔑 WHY A SWEEP AND NOT A LIST OF NAMES. The defect is not "one function forgot a
 * query string". It is that the page has several renderers of the same face, and
 * the ones painted through a skip (`setLive`: `if (el.__lastLive === html) return`)
 * never recreate their <img>, so a bare URL keeps the OLD picture after a
 * profile-image update. #2698 fixed the org chart. #2762 was the SAME bug on the
 * task list, found separately, months later. A fifth was found while fixing #2762.
 *
 * 🛑 AND THE FIRST VERSION OF THIS FILE MADE EXACTLY THE MISTAKE IT EXISTS TO
 * PREVENT. It said it covered "every renderer, including ones nobody has written
 * yet" and was in fact a hardcoded four-name array. A known-broken fifth
 * (`pjRoomRow`, kosmos#2770) was not in it and the file was 6/6 green, with no hint
 * to a reader that anything had been excluded. A review caught it.
 *
 * So this version ENUMERATES every `/avatar` emission in the page and requires each
 * one to be classified. A renderer nobody has written yet fails the sweep until
 * somebody says which kind it is, which is the only way this catches the next one.
 *
 * THE RULE:
 *   painted through setLive / setIfChanged / paintThreadInto  -> MUST version
 *   assigned straight to innerHTML every poll                 -> bare is fine,
 *     because the <img> is recreated each poll and the route is `no-store`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./test-support/code-only');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Comments stripped BOTH directions (#1080's shared helper): this file's own prose
   mentions avatar URLs, and a renderer's comment must never satisfy or break an
   assertion about its code. */
const CODE = codeOnly(PAGE);
const LINES = CODE.split('\n');

/** Nearest enclosing top-level function name for a line index. */
function ownerOf(i) {
  for (let j = i; j >= 0; j -= 1) {
    const m = /^\s*function ([A-Za-z0-9_$]+)\s*\(/.exec(LINES[j]);
    if (m) return m[1];
  }
  return '<top level>';
}

/* A BARE avatar emission: `/avatar` closing its string literal rather than
   continuing into `?v=`.

   ⚠️ The first version required `/api/agent/` and `/avatar` to be CONTIGUOUS. Most
   renderers build the URL by CONCATENATION, with quote characters between the two
   halves, so it matched none of them: reverting two renderers left the file green.
   Its control used a single-literal URL no renderer on this page uses, so the
   control certified the blind spot instead of catching it. */
const BARE = /\/avatar(["'`])/;
const ANY_AVATAR = /\/avatar[?"'`]/;

/* Renderers whose output is assigned straight to innerHTML every poll, so a bare
   URL refreshes on its own. Each entry is a claim you can check by finding the
   paint call. */
const DIRECT_ASSIGNMENT = {
  face: "grid.innerHTML = ... (agent grid, rebuilt every poll)",
  lrow: "document.getElementById('alist').innerHTML = ... (agents list)",
  busyRow: 'el.innerHTML = busyRow(...) (the busy/auth row)',
  youPicUrl: 'the operator own picture, already versioned with YOU_PIC_V',
};

/* Known-broken, carded, deliberately NOT fixed here. An entry needs a card number:
   this is the slot the first version of this file lacked, which is how a
   known-broken renderer sat outside a "covers everything" claim in silence. */
const KNOWN_BROKEN = {
  pjRoomRow: 'kosmos#2770 -- room message-sender avatars, painted via paintThreadInto -> setLive. A message row is not a member row, so there is no avatarVer to pass through yet; that is the work of that card.',
};

/** Every avatar emission in the page, by owning function. */
function emissions() {
  const out = new Map();
  LINES.forEach((line, i) => {
    if (!ANY_AVATAR.test(line)) return;
    if (/\/api\/you\/avatar/.test(line)) return;   // the operator's own picture, a different route
    /* ⚠️ EMISSIONS ONLY, NOT CALLS. The avatar path also appears in `fetch(...)`
       for upload and delete (renderStale, paintMade), where the closing quote of
       the argument looks exactly like the closing quote of a bare <img> src. The
       first version of this sweep reported both as unclassified bare renderers,
       which is a false positive that would have trained the next reader to add
       entries to a carve-out list to quiet it. A rendered face always builds an
       <img>. */
    /* ⚠️ AND THE WINDOW IS NOT OPTIONAL. These emissions are built by concatenation
       ACROSS LINES: `<img src="/api/agent/'` on one line, `+ name + '/avatar?v='` on
       the next. A per-line `<img` filter found only 3 of the 5 renderers and the
       "at least four" guard below is what caught it. Look back a couple of lines. */
    const window = LINES.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/<img|img src=/.test(window)) return;
    const fn = ownerOf(i);
    if (!out.has(fn)) out.set(fn, []);
    out.get(fn).push({ line: i + 1, text: line.trim() });
  });
  return out;
}

test('#2762: every avatar emission is classified, so a NEW renderer cannot appear unnoticed', () => {
  const found = [...emissions().keys()].sort();
  assert.ok(found.length >= 5,
    'the sweep found almost no avatar emissions, so its pattern has probably stopped matching: ' + JSON.stringify(found));

  const unclassified = found.filter((fn) => !(fn in DIRECT_ASSIGNMENT) && !(fn in KNOWN_BROKEN));
  /* Anything not on a list must be versioned; if it is bare AND unlisted, the
     author has not said which kind it is. */
  const bareUnlisted = unclassified.filter((fn) =>
    emissions().get(fn).some((e) => BARE.test(e.text)));
  assert.deepEqual(bareUnlisted, [],
    'these renderers emit a BARE avatar URL and are on no list: '
    + JSON.stringify(bareUnlisted)
    + '. Find the paint call. If it goes through setLive / setIfChanged / paintThreadInto, append `?v=` the avatar version (#2698, #2762). '
    + 'If it assigns innerHTML directly every poll, add it to DIRECT_ASSIGNMENT with the paint call as the reason.');
});

test('#2762: the renderers behind a repaint skip all version their URL', () => {
  const em = emissions();
  const mustVersion = [...em.keys()].filter((fn) => !(fn in DIRECT_ASSIGNMENT) && !(fn in KNOWN_BROKEN));
  assert.ok(mustVersion.length >= 4,
    'expected at least the four renderers #2762 fixed; found ' + JSON.stringify(mustVersion));
  for (const fn of mustVersion) {
    for (const e of em.get(fn)) {
      assert.doesNotMatch(e.text, BARE,
        fn + ' (web/index.html:' + e.line + ') emits a BARE avatar URL. Its output is painted '
        + 'through an identical-HTML skip, so the <img> is never recreated and the face keeps the '
        + 'OLD picture after a profile-image update.');
    }
  }
});

test('#2762: the KNOWN_BROKEN list is honest, and empties itself when a card lands', () => {
  /* The half the first version of this file was missing. Two failure directions:
     a renderer listed as broken that is actually FIXED (the note is now a lie and
     the sweep has a permanent hole), and a card number that is not a card. */
  const em = emissions();
  for (const fn of Object.keys(KNOWN_BROKEN)) {
    assert.ok(em.has(fn),
      fn + ' is listed as known-broken but emits no avatar URL at all; remove the entry');
    assert.ok(em.get(fn).some((e) => BARE.test(e.text)),
      fn + ' is listed as known-broken but no longer emits a bare URL. It has been fixed: '
      + 'remove it from KNOWN_BROKEN so the sweep covers it again.');
    assert.match(KNOWN_BROKEN[fn], /kosmos#\d+/,
      fn + ' is excluded from the sweep with no card number, which is how a known defect goes quiet');
  }
});

test('#2762 CONTROL: the bare-URL pattern fails on the REAL emission shapes, both of them', () => {
  const concatBare = `'<img src="/api/agent/' + encodeURIComponent(n) + '/avatar" alt="">'`;
  const concatOk = `'<img src="/api/agent/' + encodeURIComponent(n) + '/avatar?v=' + (m.avatarVer || 0) + '" alt="">'`;
  const tplBare = '`<img src="/api/agent/${encodeURIComponent(n)}/avatar" alt="">`';
  const tplOk = '`<img src="/api/agent/${encodeURIComponent(n)}/avatar?v=${v}" alt="">`';
  assert.match(concatBare, BARE, 'the pattern misses a bare CONCATENATED url, which is what most renderers emit');
  assert.match(tplBare, BARE, 'the pattern misses a bare TEMPLATE-LITERAL url');
  assert.doesNotMatch(concatOk, BARE, 'the pattern flags a correctly versioned concatenated url');
  assert.doesNotMatch(tplOk, BARE, 'the pattern flags a correctly versioned template-literal url');
});

test('#2762 CONTROL: the DIRECT_ASSIGNMENT carve-outs are still direct assignments', () => {
  /* If one of these is ever moved behind a skip, it becomes stale and this file
     would keep excusing it. Assert the paint calls that justify the carve-out. */
  assert.match(CODE, /getElementById\('alist'\)\.innerHTML\s*=/,
    'the agents list is no longer a direct innerHTML assignment; lrow must now version its URL');
  assert.match(CODE, /\.innerHTML = busyRow\(/,
    'busyRow is no longer painted by direct assignment; it must now version its URL');
});
