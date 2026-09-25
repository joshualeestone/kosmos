'use strict';

/**
 * kosmos#3436: on Windows the ChatGPT subscription sign-in runs by DEVICE CODE, because
 * codex's own browser window opened behind Kosmos. The engine chooses the mode
 * (engine/openaiaccounts.devicecode-3436.test.js pins that); this file pins the page:
 *
 *   - openaiSubDeviceMarkup, run for real: the code with a Copy button, codex's own
 *     words when no code could be read, nothing otherwise; values escaped.
 *   - openaiSubPaintDevice, run against a stub DOM: sets the open link from the polled
 *     URL, reveals the code, and does NOT rebuild the same code every poll (a rebuild
 *     would undo "Copied" under the person's click).
 *   - the wiring: both sign-in polls (Settings and first run) paint only when the
 *     engine said the sign-in is device mode, and both start handlers record the mode.
 *     A Mac is answered 'browser', so its sign-in never reaches the new painter.
 *   - the Windows explainer on both steps is a data-win-copy span naming a real key.
 *
 *   node --test web.openai-devicecode-3436.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = require('./test-support/page.js');

const HTML = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(HTML);
const lift = (name) => page.lift(SCRIPT, name);

function build(doc) {
  // eslint-disable-next-line no-new-func
  return new Function('document',
    page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS) + '\n'
    + lift('esc') + '\n' + lift('openaiSubDeviceMarkup') + '\n' + lift('openaiSubPaintDevice')
    + '\nreturn { openaiSubDeviceMarkup, openaiSubPaintDevice, windowsCopyTable };')(doc);
}

test('a read code is shown in a copy row with a Copy button', () => {
  const { openaiSubDeviceMarkup } = build(undefined);
  const v = openaiSubDeviceMarkup({ state: 'awaiting-code', authUrl: 'https://auth.openai.com/codex/device', userCode: 'Q7RT-4KXWZ' });
  assert.equal(v.key, 'code:Q7RT-4KXWZ');
  assert.match(v.html, /^On that page, enter this code:/);
  assert.match(v.html, /<span class="fr-cmd-row oa-devrow"><code class="fr-cmd oa-devcode">Q7RT-4KXWZ<\/code><button class="btn-quiet fr-copy" type="button" data-copy-command>Copy<\/button><\/span>/,
    'the code is not in the row the shared Copy handler reads (.fr-cmd-row / .fr-cmd / data-copy-command)');
});

test('with no code, codex\'s own words are shown, escaped, and nothing is invented', () => {
  const { openaiSubDeviceMarkup } = build(undefined);
  const v = openaiSubDeviceMarkup({ state: 'awaiting-code', instructions: 'Visit <b>here</b> & type the word' });
  assert.match(v.html, /We could not pick out the code/);
  assert.ok(v.html.includes('Visit &lt;b&gt;here&lt;/b&gt; &amp; type the word'), 'codex output reached the page unescaped');
  assert.ok(!/data-copy-command/.test(v.html), 'a Copy button offered to copy a whole paragraph');
  assert.deepEqual(openaiSubDeviceMarkup({ state: 'awaiting-code' }), { key: '', html: '' });
  assert.deepEqual(openaiSubDeviceMarkup(null), { key: '', html: '' });
});

test('the painter sets the link, reveals the code, and does not rebuild an unchanged code', () => {
  const els = {
    open: { href: '#' }, openRow: { hidden: true },
    code: { hidden: true, textContent: '', writes: 0,
      set innerHTML(v) { this._h = v; this.writes += 1; this.textContent = v.replace(/<[^>]*>/g, ''); }, get innerHTML() { return this._h; } },
  };
  const doc = { getElementById: (id) => els[id] || null };
  const { openaiSubPaintDevice } = build(doc);
  const ids = { open: 'open', openRow: 'openRow', code: 'code' };
  openaiSubPaintDevice(ids, { state: 'awaiting-code' });
  assert.equal(els.openRow.hidden, true, 'the open button showed before there was a link');
  assert.equal(els.code.hidden, true);
  const out = { state: 'awaiting-code', authUrl: 'https://auth.openai.com/codex/device', userCode: 'Q7RT-4KXWZ' };
  openaiSubPaintDevice(ids, out);
  assert.equal(els.open.href, 'https://auth.openai.com/codex/device');
  assert.equal(els.openRow.hidden, false);
  assert.equal(els.code.hidden, false);
  assert.match(els.code.textContent, /Q7RT-4KXWZ/);
  const writes = els.code.writes;
  openaiSubPaintDevice(ids, out);
  openaiSubPaintDevice(ids, out);
  assert.equal(els.code.writes, writes, 'the same code was rebuilt on every poll');
  // A reset (textContent emptied between sign-ins) is repainted, even with the same key.
  els.code.textContent = ''; els.code.hidden = true;
  openaiSubPaintDevice(ids, out);
  assert.equal(els.code.hidden, false, 'a second sign-in with the same code stayed blank after a reset');
});

test('both polls paint only in device mode, and both starts record the mode', () => {
  const settingsWatch = lift('acctOpenaiSubWatch');
  const firstRunWatch = lift('frOpenaiSubWatch');
  assert.match(settingsWatch, /if \(ACCT_OPENAI_SUB_MODE === 'device'\) openaiSubPaintDevice\(\{ open: 'acct-openai-sub-open', openRow: 'acct-openai-sub-open-row', code: 'acct-openai-sub-code' \}, out\);/);
  assert.match(firstRunWatch, /if \(ACCT_OPENAI_SUB_MODE === 'device'\) openaiSubPaintDevice\(\{ open: 'fr-openai-sub-open', openRow: 'fr-openai-sub-open-row', code: 'fr-openai-sub-code' \}, out\);/);
  assert.equal((SCRIPT.match(/openaiSubPaintDevice\(/g) || []).length, 3, 'a new caller of the device painter appeared; check it is gated on device mode');
  assert.match(lift('frOpenaiSubStart'), /ACCT_OPENAI_SUB_SESSION = out\.sessionId;\n\s*ACCT_OPENAI_SUB_MODE = out\.mode;/);
  assert.match(SCRIPT, /ACCT_OPENAI_SUB_SESSION = out\.sessionId;\n\s*ACCT_OPENAI_SUB_MODE = out\.mode;\n\s*acctOpenaiSubShowStart\(out\);/);
  // Every id the painter is handed exists in the markup.
  for (const id of ['acct-openai-sub-open', 'acct-openai-sub-open-row', 'acct-openai-sub-code', 'fr-openai-sub-open', 'fr-openai-sub-open-row', 'fr-openai-sub-code']) {
    assert.ok(HTML.includes('id="' + id + '"'), id + ' is not in the page');
  }
});

test('the Windows explainer is on both sign-in steps, and the new copy has no em dash', () => {
  const { windowsCopyTable } = build(undefined);
  const t = windowsCopyTable();
  assert.equal((HTML.match(/<span data-win-copy="openaiSubHow">/g) || []).length, 2);
  for (const k of ['openaiSubHow', 'openaiSubCodeLead', 'openaiSubRawLead']) {
    assert.equal(typeof t[k], 'string', k + ' is missing from the Windows copy table');
    assert.ok(!/—|&mdash;/.test(t[k]), k + ' carries an em dash');
  }
  assert.match(t.openaiSubHow, /link and a short code/);
  // The Mac sentence is still the markup's own text.
  assert.equal((HTML.match(/<span data-win-copy="openaiSubHow">Kosmos opens OpenAI's sign-in in your browser and never sees your password\./g) || []).length, 2);
});
