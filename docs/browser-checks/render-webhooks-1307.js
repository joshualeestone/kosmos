// Browser-check-surface: pjs-hooks pjs-hook-add pjs-hooks-msg tsk-from tkcard-from
'use strict';
/**
 * A project's webhooks in its settings (#1307, Josh 2026-08-28), on a real board in a real browser.
 *
 * What this pins, and why each line can fail:
 *  - the Webhooks section sits directly below Project members, with + New webhook,
 *  - New webhook makes one named "Webhook 1", shows its full link ONCE with a Copy button and the
 *    JSON hint, and focuses the link,
 *  - that link works: POSTing JSON to it adds a task to the project, marked with the webhook,
 *  - Done hides the link and nothing shows it again (a repaint or reopening settings),
 *  - renaming keeps the same link working; the row shows when it was last used,
 *  - Delete asks first (Keep it cancels), then the link stops working,
 *  - a webhook task says "From <name> (a webhook)" in the Tasks view, and a name carrying HTML is
 *    shown as text, never as markup,
 *  - light, dark and 390 wide, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-webhooks-1307.js            # headed
 *   HEADED=0 node docs/browser-checks/render-webhooks-1307.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const proj = projects.create({ name: 'Billing' });
  projects.addAgent(proj.id, 'ada', null);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openSettings = async (page) => {
    await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
    await page.click('#pj-settings-link');
    await page.waitForSelector('#pj-settings-view:not([hidden])', { timeout: 8000 });
  };
  try {
    for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await openSettings(page);
      const order = await page.evaluate(() => {
        const members = document.getElementById('pjs-agents-label').closest('.field');
        const hooks = document.getElementById('pjs-hooks-field');
        return { both: !!(members && hooks), next: members && members.nextElementSibling === hooks, add: !!document.getElementById('pjs-hook-add') };
      });
      chk(order.both && order.next && order.add, `${tag} Webhooks sits directly below Project members, with + New webhook`, JSON.stringify(order));

      if (theme === 'light' && width === 1280) {
        await page.click('#pjs-hook-add');
        await page.waitForSelector('#pjs-hook-url', { timeout: 8000 });
        const made = await page.evaluate(() => ({
          name: (document.querySelector('[data-hook-name]') || {}).value,
          url: document.getElementById('pjs-hook-url').value,
          focused: document.activeElement && document.activeElement.id,
          copy: !!document.querySelector('[data-hook-copy]'),
          once: /shows it only once/.test(document.querySelector('.pjs-hook-reveal').textContent),
          json: /"title"/.test(document.querySelector('.pjs-hook-reveal').textContent),
        }));
        chk(made.name === 'Webhook 1', '[make] the new webhook is named Webhook 1, editable', made.name);
        chk(/^http:\/\/127\.0\.0\.1:\d+\/hooks\/[0-9a-f]{16}\/[A-Za-z0-9_-]{43}$/.test(made.url), '[make] its full link is shown', made.url);
        chk(made.copy && made.once && made.json, '[make] with a Copy button, "shows it only once", and the JSON hint', JSON.stringify(made));
        chk(made.focused === 'pjs-hook-url', '[make] focus lands on the link, ready to copy', String(made.focused));
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'webhooks-made-light.png'), fullPage: false }); }

        // The link works: a program POSTing JSON to it adds a task.
        const called = await page.evaluate(async (u) => {
          const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Invoice 42 is overdue' }) });
          return { status: r.status, body: await r.json().catch(() => null) };
        }, made.url);
        const t = projects.get(proj.id).tasks.find((x) => x.sentence === 'Invoice 42 is overdue');
        chk(called.status === 201 && !!t && t.addedVia === 'webhook' && t.addedBy === 'Webhook 1', '[call] the link adds a task marked with the webhook', JSON.stringify({ called, t: t && { addedBy: t.addedBy, addedVia: t.addedVia } }));

        // Done hides the link, and reopening settings does not bring it back.
        await page.click('[data-hook-done]');
        const hidden = await page.evaluate(() => !document.getElementById('pjs-hook-url'));
        await openSettings(page);
        await page.waitForSelector('[data-hook-name]', { timeout: 8000 });
        /* Reopening repaints from the list already in hand, then again when the fresh read lands. */
        await page.waitForFunction(() => /last used/.test((document.querySelector('.pjs-hook-when') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const again = await page.evaluate(() => ({ url: !!document.getElementById('pjs-hook-url'), when: (document.querySelector('.pjs-hook-when') || {}).textContent || '' }));
        chk(hidden && !again.url, '[once] Done hides the link and reopening settings never shows it again', JSON.stringify({ hidden, again }));
        chk(/last used/.test(again.when), '[once] the row says when it was last used', again.when);

        // Rename keeps the link.
        await page.fill('[data-hook-name]', 'Billing system');
        await page.press('[data-hook-name]', 'Enter');
        await page.waitForFunction(() => /Renamed/.test(document.getElementById('pjs-hooks-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const still = await page.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"after rename"}' })).status, made.url);
        const renamed = projects.get(proj.id).tasks.find((x) => x.sentence === 'after rename');
        chk(still === 201 && renamed && renamed.addedBy === 'Billing system', '[rename] the same link still works, under the new name', JSON.stringify({ still, by: renamed && renamed.addedBy }));

        // Delete asks first; Keep it cancels; Delete revokes.
        await page.click('[data-hook-delete]');
        const asked = await page.evaluate(() => !!document.querySelector('[data-hook-delete-yes]') && /stops working/.test(document.querySelector('.pjs-hook-confirm').textContent));
        await page.click('[data-hook-delete-no]');
        const kept = await page.evaluate(() => !!document.querySelector('[data-hook-name]') && !document.querySelector('[data-hook-delete-yes]'));
        chk(asked && kept, '[delete] asks first, and Keep it cancels', JSON.stringify({ asked, kept }));
        await page.click('[data-hook-delete]');
        await page.click('[data-hook-delete-yes]');
        await page.waitForFunction(() => /Deleted/.test(document.getElementById('pjs-hooks-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const gone = await page.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"after delete"}' })).status, made.url);
        const rowGone = await page.evaluate(() => !document.querySelector('[data-hook-name]'));
        chk(gone === 404 && rowGone, '[delete] the row goes and the link stops working', JSON.stringify({ gone, rowGone }));

        // The Tasks view marks a webhook task, and escapes the webhook's name.
        const evil = await page.evaluate(async (id) => {
          const r = await fetch('/api/project/' + encodeURIComponent(id) + '/webhooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '<i id="inj">Zap</i>' }) });
          const b = await r.json();
          const c = await fetch(b.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"from the evil name"}' });
          return c.status;
        }, proj.id);
        await page.evaluate(() => showTab('tasks'));
        await page.waitForFunction(() => [...document.querySelectorAll('.tsk-from')].some((e) => /Zap/.test(e.textContent)), null, { timeout: 8000 }).catch(() => {});
        const mark = await page.evaluate(() => {
          const all = [...document.querySelectorAll('.tsk-from')].map((e) => e.textContent);
          return { all, injected: !!document.getElementById('inj') };
        });
        chk(evil === 201 && mark.all.includes('From <i id="inj">Zap</i> (a webhook)') && mark.all.includes('From Billing system (a webhook)'),
          '[tasks] webhook tasks say which webhook they came from', JSON.stringify({ evil, mark }));
        chk(!mark.injected, '[tasks] a webhook name with HTML in it is shown as text, never run as markup');
      } else {
        // The other passes: a made webhook as the person sees it.
        await page.click('#pjs-hook-add');
        await page.waitForSelector('#pjs-hook-url', { timeout: 8000 });
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `webhooks-made-${theme}-${width}.png`), fullPage: false }); }
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      chk(!wide, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
