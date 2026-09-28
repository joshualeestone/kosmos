// Browser-check-surface: d-reports d-meta
'use strict';
/**
 * #4423 (follow-up to #4421): the agent page's Reports-to menu and title line were painted once, when the agent was
 * opened. Now the poll repaints them from the fresh card (followCard), the menu only while it still shows what it
 * was last painted with. In a REAL browser, because the fix is about how a browser reads markup back: it reads
 * `<option selected>` back as `selected=""`, so a menu compared with its own innerHTML was rebuilt on every poll.
 *   OPENED    the menu names "april" (saved as who this agent reports to), and the title line shows the role.
 *   STEADY    two more polls with nothing changed rewrite nothing in the menu (a MutationObserver counts).
 *   RENAMED   april is renamed on the board: after one poll the menu names "April Ludgate", still chosen.
 *   ROLE      the role is changed elsewhere: after one poll the title line shows the new role.
 *   PICKED    the person picks "You" and has not saved; april is renamed again; the poll leaves the pick alone.
 * Harness posture mirrors render-rename-4421.js: load over file://, answer fetches from the fixture, no timers.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-rename-followups-4423.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
const lead = (role) => ({
  sessionName: 'lead-a', name: 'Leslie Knope', state: 'idle', role, running: true, isNamedOurs: true, hasAvatar: false,
  nameDerived: true, because: null, confidence: 'structured', runner: 'claude', stateProject: null,
  profile: { reportsTo: 'april', role },
});
const april = (name) => ({
  sessionName: 'april', name, state: 'idle', role: 'Researcher', running: true, isNamedOurs: true, hasAvatar: false,
  nameDerived: true, because: null, confidence: 'structured', runner: 'claude', stateProject: null, profile: { role: 'Researcher' },
});

async function read(page) {
  return page.evaluate(() => {
    const sel = document.getElementById('d-reports');
    const opt = sel ? [...sel.options].find((o) => o.value === 'april') : null;
    return { value: sel ? sel.value : null, april: opt ? opt.textContent.trim() : null, meta: (document.getElementById('d-meta') || {}).textContent || '',
      writes: window.__menuWrites };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    await page.addInitScript(() => {
      window.__status = null;
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/thread')) return enc({ messages: [], owes: { state: 'clear' }, olderCount: 0, presence: 'on', asking: false });
        if (u.includes('/api/status')) return enc(window.__status);
        if (u.includes('/api/projects')) return enc({ projects: [] });
        return enc({});
      };
    });
    await page.goto(PAGE);
    const poll = (agents) => page.evaluate(async (a) => { window.__status = { agents: a, version: '0.0.0' }; await tick(); }, agents);
    await page.evaluate(async (a) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      window.__status = { agents: a, version: '0.0.0' };
      await tick();
      openDetail('lead-a');
      document.getElementById('panel-detail').hidden = false;
      window.__menuWrites = 0;
      new MutationObserver((ms) => { window.__menuWrites += ms.length; }).observe(document.getElementById('d-reports'), { childList: true, subtree: true, characterData: true });
    }, [lead('Project Manager'), april('april')]);
    await page.waitForTimeout(300);
    const opened = await read(page);
    chk(opened.value === 'april' && opened.april === 'april', 'OPENED: the menu names april, chosen', JSON.stringify(opened));
    chk(/Project Manager/i.test(opened.meta), 'OPENED: the title line shows the role', JSON.stringify(opened));

    await poll([lead('Project Manager'), april('april')]);
    await poll([lead('Project Manager'), april('april')]);
    await page.waitForTimeout(100);
    const steady = await read(page);
    chk(steady.writes === 0, 'STEADY: two polls with nothing changed rewrote nothing in the menu', JSON.stringify(steady));

    await poll([lead('Project Manager'), april('April Ludgate')]);
    await page.waitForTimeout(100);
    const renamed = await read(page);
    chk(renamed.april === 'April Ludgate' && renamed.value === 'april', 'RENAMED: the menu names the new name, still chosen', JSON.stringify(renamed));

    await poll([lead('Chief of Staff'), april('April Ludgate')]);
    await page.waitForTimeout(100);
    const role = await read(page);
    chk(/Chief of Staff/i.test(role.meta), 'ROLE: the title line shows a role changed elsewhere', JSON.stringify(role));

    await page.evaluate(() => { document.getElementById('d-reports').value = ''; });
    await poll([lead('Chief of Staff'), april('April L.')]);
    await page.waitForTimeout(100);
    const picked = await read(page);
    chk(picked.value === '', 'PICKED: an unsaved pick of "You" is left alone by the poll', JSON.stringify(picked));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-rename-followups-4423: ' + (fail.length ? fail.length + ' failed' : 'all good'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-rename-followups-4423 threw: ' + (e && e.message || e)); process.exit(1); });
