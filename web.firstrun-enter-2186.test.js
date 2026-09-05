'use strict';

/**
 * #2186: Enter/Return on an install-wizard step activates Continue when the
 * step is valid -- the keyboard equivalent of clicking Continue.
 *
 * The behaviour lives in the named `frEnterSubmit(e)` handler on #firstrun. This
 * test LIFTS that real function out of the shipped page and RUNS it against a
 * stub event + document, so it measures the actual decision the wizard makes
 * rather than string-matching the source (the page-testing pattern this repo
 * uses everywhere -- see web.firstrun-you-behaviour.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page.js');

const fs = require('node:fs');
const nodePath = require('node:path');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/**
 * A document whose #firstrun and #fr-next states are configurable, and whose
 * #fr-next records clicks. `next.getAttribute` answers only for aria-disabled,
 * which is all the handler reads.
 */
function stubDoc({ frHidden = false, nextHidden = false, nextDisabled = false, nextAria = 'false' } = {}) {
  const next = {
    hidden: nextHidden,
    disabled: nextDisabled,
    clicks: 0,
    click() { this.clicks += 1; },
    getAttribute(name) { return name === 'aria-disabled' ? nextAria : null; },
  };
  return {
    next,
    getElementById(id) {
      if (id === 'firstrun') return { hidden: frHidden };
      if (id === 'fr-next') return next;
      return null;
    },
  };
}

/** An Enter keydown by default; overrides tune the one field a case is about. */
function ev(over = {}) {
  const e = {
    key: 'Enter',
    repeat: false,
    isComposing: false,
    keyCode: 13,
    target: { tagName: 'H2', isContentEditable: false },
    prevented: 0,
    preventDefault() { this.prevented += 1; },
  };
  return Object.assign(e, over);
}

/** Build a runnable copy of the shipped handler bound to a given document. */
function handlerWith(doc) {
  return new Function('document',
    `${page.lift(SCRIPT, 'frEnterSubmit')}\nreturn frEnterSubmit;`)(doc);
}

test('#2186: valid step -- Enter clicks Continue and prevents default', () => {
  const doc = stubDoc();
  const e = ev();
  handlerWith(doc)(e);
  assert.equal(doc.next.clicks, 1, 'Enter did not activate Continue on a valid step');
  assert.equal(e.prevented, 1, 'the default Enter action was not prevented');
});

test('#2186: Continue disabled -> Enter does nothing (the "step invalid" arm)', () => {
  const doc = stubDoc({ nextDisabled: true });
  const e = ev();
  handlerWith(doc)(e);
  assert.equal(doc.next.clicks, 0);
  assert.equal(e.prevented, 0, 'a disabled step must not swallow the keystroke');
});

test('#2186: Continue aria-disabled -> Enter does nothing (About-you gate)', () => {
  // The About-you step gates Continue by toggling BOTH disabled and
  // aria-disabled; prove the aria arm alone is honoured, not only .disabled.
  const doc = stubDoc({ nextDisabled: false, nextAria: 'true' });
  handlerWith(doc)(ev());
  assert.equal(doc.next.clicks, 0);
});

test('#2186: Continue hidden -> Enter does nothing (connect/sign-in sub-state)', () => {
  const doc = stubDoc({ nextHidden: true });
  handlerWith(doc)(ev());
  assert.equal(doc.next.clicks, 0);
});

test('#2186: wizard closed -> Enter does nothing', () => {
  const doc = stubDoc({ frHidden: true });
  handlerWith(doc)(ev());
  assert.equal(doc.next.clicks, 0);
});

test('#2186: focus in a TEXTAREA -> Enter is a newline, never a submit', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'TEXTAREA', isContentEditable: false } }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: focus in a contentEditable -> Enter does not submit', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'DIV', isContentEditable: true } }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: focus in a SEARCH input -> Enter does not submit (the #fr-foundsearch regression)', () => {
  // The "Your agents" ending shows Continue enabled AND a live search box; Enter
  // in that box must not bubble to Continue and eject the person via frFinish.
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'INPUT', type: 'search', isContentEditable: false } }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: focus in a TEXT input -> Enter DOES submit (carve-out is scoped, not blanket INPUT)', () => {
  // The contrast to the search arm: About-you's name/does text inputs must still
  // advance on Enter. Proves the search carve-out did not become a blanket
  // "skip all inputs", which would break the very step the feature is for.
  const doc = stubDoc();
  const e = ev({ target: { tagName: 'INPUT', type: 'text', isContentEditable: false } });
  handlerWith(doc)(e);
  assert.equal(doc.next.clicks, 1);
  assert.equal(e.prevented, 1);
});

test('#2186: focus on a BUTTON -> handler defers to native activation (no double)', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'BUTTON', isContentEditable: false } }));
  assert.equal(doc.next.clicks, 0, 'the handler double-clicked a focused button');
});

test('#2186: focus on a link (A) -> handler defers to native activation', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'A', isContentEditable: false } }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: focus on a SELECT (e.g. the tz picker) -> Enter is native, not Continue', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ target: { tagName: 'SELECT', isContentEditable: false } }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: held Enter (e.repeat) does not race through steps', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ repeat: true }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: mid-IME composition Enter does not submit', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ isComposing: true }));
  assert.equal(doc.next.clicks, 0);
  handlerWith(doc)(ev({ isComposing: false, keyCode: 229 }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186: a non-Enter key is ignored', () => {
  const doc = stubDoc();
  handlerWith(doc)(ev({ key: 'a' }));
  assert.equal(doc.next.clicks, 0);
});

test('#2186 CONTROL: the handler is really lifted and wired to #firstrun', () => {
  // Without this, a mis-named lift would make every case above pass vacuously.
  const src = page.lift(SCRIPT, 'frEnterSubmit');
  assert.ok(src.length > 200, `frEnterSubmit lifted as ${src.length} chars: the extractor missed it`);
  assert.match(src, /^function frEnterSubmit\(/);
  assert.match(src, /next\.click\(\)/, 'the handler no longer clicks Continue');
  // The listener is actually attached to the wizard container.
  assert.match(SCRIPT, /getElementById\('firstrun'\)\.addEventListener\('keydown', frEnterSubmit\)/,
    'frEnterSubmit is defined but not wired to #firstrun keydown');
});
