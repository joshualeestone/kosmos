'use strict';

/**
 * The About-you step, DRIVEN rather than pinned (#1345).
 *
 * 🛑 WHY THIS EXISTS BESIDE THE STATIC PINS. `server.test.js` says of this exact
 * screen: *"Only the Playwright drive exercises this live, and the drive is not
 * in `node --test`"*. That is true and it is the reason I could report #1345 as
 * content-correct and NOT behaviour-measured - the served bytes parsed, the
 * markup was right, and nobody had run the function.
 *
 * ⭐ `page.lift` closes that without a browser: it extracts the real painter from
 * the real page source and runs it against a stub document. **A test that
 * executes the shipped function can tell "renders two fields" from "the string
 * happens to contain two labels", and a grep cannot.**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page.js');

const fs = require('node:fs');
const nodePath = require('node:path');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/** The smallest document `frPaintYou` actually touches. */
function stubDoc(captured) {
  const el = (id) => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    // #1994: the restored time-zone <select> is populated by frPaintYou, so the
    // stubbed select carries a real-enough options collection + appendChild /
    // insertBefore for the populate to run to completion under the lift.
    options: [],
    appendChild(o) { this.options.push(o); },
    insertBefore(o) { this.options.unshift(o); },
    setAttribute() {},
    addEventListener() {},
    focus() {},
    querySelector: () => null,
  });
  const nodes = new Map();
  return {
    getElementById(id) {
      if (!nodes.has(id)) {
        const node = el(id);
        if (id === 'fr-you') {
          Object.defineProperty(node, 'innerHTML', {
            get() { return captured.html || ''; },
            set(v) { captured.html = v; },
          });
        }
        nodes.set(id, node);
      }
      return nodes.get(id);
    },
    // #1994: frPaintYou builds <option>s for the time-zone select.
    createElement: () => ({ value: '', textContent: '' }),
    activeElement: null,
    querySelector: () => null,
    addEventListener() {},
  };
}

test('#1345 + #1994: the painter emits three labelled fields (name, does, time zone)', () => {
  /* 🔑 THE PAINTER IS RUN, not read, and `frActions` is CAPTURED rather than
     stubbed away. It receives the Continue handler and the gate, which is the
     behaviour `server.test.js` says only the Playwright drive exercises:

       "Only the Playwright drive exercises this live, and the drive is not in
        `node --test`"

     ⭐ That was true and it is the reason #1375 shipped content-verified and not
     behaviour-measured. Lifting the real function and giving it the bindings it
     closes over removes the need for a browser here entirely. */
  const captured = {};
  const doc = stubDoc(captured);
  const actions = [];

  const painter = new Function('document', 'FR_YOU_GEN', 'frActions', 'fetch', 'youTzMachine', 'YOU_TZ_FALLBACK',
    `${page.lift(SCRIPT, 'frPaintYou')}\nreturn frPaintYou;`)(
    doc, 0, (spec) => { actions.push(spec); },
    () => new Promise(() => {}),
    () => 'UTC', ['UTC'],   // #1994: the tz helpers frPaintYou now closes over
  );
  painter();

  const html = captured.html || '';
  assert.ok(html.length > 0, 'the painter wrote nothing into the box: this test proves nothing');

  // #1994 (Josh, live 2026-09-04): the time zone picker was restored to this
  // step, so it now paints THREE labelled fields (name, does, time zone), up
  // from the two #1345 left after removing the "know" box.
  const labels = (html.match(/class="fieldlab"/g) || []).length;
  assert.equal(labels, 3, `the About-you step painted ${labels} labelled fields, not three`);
  assert.match(html, /id="fr-you-name"/);
  assert.match(html, /id="fr-you-do"/);
  assert.match(html, /id="fr-you-tz"/);

  /* 🛑 THE ABSENCES, ASSERTED BESIDE PROOF THE STRING IS READABLE. An absence on
     its own can come from an empty read; next to the two positives above it
     cannot be faked by a stale or empty file. */
  assert.doesNotMatch(html, /id="fr-you-know"/, 'the removed box is painted again');
  assert.doesNotMatch(html, /Anything they should always know/, 'its label is painted again');
  assert.doesNotMatch(html, /You can change these later/, 'the helper text is painted again');

  /* The step still has a Continue, and it is the painter that supplies it. */
  assert.equal(actions.length, 1, 'the step painted no Continue action');
  assert.equal(actions[0].label, 'Continue');
});

test('#1345 CONTROL: the lift and the bindings are real, not a silent empty read', () => {
  /* Without this, every assertion above is satisfied by a painter that could not
     be lifted and an html string that stayed empty. */
  const src = page.lift(SCRIPT, 'frPaintYou');
  assert.ok(src.length > 400, `frPaintYou lifted as ${src.length} characters: the extractor missed it`);
  assert.match(src, /^async function frPaintYou\(/, 'the async keyword was sliced off the declaration');
  assert.match(src, /frActions\(/, 'the painter no longer calls frActions: this harness needs re-aiming');
});
