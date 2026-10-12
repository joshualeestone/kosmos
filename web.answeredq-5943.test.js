'use strict';
/* kosmos#5943, page half: a question the agent REPORTED shows how long it has been asked and an "Answered, clear this"
   button anyone can press (no Engineering mode). The age refreshes in place, so its minute ticking over must not
   change the thread's shape (#3966's flash). Runs the page's own functions, lifted from web/index.html. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);
const fns = new Function(page.liftAll(SCRIPT, ['esc', 'agoWords', 'dmQuestionFootHtml', 'threadShape'])
  + '\nreturn { dmQuestionFootHtml, threadShape };')();

const DAY = 86400000;
const asked = (msAgo) => new Date(Date.now() - msAgo).toISOString();

test('#5943 a reported question shows "Asked N days ago" and the clear button', () => {
  const html = fns.dmQuestionFootHtml({ kind: 'question', clearable: true, at: asked(12 * DAY + 60000) });
  assert.match(html, /<span class="dmq-age" data-at="[^"]+">Asked 12 days ago<\/span>/);
  assert.match(html, /<button type="button" class="dmq-clear"[^>]*>Answered, clear this<\/button>/);
  assert.match(html, /class="dmq-msg" role="status" aria-live="polite"/, 'a failed clear is said, not swallowed');
});

test('#5943 no footer for a question read off the screen, or for any other row', () => {
  assert.equal(fns.dmQuestionFootHtml({ kind: 'question', at: null }), '', 'a live screen question is answered by replying');
  assert.equal(fns.dmQuestionFootHtml({ kind: 'question', clearable: false, at: asked(DAY) }), '');
  assert.equal(fns.dmQuestionFootHtml({ from: 'casey', text: 'hi', clearable: true, at: asked(DAY) }), '', 'not a question row');
  assert.equal(fns.dmQuestionFootHtml(null), '');
  // Clearable with no readable time: the button still shows (the person can still clear it), the age does not.
  const undated = fns.dmQuestionFootHtml({ kind: 'question', clearable: true, at: null });
  assert.match(undated, /Answered, clear this/);
  assert.doesNotMatch(undated, /dmq-age/);
});

test('#5943 the age ticking over does not change the thread\'s shape (no rebuild, no flash)', () => {
  const at = asked(5 * 60000);
  const a = fns.dmQuestionFootHtml({ kind: 'question', clearable: true, at });
  const b = a.replace(/Asked [^<]+</, 'Asked 6 minutes ago<');
  assert.notEqual(a, b, 'control: the markup itself did change');
  assert.equal(fns.threadShape(a), fns.threadShape(b), 'but its shape did not, so only the words are refreshed');
});

test('#5943 the question row is not the agent speaking, takes no reactions, and is wired to the clear route', () => {
  assert.match(SCRIPT, /if \(m\.kind === 'question'\) continue;\s+\/\/ #5943/, 'DM_SPOKE_AT skips the dated question');
  assert.match(SCRIPT, /m\.at && m\.kind !== 'question' && typeof rxnsInner === 'function'/, 'no reaction bar on it');
  assert.match(SCRIPT, /dmQuestionFootHtml\(m\)/, 'the bubble draws the footer');
  const clear = page.lift(SCRIPT, 'dmQuestionClear');
  assert.match(clear, /'\/api\/agent\/' \+ encodeURIComponent\(target\) \+ '\/clear-selfreport'/);
  assert.match(clear, /paintTalk\(CURRENT\.sessionName, CURRENT\.name\)/, 'repaints so the bubble goes at once');
  assert.match(SCRIPT, /closest\('#d-dmthread \.dmq-clear'\)/, 'the click is delegated inside the DM thread only');
});
