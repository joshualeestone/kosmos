'use strict';
/**
 * The "Running on older instructions" banner survives leaving the agent's page
 * and coming back to it.
 *
 * 🛑 THE DEFECT, AS JOSH MET IT ON 2026-08-22: an empty amber bar where the
 * sentence and the Restart button had been. He opened an agent, went back to
 * the list, opened it again, and "the dialog box with the button then
 * disappeared so I couldn't access it". The banner's box was drawn; nothing was
 * in it.
 *
 * 🔑 IT TAKES THREE STATES TO SEE IT, which is why nothing here caught it. The
 * repaint helper skips writing when the html matches what it last WROTE, and
 * the clear path emptied the node without telling it -- so on the second stale
 * the comparison matched, nothing was written, and the node was un-hidden
 * empty. Stale then current, or current then stale, both look perfect.
 *
 * ⚠️ AND THE SECOND STALE MUST CARRY THE IDENTICAL STRING, which is the
 * ordinary case rather than a contrivance: the sentence is built from the
 * instruction file's edit time and the agent's start time, and neither changes
 * while somebody looks at another screen. A test that varied the timestamps
 * between the two would pass with the bug in place.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodePath = require('path');
const page = require('./test-support/page.js');
const fleet = require('./test-support/fleet.js');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/** The real `setLive` and the real `renderStale`, over one stub element. */
function panel() {
  /* 🛑 THE STUB HAS TO LINK THE TWO PROPERTIES, and the first version did not.
     A plain object with separate `innerHTML` and `textContent` fields let a
     `textContent = ''` clear leave `innerHTML` untouched -- so the test passed
     with the defect deliberately put back, because the fixture was supplying
     the very behaviour the fix provides. In a real element setting either one
     replaces the node's contents. */
  const el = {
    hidden: true,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); },
    set textContent(v) { this._html = String(v); },
  };
  const fn = new Function('document', 'esc', 'CURRENT', `
    ${page.lift(SCRIPT, 'setLive')}
    ${page.lift(SCRIPT, 'staleWords')}
    ${page.lift(SCRIPT, 'renderStale')}
    return renderStale;`)(
    { getElementById: (id) => (id === 'd-instr-stale' ? el : null) },
    (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    /* ⚠️ A REAL CARD FROM THE REAL ROUTE, not a one-field stand-in. `renderStale`
       reads only the session name off it, so a literal would do -- and that is
       exactly the reasoning `fixture-discipline` exists to refuse, because the
       next reader adds a second field and the literal is then a card the route
       never emits. */
    CARD,
  );
  return { el, render: fn };
}

/* One agent, so `CURRENT` is something the board would actually hold. */
const CARD = fleet.install([fleet.agent('brigitte')]).agents[0];
test.after(() => fleet.restore());

const STALE = { state: 'stale', editedAt: '2026-08-21T21:36:20Z', startedAt: '2026-08-21T21:20:38Z' };

test('the banner paints its sentence and its button the first time', () => {
  const { el, render } = panel();
  render(STALE);
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /older instructions/i);
  assert.match(el.innerHTML, /data-restart-agent/, 'the Restart button is what the person needs to reach');
});

test('when Kosmos made the edit, the banner says so in Kosmos\'s words; when nobody said, it keeps the standing ones (#323)', () => {
  /**
   * "Running on older instructions" in the person's ear means THEY edited
   * something. When the writer was Kosmos putting the agent on a project, that
   * is a change Kosmos made reported as one the person made. The engine now
   * says who in `wroteBy`, written by the code that wrote the block, and the
   * banner reads it and never infers: absent, or a person, and the wording is
   * what it was, because for a hand edit nobody knows who.
   */
  const { el, render } = panel();
  render({ ...STALE, wroteBy: { who: 'kosmos', because: 'Kosmos put it on Winter launch' } });
  assert.match(el.innerHTML, /<b>Kosmos put it on Winter launch\.<\/b>/, 'the banner does not name what Kosmos did');
  assert.match(el.innerHTML, /Restart it so it knows\./, 'the remedy lost its sentence');
  assert.doesNotMatch(el.innerHTML, /older instructions/i, 'a change Kosmos made is still reported as the person\'s');
  assert.match(el.innerHTML, /data-restart-agent/, 'the Restart button is gone from the Kosmos wording');

  for (const by of [undefined, null, { who: 'person', because: null }, { who: 'kosmos', because: null }]) {
    render({ state: 'current' });
    render({ ...STALE, wroteBy: by });
    assert.match(el.innerHTML, /<b>Running on older instructions\.<\/b>/, `wroteBy ${JSON.stringify(by)} changed the standing wording`);
    assert.doesNotMatch(el.innerHTML, /Kosmos put it on/, `wroteBy ${JSON.stringify(by)} was attributed to Kosmos`);
  }
  // A sentence from the engine is text, never markup.
  render({ state: 'current' });
  render({ ...STALE, wroteBy: { who: 'kosmos', because: 'Kosmos put it on <b>x</b>' } });
  assert.doesNotMatch(el.innerHTML, /<b>x<\/b>/, 'the why-sentence reached the page as markup');
});

test('leaving the page and coming back paints it again, not an empty bar', () => {
  const { el, render } = panel();
  render(STALE);
  const first = el.innerHTML;
  assert.ok(first.length > 40, 'CONTROL: the first paint wrote nothing, so the rest proves nothing');

  // Back to the list: the panel repaints for an agent whose instructions match.
  render({ state: 'current' });
  assert.equal(el.hidden, true);

  // Back into the same agent, unchanged, so the sentence is character for
  // character what it was.
  render(STALE);
  assert.equal(el.hidden, false, 'the banner is hidden when it should be showing');
  assert.equal(el.innerHTML, first,
    'the banner was shown with nothing in it: an amber bar with no sentence and no Restart button');
});

test('the unreadable branch was never at risk, because it writes through the helper', () => {
  /* 📌 THIS ONE CANNOT FAIL ON THE DEFECT ABOVE, and saying so is the point of
     keeping it. The unreadable branch replaces the banner by WRITING a different
     sentence through the same helper, which updates the helper's record on the
     way past -- so the next stale paint compares against that sentence, differs,
     and writes. The bug only ever lived on the path that emptied the node
     directly. This pins that this branch keeps doing it the safe way. */
  const { el, render } = panel();
  render(STALE);
  const first = el.innerHTML;
  render({ state: 'unknown', because: 'we cannot tell when this agent last started' });
  assert.match(el.innerHTML, /might not be what the agent is actually running/i);
  render(STALE);
  assert.equal(el.innerHTML, first, 'the banner came back empty after an unreadable reading');
});

test('#655: the updated-itself line lives in the header\'s notice slot in the toast\'s shape, and the row has no Not-running tile (#653)', () => {
  const fs2 = require('node:fs');
  const page = fs2.readFileSync(require('node:path').join(__dirname, 'web', 'index.html'), 'utf8');
  const slot = page.slice(page.indexOf('<div id="unote-slot">'), page.indexOf('<div id="uoffline-slot">'));
  assert.match(slot, /<div class="utoast stale" id="newsbar" role="status" hidden>/, 'the news line is not in the header slot in the toast shape');
  assert.match(slot, /id="newsbar-text"[\s\S]*id="newsbar-link"[\s\S]*id="newsbar-ok"/, 'the line lost its text, link or dismiss');
  assert.equal((page.match(/class="newsbar"/g) || []).length, 0, 'the old full-width bar is still in the page');
  assert.equal((page.match(/id="st-off-tile"/g) || []).length, 0, 'the Not-running tile is still in the stats row');
  assert.doesNotMatch(page.slice(page.lastIndexOf('<script>')), /getElementById\('st-off/, 'a painter still writes the removed tile');
});
