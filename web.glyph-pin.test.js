'use strict';

/**
 * The selector glyphs the PAGE reads must be the ones the ENGINE reads.
 *
 * 🛑 THE COMMENT BESIDE THE PAGE'S COPY SAYS THIS IS ALREADY PINNED. IT IS NOT.
 * `web/index.html` says the literal is "pinned by the cross-check in
 * server.test.js, which asks the page and the engine the same text". Measured
 * 2026-08-27: `server.test.js` contains neither `SELECTOR_GLYPHS` nor `❯›`, and
 * `engine/chat.test.js` only asserts the constant's SHAPE — a non-empty string
 * with no regex metacharacters. Nothing compared the two.
 *
 * ⭐ SO THE ONE COPY WITH NO GUARD WAS THE ONE WHOSE COMMENT PROMISED A GUARD,
 * which is worse than no comment: nobody re-checks what is already claimed to be
 * covered. Found by RUNNING the named test instead of citing it, while closing
 * #998 on evidence I had read rather than executed.
 *
 * 🔑 WHY IT MATTERS, IN THAT COMMENT'S OWN WORDS: a page reading one glyph while
 * the engine reads two "draws buttons on a Codex menu whose every press the 409
 * screen-check then refuses, and the refusal blames the agent's screen for a
 * disagreement between two copies of our own rule". Add a third provider glyph
 * to the engine and today the page silently does not follow.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const status = require('./engine/status');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('CONTROL: both sides are readable, and the page really carries a glyph class', () => {
  /* An absence assertion over a page we failed to read passes for the wrong
     reason. Presence first, both ends. */
  assert.equal(typeof status.SELECTOR_GLYPHS, 'string');
  assert.ok(status.SELECTOR_GLYPHS.length > 0, 'the engine constant is empty');
  assert.match(PAGE, /\[[^\]]*\]\\s\*\)\?\[1-9\]|\[[^\]]{1,8}\]\s*\\s\*\)\?/,
    'the page no longer carries a bracketed glyph class in its option pattern');
});

test('every glyph the engine accepts, the page accepts too', () => {
  /**
   * 🔑 THE CLAIM IS SET EQUALITY, NOT "the page mentions them". A page that
   * happened to contain ❯ in unrelated copy would satisfy a mention test while
   * its option pattern read only one.
   */
  const cls = PAGE.match(/\/\^\(\?:\[([^\]]+)\]\\s\*\)\?\[1-9\]/);
  assert.ok(cls, 'the option pattern moved; re-derive this test rather than deleting it');
  const pageGlyphs = new Set([...cls[1]]);
  const engineGlyphs = new Set([...status.SELECTOR_GLYPHS]);

  for (const g of engineGlyphs) {
    assert.ok(pageGlyphs.has(g),
      `the engine accepts ${JSON.stringify(g)} and the page does not: `
      + `page=${JSON.stringify([...pageGlyphs].join(''))} engine=${JSON.stringify(status.SELECTOR_GLYPHS)}`);
  }
  /* The other direction too: a page accepting a glyph the engine refuses draws
     buttons the 409 screen-check then rejects, which is the same defect wearing
     the other costume. */
  for (const g of pageGlyphs) {
    assert.ok(engineGlyphs.has(g),
      `the page accepts ${JSON.stringify(g)} and the engine does not`);
  }
});
