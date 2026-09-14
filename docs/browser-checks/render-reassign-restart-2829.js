'use strict';
// Browser-check-surface: popRestartAfterSave openRestartModal rst-modal d-role-msg
// (#2829) the distinctive web/index.html tokens this check asserts: the after-save restart
// pop helper, the modal opener it shares with the explicit restart path, the modal, and the
// role dialog's message line where the fallback button + auto-hello receipt live. A change to
// any of them must update this check at PR time.
/* #2829 (Josh, 0.6.57 review): after a rename or a report-to/assignment save that needs a
 * restart to take effect, pop the restart modal (a saved variant of openRestartModal) so the
 * person can restart right there, instead of the old passive "takes effect when it next
 * starts" notice. On restart the shared rst-go flow plays the branded K loader and auto-sends
 * a hello (covered by render-restart-kloader-2831 / render-autohello-2686); this check owns
 * the new entry: popRestartAfterSave opens the modal with the saved title + lead, leaves a
 * "Restart now" fallback in d-role-msg wired for rst-go, and does not duplicate that button;
 * and the ordinary explicit-restart title is unchanged. Drives the real functions against the
 * shipped page.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-reassign-restart-2829.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const x = m.text();
    if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
    problems.push('console: ' + x);
  });
  await page.goto(PAGE);

  const out = await page.evaluate(() => {
    const res = {};
    // A running agent named Scarlet, so the modal can resolve a display name.
    CURRENT = { sessionName: 'agent-x', name: 'Scarlet', running: true, commitments: null };
    LAST = [CURRENT];
    const modal = document.getElementById('rst-modal');
    const msg = document.getElementById('d-role-msg');
    const title = () => document.getElementById('rst-title').textContent;
    const small = () => document.getElementById('rst-small').textContent;

    // --- SAVED VARIANT: popRestartAfterSave opens the modal ---
    msg.textContent = 'Saved.';                 // what the save handler leaves before popping
    popRestartAfterSave('agent-x', 'This is saved. They keep the old name until you restart them.');
    res.modalOpen = modal.hidden === false;
    res.savedTitle = title();
    res.savedSmall = small();
    const btns = msg.querySelectorAll('[data-restart-agent]');
    res.fallbackCount = btns.length;
    const b = btns[0];
    res.fallbackAgent = b ? b.dataset.restartAgent : null;   // what rst-go reads for the name
    res.fallbackNote = b ? b.dataset.restartNote : null;     // where the auto-hello receipt lands
    res.msgHasSaved = /^Saved\./.test(msg.textContent);      // fallback text preserved

    // --- IDEMPOTENT: popping again reuses the button, never duplicates it ---
    popRestartAfterSave('agent-x', 'second lead');
    res.fallbackCountAfterSecond = msg.querySelectorAll('[data-restart-agent]').length;

    // --- REGRESSION: the ordinary explicit-restart title is unchanged ---
    document.getElementById('rst-keep').click();   // close first
    openRestartModal(b, 'agent-x');                // no opts -> plain variant
    res.plainTitle = title();
    document.getElementById('rst-keep').click();
    return res;
  });

  ok('saved: the restart modal is open', out.modalOpen === true, 'hidden!==false');
  ok('saved: title names the save and the restart', /^Saved\. Restart .* to use it now\?$/.test(out.savedTitle || ''), 'got ' + JSON.stringify(out.savedTitle));
  ok('saved: small line leads with the saved-context sentence', /^This is saved\./.test(out.savedSmall || ''), 'got ' + JSON.stringify(out.savedSmall));
  ok('saved: exactly one fallback Restart button in the role message', out.fallbackCount === 1, 'count=' + out.fallbackCount);
  ok('saved: the fallback button names the agent for rst-go', out.fallbackAgent === 'agent-x', 'got ' + out.fallbackAgent);
  ok('saved: the fallback button points the auto-hello receipt at d-role-msg', out.fallbackNote === 'd-role-msg', 'got ' + out.fallbackNote);
  ok('saved: the role message keeps its Saved text as the fallback', out.msgHasSaved === true, 'got ' + out.msgHasSaved);
  ok('saved: popping again reuses the button, no duplicate', out.fallbackCountAfterSecond === 1, 'count=' + out.fallbackCountAfterSecond);
  ok('regression: the explicit-restart title is still "Restart X?"', /^Restart .*\?$/.test(out.plainTitle || '') && !/^Saved\./.test(out.plainTitle || ''), 'got ' + JSON.stringify(out.plainTitle));

  await browser.close();
  if (problems.length) {
    console.error('render-reassign-restart-2829: ' + problems.length + ' problem(s) (' + pass + ' ok)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-reassign-restart-2829: a rename/report-to save that needs a restart pops the restart modal (saved title + lead), leaves a single rst-go-wired "Restart now" fallback in d-role-msg, and does not change the explicit-restart title.');
})().catch((err) => {
  console.error('FAIL  render-reassign-restart-2829: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
