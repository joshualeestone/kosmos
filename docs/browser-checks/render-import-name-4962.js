// Browser-check-surface: import-found fr-importrow fr-importinput fr-importgo
'use strict';

/**
 * kosmos#4962: on Create an agent > Import, a found agent file that does not say what to call the agent shows a
 * Name field on its row and is added right there.
 *
 * Harness: the real board (its own sandbox), with the import routes answered by Playwright so the rows are known:
 *   /api/scan-import       two loose files, one nameless and one named "Don"
 *   /api/agent-import-file the nameless file parses with no name (and a displayName of its own, which the
 *                          typed name must beat); the named file parses as don / Don
 *   /api/agents            records each create body and answers created (no agent is made)
 *
 * Checks, each engine:
 *   N1 the nameless row has a labelled Name field with its helper; the named row has none;
 *   N2 Add with the field empty says "Give this agent a name first.", puts the cursor in the field, sends nothing;
 *   N3 typing a name and pressing Enter adds it: the create body carries the typed name as name and label, and the
 *      row reads "Added to Kosmos";
 *   N4 control: the named row adds with the file's own name;
 *   N5 at 320px, dark, the nameless row fits without a sideways scroll.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-import-name-4962.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-in-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chkAll(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}

const NAMELESS = '/Users/p/Downloads/pip.md';
const NAMED = '/Users/p/Downloads/don.md';
const SCAN = { ok: true, scanning: false, candidates: [], bounded: {},
  importable: [{ file: NAMELESS, name: '' }, { file: NAMED, name: 'Don' }] };
const PARSE = {
  [NAMELESS]: { ok: true, name: '', displayName: 'Template Bot', instructions: 'You help with the site.', provider: 'anthropic' },
  [NAMED]: { ok: true, name: 'don', displayName: 'Don', instructions: 'You are Don.', provider: 'anthropic' },
};

(async () => {
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  for (const [ENGINE, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: process.env.HEADED === '0' });
    const chk = (ok, label, extra) => chkAll(ok, ENGINE + ' ' + label, extra);
    const fresh = async (opts) => {
      const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
      const page = await ctx.newPage();
      const creates = [];
      await page.route('**/api/scan-import', (r) => r.fulfill({ json: SCAN }));
      await page.route('**/api/agent-import-file', (r) => {
        const body = JSON.parse(r.request().postData() || '{}');
        return r.fulfill({ json: PARSE[body.file] || { ok: false, because: 'that file is not one we found on this computer to import' } });
      });
      await page.route('**/api/agents', (r) => {
        if (r.request().method() !== 'POST') return r.fallback();
        creates.push(JSON.parse(r.request().postData() || '{}'));
        return r.fulfill({ json: { ok: true, outcome: 'created', name: 'made' } });
      });
      await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
      await page.evaluate(() => fetch('/api/first-run/complete', { method: 'POST' }).catch(() => null));
      await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
      await page.waitForFunction(() => { const c = document.getElementById('boot-cover'); return !c || c.hidden; }, null, { timeout: 15000 });
      await page.click('#cstep-kind [data-path="single"]');
      await page.waitForSelector('#pick-import:not([hidden])', { timeout: 10000 });
      await page.click('#pick-import');
      await page.waitForSelector('#import-found .fr-importrow', { timeout: 15000 });
      const row = (file) => page.locator('#import-found .fr-importrow[data-import-file="' + file + '"]');
      return { ctx, page, creates, row };
    };
    try {
      {
        const { ctx, page, creates, row } = await fresh();
        const nr = row(NAMELESS);
        const field = nr.locator('.fr-importinput');
        const n1 = await nr.evaluate((el) => {
          const f = el.querySelector('.fr-importinput');
          const lab = f && el.querySelector('label[for="' + f.id + '"]');
          const ids = f ? String(f.getAttribute('aria-describedby') || '').split(/\s+/) : [];
          const help = f && ids.includes(f.id + '-help') ? document.getElementById(f.id + '-help') : null;
          return { field: !!f, label: lab ? lab.textContent : null, help: help ? help.textContent : null };
        });
        chk(n1.field && n1.label === 'Name' && /What should we call it\?/.test(n1.help || ''), 'N1 the nameless row has a labelled Name field with its helper', JSON.stringify(n1));
        chk((await row(NAMED).locator('.fr-importinput').count()) === 0, 'N1 the named row has no field');

        await nr.locator('.fr-importgo').click();
        await page.waitForTimeout(300);
        const n2 = await nr.evaluate((el) => ({ said: el.querySelector('.fr-importsaid').textContent, focused: document.activeElement === el.querySelector('.fr-importinput') }));
        chk(n2.said === 'Give this agent a name first.' && n2.focused && creates.length === 0, 'N2 an empty field asks for a name, focuses it, sends nothing', JSON.stringify({ ...n2, creates: creates.length }));

        await field.fill('Claude Pip');
        await field.press('Enter');
        const added = await page.waitForFunction((f) => {
          const r = document.querySelector('#import-found .fr-importrow[data-import-file="' + f + '"] .fr-importgo');
          return r && r.textContent === 'Added to Kosmos';
        }, NAMELESS, { timeout: 10000 }).then(() => true, () => false);
        const body = creates[0] || {};
        chk(added && body.name === 'Claude Pip' && body.label === 'Claude Pip', 'N3 Enter adds it with the typed name as name and label', JSON.stringify({ added, name: body.name, label: body.label }));

        await row(NAMED).locator('.fr-importgo').click();
        const added2 = await page.waitForFunction((f) => {
          const r = document.querySelector('#import-found .fr-importrow[data-import-file="' + f + '"] .fr-importgo');
          return r && r.textContent === 'Added to Kosmos';
        }, NAMED, { timeout: 10000 }).then(() => true, () => false);
        const b2 = creates[1] || {};
        chk(added2 && b2.name === 'don' && b2.label === 'Don', 'N4 control: the named row adds with the file\'s own name', JSON.stringify({ added2, name: b2.name, label: b2.label }));
        await ctx.close();
      }
      {
        const { ctx, page, row } = await fresh({ viewport: { width: 320, height: 640 }, colorScheme: 'dark' });
        const over = await row(NAMELESS).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { right: Math.round(r.right), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
        });
        chk(over.right <= over.vw && over.sw <= over.vw, 'N5 at 320px dark the nameless row fits without a sideways scroll', JSON.stringify(over));
        if (process.env.IN_SHOTS) await row(NAMELESS).screenshot({ path: path.join(process.env.IN_SHOTS, 'importname-320-dark-' + ENGINE + '.png') });
        await ctx.close();
      }
    } catch (err) {
      chk(false, 'the check ran to the end', String(err && err.stack || err).slice(0, 400));
    } finally {
      await browser.close().catch(() => {});
    }
  }
  await new Promise((res) => server.close(res));
  for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  console.log('\n' + pass + ' PASS / ' + fail.length + ' FAIL');
  process.exit(fail.length ? 1 : 0);
})();
