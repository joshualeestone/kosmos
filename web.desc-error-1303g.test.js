'use strict';
/**
 * kosmos#1303 group G. Josh, reviewing 0.5.97:
 *
 *   "we should indicate next to the description that there is a 200-character
 *    limit... The error was below the Save Changes button so when I scrolled
 *    down to hit the button, I couldn't see the error... maybe we highlight the
 *    fields that are incorrect and insert messages inline"
 *
 * 🛑 THE DEFECT IS STRUCTURAL, NOT A WORDING PROBLEM: the message explaining why
 * nothing happened was placed AFTER the control you press to make it happen. On
 * a form long enough to scroll, that is invisible at exactly the moment it is
 * needed, and no rewording fixes it.
 *
 *   node --test web.desc-error-1303g.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const ENGINE = fs.readFileSync(path.join(__dirname, 'engine', 'projects.js'), 'utf8');

/**
 * A function lifted out of the page and actually RUN, never matched.
 *
 * ⚠️ INDEX-BASED, NOT A CONSTRUCTED RegExp. The first version built the pattern
 * from a string and the backslashes went through a shell heredoc, a Python
 * literal and a JS string before reaching the regex engine. Two tests failed on
 * the escaping rather than on the page. There is nothing to escape here.
 */
function lift(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from the page');
  const end = PAGE.indexOf('\n}', at);
  assert.ok(end > at, name + ' has no closing brace at column 0');
  return PAGE.slice(at, end + 2);
}

test('the cap is ONE number: engine, page constant, and the sentence a person reads', () => {
  /* 🔑 THREE COPIES, PINNED TOGETHER. The engine is the authority; the page
     needs its own to explain before a round trip, and the hint needs it in
     words. Three places that must agree is exactly where a silent drift lives,
     so this is the coupling rather than three separate assertions. */
  const engineCap = ENGINE.match(/Array\.from\(flat\)\.length > (\d+)/);
  assert.ok(engineCap, 'the engine no longer caps the description with Array.from');
  const pageCap = PAGE.match(/const PJ_DESC_MAX = (\d+);/);
  assert.ok(pageCap, 'PJ_DESC_MAX is gone from the page');
  assert.equal(pageCap[1], engineCap[1], 'the page and the engine disagree about the cap');

  const hints = PAGE.match(/<p class="fhint" id="pj[s]?-?a?d?d?-?desc-hint">Up to (\d+) characters\.<\/p>/g) || [];
  assert.equal(hints.length, 2, 'both description fields should say the limit');
  for (const h of hints) {
    assert.equal(h.match(/Up to (\d+)/)[1], engineCap[1], 'a hint names a different number from the engine');
  }
});

test('the cap is counted in CODE POINTS, the way the engine counts', () => {
  // `desc.length` counts UTF-16 units and would refuse a 101-emoji description
  // the engine accepts. The engine's own comment forbids exactly this mistake.
  const fn = lift('pjDescTooLong');
  assert.match(fn, /Array\.from\(/, 'the page counts UTF-16 units, so it disagrees with the engine on emoji');
  const tooLong = new Function('PJ_DESC_MAX', fn + '; return pjDescTooLong;')(200);
  assert.equal(tooLong('a'.repeat(200)), false, '200 plain characters is allowed');
  assert.equal(tooLong('a'.repeat(201)), true, '201 is refused');
  // 150 astral emoji are 150 code points and 300 UTF-16 units. A length-based
  // check would call this too long; the engine would not.
  assert.equal(tooLong('\u{1F600}'.repeat(150)), false,
    'a 150-emoji description is refused by the page but accepted by the engine');
});

test('every description field has a refusal slot BEFORE the button, not after', () => {
  /* The whole card. `.fmsg` after the button is fine for success, because that
     is where you are looking once you press it. A refusal has to be where the
     fix happens. */
  for (const [field, err, button] of [
    ['pjs-desc', 'pjs-desc-err', 'pjs-save'],
    ['pj-add-desc', 'pj-add-desc-err', 'pj-create'],
  ]) {
    const fieldAt = PAGE.indexOf('id="' + field + '"');
    const errAt = PAGE.indexOf('id="' + err + '"');
    const btnAt = PAGE.indexOf('id="' + button + '"');
    assert.ok(fieldAt > -1 && errAt > -1 && btnAt > -1, field + ': something is missing');
    assert.ok(errAt > fieldAt, err + ' is not beside its field');
    assert.ok(errAt < btnAt, err + ' sits after the button, which is the defect this card is about');
  }
});

test('a refused field is marked, described and FOCUSED', () => {
  // ⚠️ THE FOCUS IS THE HALF THAT ANSWERS HIM. He scrolled DOWN to the button,
  // so a message anywhere above it was off screen. Focusing brings the field,
  // its hint and its reason into view together; rewording never would.
  const fn = lift('pjFieldBad');
  assert.match(fn, /classList\.add\('bad'\)/, 'the field is not visually marked');
  assert.match(fn, /aria-invalid/, 'the field is not marked for a screen reader');
  assert.match(fn, /\.focus\(\)/, 'the field is not focused, so it can still be off screen');
  assert.match(fn, /scrollIntoView/, 'nothing brings the field into view');
});

test('the create box no longer accepts text the engine will refuse', () => {
  /* 🛑 IT CARRIED maxlength="500" WHILE THE ENGINE REFUSED AT 200. A form that
     accepts 300 characters and then fails to save is disagreeing with its own
     product. Removed rather than set to 200: maxlength counts UTF-16 units. */
  const box = PAGE.match(/<textarea[^>]*id="pj-add-desc"[^>]*>/);
  assert.ok(box, 'the create description box is gone');
  assert.doesNotMatch(box[0], /maxlength/,
    'a maxlength is back on the create description, and any number there cuts emoji at half length');
  const settings = PAGE.match(/<textarea[^>]*id="pjs-desc"[^>]*>/);
  assert.doesNotMatch(settings[0], /maxlength/, 'a maxlength appeared on the settings description');
});

test('both handlers check before sending, and route the engine refusal to the field', () => {
  const save = PAGE.slice(PAGE.indexOf("getElementById('pjs-save').addEventListener"));
  assert.match(save.slice(0, 2000), /pjDescTooLong\(/, 'the settings save no longer pre-checks');
  assert.match(save.slice(0, 4000), /\/description\/i\.test\(got\.error\)/,
    'a description refusal from the engine still lands under the button');
  const create = PAGE.slice(PAGE.indexOf("getElementById('pj-create').addEventListener"));
  assert.match(create.slice(0, 2000), /pjDescTooLong\(/, 'the create no longer pre-checks');
  assert.match(create.slice(0, 4000), /\/description\/i\.test\(err\.message\)/,
    'a description refusal on create still lands under the button');
});

/**
 * ⭐ BARON DRAXUM'S TEST, applied to my own first version of this fix, which
 * failed it: AT THE MOMENT THE PERSON ACTS, CAN THEY SEE THE THING THAT TELLS
 * THEM WHAT HAPPENED?
 *
 * Focusing the field moves the person to the reason, which answers it when the
 * scroll lands. When it does not -- a short form, a browser that ignores the
 * scroll, a field already above the fold -- the button they just pressed said
 * NOTHING. That is this card's own silence, one layer along.
 */
test('the button they pressed never goes silent, on any of the four refusal paths', () => {
  const paths = [
    ["getElementById('pjs-save').addEventListener", 'Nothing saved.'],
    ["getElementById('pj-create').addEventListener", 'Nothing added.'],
  ];
  for (const [anchor, expected] of paths) {
    const at = PAGE.indexOf(anchor);
    assert.notEqual(at, -1, anchor + ' is gone');
    const body = PAGE.slice(at, at + 5000);
    const pointers = (body.match(/There is something to fix above\./g) || []).length;
    assert.equal(pointers, 2,
      anchor + ': both the pre-check and the engine-refusal path must say something at the button');
    assert.ok(body.includes(expected), anchor + ' lost its "' + expected + '" wording');
  }
});

test('the pointer never carries the reason, so the two cannot disagree', () => {
  /* The specific reason lives at the field. If the button line also spelled it
     out, they would be two copies of one fact and would drift. */
  const pointers = PAGE.match(/'Nothing (saved|added)\. There is something to fix above\.'/g) || [];
  assert.equal(pointers.length, 4, 'the four pointer sites changed shape');
  for (const p of pointers) {
    assert.doesNotMatch(p, /\d/, 'the pointer names a number, which is a second copy of the cap');
    assert.doesNotMatch(p, /description/i, 'the pointer names the field, which is a second copy of the reason');
  }
});
