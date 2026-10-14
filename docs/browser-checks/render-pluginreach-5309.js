/**
 * #5309 part 2, slice 2: the agent detail page shows an honest notice when a plugin/connection the person
 * added in their OWN provider app does not reach THIS agent (and the server has gated on evidence that one
 * was added). The server emits a.reach = { reaches, reason } per agent; paintDetailState renders the
 * #d-pluginreach notice ONLY when reaches === false, by reason, and hides it for true / null / missing.
 *
 * HERMETIC (file://), like render-reach-mark-3212.js: it loads web/index.html directly and calls the real
 * paintDetailState() with fixture cards. No server boot, so it installs no pane source and points no tmux
 * binary anywhere.
 *   HEADED=0 NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pluginreach-5309.js
 */
const nodePath = require('path');
const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright not found; run with NODE_PATH=$HOME/work/pw-runtime/node_modules'); process.exit(2); }

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('file://' + PAGE);

    const out = await page.evaluate(() => {
      if (typeof paintDetailState !== 'function') return { error: 'paintDetailState is not a function (renamed? re-anchor this check)' };
      const p = document.getElementById('d-pluginreach');
      const t = document.getElementById('d-pluginreach-text');
      if (!p || !t) return { error: 'the #d-pluginreach notice markup is missing (re-anchor this check)' };
      const mk = (reach) => ({ sessionName: 'sub-zero', name: 'Sub-Zero', state: 'working', stateEvidence: '', told: {}, instructions: {}, reach });
      // Paint each reach shape in turn and read back the notice's visibility + text.
      const snap = (reach) => { paintDetailState(mk(reach)); return { hidden: p.hidden, text: t.textContent.trim() }; };
      return {
        sep: snap({ reaches: false, reason: 'separate-account-folder', folder: '/x', missing: ['crm@acme'] }),
        codex: snap({ reaches: false, reason: 'codex-isolated-runtime' }),
        reaches: snap({ reaches: true, reason: 'reaches' }),
        noEvidence: snap({ reaches: null, reason: 'no-evidence' }),
        unknown: snap({ reaches: null, reason: 'unknown' }),
        missing: snap(undefined),
      };
    });

    if (out.error) { chk(false, out.error); }
    else {
      console.log('  measured: ' + JSON.stringify(out));
      chk(out.sep.hidden === false, 'a separate-account agent SHOWS the notice', JSON.stringify(out.sep));
      chk(/different Claude account/.test(out.sep.text) && /Sub-Zero/.test(out.sep.text) && /Restarting will not change that/.test(out.sep.text),
        'the separate-account copy names the account cause, the agent, and that a restart will not help', JSON.stringify(out.sep.text));
      chk(out.codex.hidden === false, 'a Codex agent SHOWS the notice', JSON.stringify(out.codex));
      chk(/Codex agents run in their own private space/.test(out.codex.text) && /Connections tab/.test(out.codex.text),
        'the Codex copy names the private-space cause and the Connections-tab remedy', JSON.stringify(out.codex.text));
      chk(out.sep.text !== out.codex.text, 'the two reasons render DIFFERENT copy (not one generic sentence)', '');
      chk(out.reaches.hidden === true && out.reaches.text === '', 'reaches:true hides the notice (no false warning on a healthy setup)', JSON.stringify(out.reaches));
      chk(out.noEvidence.hidden === true && out.noEvidence.text === '', 'reaches:null no-evidence hides the notice (nothing added -> nothing shown)', JSON.stringify(out.noEvidence));
      chk(out.unknown.hidden === true, 'reaches:null unknown hides the notice (fail silent)', JSON.stringify(out.unknown));
      chk(out.missing.hidden === true, 'a missing reach field hides the notice', JSON.stringify(out.missing));
    }
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
