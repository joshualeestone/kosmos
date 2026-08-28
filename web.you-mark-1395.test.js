'use strict';

/**
 * The operator's face when there is no name yet (#1395).
 *
 * 🔑 Josh on #1183: "let's not put You... putting You in it doesn't make sense."
 * That card fixed the NAMED case and closed. The unnamed case still returned the
 * literal string, and it is the state EVERY fresh install begins in: the name is
 * collected during first run, and the engine's own note says "absent is the normal
 * start; the fields just start empty".
 *
 * 🛑 THE FUNCTION IS EXTRACTED AND RUN, NOT PATTERN-MATCHED. A regex over the page
 * cannot tell you what a branch RETURNS, and the branch is the whole subject here.
 * The four inputs below are the four ways a person can have no name.
 *
 * ⚠️ AND A NAMED CONTROL RUNS IN THE SAME BREATH. Without it every assertion here
 * passes on a function that returns an empty disc for everybody, which would be a
 * worse bug than the one being fixed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The real function, lifted verbatim, with the two globals and two helpers it
   reads. `initials` is copied from the page rather than stubbed, so a change to
   it shows up here too. */
function loadYouFace(name, pic) {
  const src = PAGE.slice(PAGE.indexOf('function youFaceHtml()'));
  const body = src.slice(0, src.indexOf('\n}') + 2);
  const initSrc = PAGE.slice(PAGE.indexOf('function initials(name)'));
  const init = initSrc.slice(0, initSrc.indexOf('\n}') + 2);
  const fn = new Function('YOU_NAME', 'YOU_PIC', `
    const esc = (s) => String(s);
    const youPicUrl = () => '/api/you/avatar';
    ${init}
    ${body}
    return youFaceHtml();
  `);
  return fn(name, pic);
}

test('#1395: with no name, the face is a disc and NOT the word "You"', () => {
  for (const [label, value] of [
    ['never set', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ]) {
    const out = loadYouFace(value, null);
    assert.doesNotMatch(out, />\s*You\s*</,
      `the ${label} case renders the word "You" as the face again: ${out}`);
    assert.notStrictEqual(out.trim(), 'You',
      `the ${label} case returns the bare string "You": ${out}`);
    assert.match(out, /class="youtint"/,
      `the ${label} case no longer draws the disc at all: ${out}`);
    /* 🛑 NO INVENTED LETTER. `initials('')` returns "?" by design, and the design
       ruled that out by name along with "Y for You". An empty disc must stay
       empty. */
    assert.match(out, /><\/span>$/,
      `the ${label} case put a glyph inside the disc: ${out}`);
  }
});

test('#1395: the disc keeps an accessible name, because the word used to be it', () => {
  /* In the org hub the container's aria-label is set ONLY when there is a picture,
     so the text "You" WAS the accessible name of that node. Dropping it silently
     would have traded a visual defect for an unnamed control. */
  const out = loadYouFace('', null);
  assert.match(out, /role="img"/, 'the empty disc is not exposed as an image');
  assert.match(out, /aria-label="You"/,
    'the empty disc lost the accessible name the word used to provide');
});

test('CONTROL: a named operator still gets their initial, so this is not blanket-empty', () => {
  const out = loadYouFace('Josh', null);
  assert.match(out, />J</, `a named operator lost their initial: ${out}`);
  assert.match(out, /class="youtint"/, 'the named case stopped drawing the disc');
});

test('CONTROL: a picture still wins over both', () => {
  const out = loadYouFace('Josh', 'yes');
  assert.match(out, /^<img /, `an uploaded picture is no longer preferred: ${out}`);
});
