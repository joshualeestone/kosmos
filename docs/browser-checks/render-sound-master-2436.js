'use strict';
/**
 * kosmos#2436 (Josh, 2026-09-07): the GLOBAL master on/off for the #2407 new-message
 * sound, in Settings > Automation > Sounds. On by default; when OFF no pop plays on any
 * project regardless of the per-project toggles.
 *
 * 🔑 WHAT SOURCE CANNOT SEE. A grep confirms `#snd-toggle` exists and that a handler
 * flips localStorage; only a browser confirms the switch actually PAINTS its state, that
 * the static markup renders ON by default, that a click flips the accessible state AND
 * persists the preference, and that paintSwitch reads the stored value back (the
 * paintSettings-on-open behavior). The GATE logic (master OFF silences the pop, and
 * silences-not-defers) is covered deterministically in web.bubblepop-2407.test.js; this
 * pins the DOM half.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-sound-master-2436.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-sound-master-2436: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-sound-master-2436: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    for (const fn of ['soundMasterOn', 'setSoundMasterOn', 'paintSwitch']) {
      if (typeof window[fn] !== 'function') return { error: fn + ' is not on the page' };
    }
    const tog = document.getElementById('snd-toggle');
    if (!tog) return { error: '#snd-toggle is not in the markup' };
    // localStorage must be usable for this preference to persist; if the sandbox blocks
    // it, say so rather than reporting a misleading toggle failure.
    try { window.localStorage.setItem('kosmos.__probe', '1'); window.localStorage.removeItem('kosmos.__probe'); }
    catch (e) { return { error: 'localStorage is unavailable in this context: ' + (e && e.message) }; }
    // start clean
    try { window.localStorage.removeItem('kosmos.sound.master'); } catch (e) { /* probed above */ }

    // The toggle lives in the Automation settings section, hidden on load; unhide its
    // ancestors so paint/visibility reflects the switch's own drawing.
    for (let n = tog; n; n = n.parentElement) {
      if (n.removeAttribute) n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    const vis = (el) => { if (!el) return false; for (let n = el; n; n = n.parentElement) { if (n.hidden) return false; const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const sized = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const read = () => ({ aria: tog.getAttribute('aria-checked'), on: tog.classList.contains('on') });

    // 1. Default ON as painted from storage (the paintSettings-on-open behavior).
    paintSwitch('snd-toggle', soundMasterOn());
    const initial = { ...read(), visible: vis(tog), sized: sized(tog), masterOn: soundMasterOn() };

    // Copy (Mona's exact strings) renders.
    const row = document.getElementById('snd-row');
    const label = row ? (row.querySelector('b') || {}).textContent : null;
    const hint = row ? (row.querySelector('.dhint') || {}).textContent : null;
    const ariaLabel = tog.getAttribute('aria-label') || '';

    // 2. Click OFF: accessible state flips AND the preference persists.
    tog.click();
    const afterOff = { ...read(), masterOn: soundMasterOn(), stored: (() => { try { return window.localStorage.getItem('kosmos.sound.master'); } catch { return '<blocked>'; } })() };

    // 3. Click back ON: state flips back AND the stored 'off' is cleared.
    tog.click();
    const afterOn = { ...read(), masterOn: soundMasterOn(), stored: (() => { try { return window.localStorage.getItem('kosmos.sound.master'); } catch { return '<blocked>'; } })() };

    // 4. Persistence paint: a stored 'off' paints OFF on the next open (paintSwitch reads storage).
    setSoundMasterOn(false);
    paintSwitch('snd-toggle', soundMasterOn());
    const repaint = { ...read(), masterOn: soundMasterOn() };
    try { window.localStorage.removeItem('kosmos.sound.master'); } catch { /* cleanup */ }

    return { initial, label, hint, ariaLabel, afterOff, afterOn, repaint };
  });

  if (r.error) { console.error('render-sound-master-2436: ' + r.error); await browser.close(); process.exit(1); }
  if (pageErrors.length) { console.error('render-sound-master-2436: page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  check('the master sound toggle renders ON by default, painted and visible',
    r.initial.aria === 'true' && r.initial.on === true && r.initial.visible && r.initial.sized && r.initial.masterOn === true,
    JSON.stringify(r.initial));
  check('the label and hint carry Mona’s copy',
    /^Play a sound for new messages$/.test((r.label || '').trim())
      && /A soft pop when a new message lands on one of your projects/.test(r.hint || '')
      && /On by default\. Turn it off to silence it everywhere/.test(r.hint || ''),
    JSON.stringify({ label: r.label, hint: (r.hint || '').slice(0, 60) }));
  // WCAG 2.5.3 Label in Name (Level A): the accessible name must CONTAIN the visible
  // label, or a speech-input user cannot activate the control by the words they see.
  check('the accessible name contains the visible label (WCAG 2.5.3)',
    !!(r.label && r.ariaLabel && r.ariaLabel.indexOf((r.label || '').trim()) !== -1),
    JSON.stringify({ visible: (r.label || '').trim(), aria: r.ariaLabel }));
  check('clicking OFF flips the accessible state AND persists the preference (localStorage → off)',
    r.afterOff.aria === 'false' && r.afterOff.on === false && r.afterOff.masterOn === false && r.afterOff.stored === 'off',
    JSON.stringify(r.afterOff));
  check('clicking back ON flips the state AND clears the stored off',
    r.afterOn.aria === 'true' && r.afterOn.on === true && r.afterOn.masterOn === true && r.afterOn.stored === null,
    JSON.stringify(r.afterOn));
  check('paintSwitch reads the stored value back, so a stored off paints OFF on the next open',
    r.repaint.aria === 'false' && r.repaint.on === false && r.repaint.masterOn === false,
    JSON.stringify(r.repaint));

  await browser.close();
  if (problems.length) {
    console.error('render-sound-master-2436: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-sound-master-2436: the master new-message sound toggle renders ON by default with Mona’s copy, flips its accessible state and persists the preference on click, and paints the stored value back on open.');
})();
