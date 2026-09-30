// Browser-check-surface: pjs-own-field pjs-own-add pjs-own-code pjs-own-copy pjs-own-msg pjs-own-row pj-join-owner
'use strict';
/**
 * kosmos#4649 (weekend goal #4647): "Add your other computer" in a project's settings.
 *
 * What this pins, and why each line can fail:
 *  - the field is a shared-room control: HIDDEN until federation is live for a Kosmos Plus member
 *    (the same data-fed-ui gate as the invite panel), SHOWN once it is;
 *  - pressing it makes a real code through the real POST /api/federation/own-code, the code names
 *    THIS project's room (the engine parses it back to the project's owner link), and the link is
 *    marked shared with the person's other computers;
 *  - a code shown for one project never shows in another project's settings;
 *  - on the joining computer, Verify shows the code as shared by "Your other computer", never as
 *    a Kosmos+ address (an own code's owner_handle is not a name to append .kosmosplus.com to);
 *  - kosmos#4699: a code made on a computer that is not on this account is refused, and the page says
 *    so in words ("not on this Kosmos+ account");
 *  - 390 wide with no sideways scroll, chromium and webkit, no page errors.
 *
 *   HEADED=0 node docs/browser-checks/render-owncode-4649.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-owncode-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-owncode-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-owncode-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-owncode-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-owncode-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const federation = require('../../engine/federation');
const remote = require('../../engine/remote');
remote.kosmosPlus = () => true;   // the own-code route needs Kosmos Plus; the page gate is stubbed the same way below
remote.address = () => 'study.kosmos.test';   // kosmos#4699: a code names the computer that made it, so the route needs this one's address
// kosmos#4699: Verify checks a code's maker against this account's computers. The coordinator's
// answer is stubbed: this account has "study" (this board) and "laptop".
remote.macRequest = async (method, route) => (route === '/v1/mac/account-computers'
  ? { ok: true, data: { computers: [{ name: 'study', address: 'study.kosmos.test', this: true }, { name: 'laptop', address: 'laptop.kosmos.test', this: false }] } }
  : { ok: false, because: 'unexpected route ' + route });

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        for (const [live, width] of [[false, 1280], [true, 1280], [true, 390]]) {
          const E = `[${engineName} ${live ? 'live' : 'not live'} ${width}]`;
          const a = projects.create({ name: 'Four Computers ' + engineName + width + live });
          const b = projects.create({ name: 'Another ' + engineName + width + live });
          const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          // The gate reads federationLive and kosmos_plus off the status poll.
          await page.route('**/api/status*', async (r) => {
            const resp = await r.fetch();
            const j = await resp.json().catch(() => null);
            if (!j) return r.fulfill({ response: resp });
            j.federationLive = live; j.kosmos_plus = live;
            return r.fulfill({ response: resp, json: j });
          });
          await page.goto(URL, { waitUntil: 'networkidle' });
          if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
          const open = async (id) => {
            await page.evaluate(async (pid) => { await loadProjects(); showTab('projects'); openProject(pid); }, id);
            await page.click('#pj-settings-link');
            await page.waitForSelector('#pj-settings-view:not([hidden])', { timeout: 8000 });
          };
          await page.waitForFunction((want) => document.documentElement.getAttribute('data-fed-ui') === want, live ? 'show' : 'hidden', { timeout: 8000 }).catch(() => null);
          await open(a.id);
          const shown = await page.isVisible('#pjs-own-add');
          if (!live) {
            chk(!shown, `${E} hidden while federation is not live (the shared-room gate)`);
            chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
            await ctx.close();
            continue;
          }
          chk(shown, `${E} shown once federation is live for a member`);
          await page.click('#pjs-own-add');
          await page.waitForFunction(() => document.getElementById('pjs-own-code').value !== '', null, { timeout: 8000 }).catch(() => null);
          const got = await page.evaluate(() => ({ code: document.getElementById('pjs-own-code').value, row: !document.getElementById('pjs-own-row').hidden, msg: document.getElementById('pjs-own-msg').textContent }));
          const parsed = federation.parseOwnCode(got.code);
          const link = federation.linkFor(a.id);
          chk(parsed && link && parsed.ref === link.ref && parsed.name === a.name && parsed.from === 'study', `${E} the code names THIS project's room and the computer that made it`, JSON.stringify({ parsed, link }));
          chk(link && link.role === 'owner' && link.selfShared === true, `${E} the project is marked shared with the person's other computers`, JSON.stringify(link));
          chk(got.row && /Join a project/.test(got.msg), `${E} the code and how to use it are shown`, got.msg);
          await open(b.id);
          const other = await page.evaluate(() => ({ code: document.getElementById('pjs-own-code').value, row: !document.getElementById('pjs-own-row').hidden }));
          chk(other.code === '' && !other.row, `${E} another project's settings do not show the first one's code`, JSON.stringify(other));
          // The joining side: an own code for a room NOT on this board (this board's own code would
          // be refused as already here), verified through the real /api/federation/verify.
          const ownCodeFrom = (from) => federation.OWN_PREFIX + Buffer.from(JSON.stringify({ v: 2, ref: 'bc-' + from + '-' + engineName + width, name: 'From the ' + from, from }), 'utf8').toString('base64url');
          // kosmos#4699: a code made on a computer that is NOT on this account is refused, in words.
          const stranger = await page.evaluate(async (c) => {
            document.getElementById('pj-join-code').value = c;
            await pjVerifyCode();
            return { owner: document.getElementById('pj-join-owner').textContent, err: document.getElementById('pj-join-err').textContent };
          }, ownCodeFrom('elsewhere'));
          chk(/not on this Kosmos\+ account/.test(stranger.err) && stranger.owner !== 'Your other computer', `${E} a code from a computer that is not on this account is refused, and says so`, JSON.stringify(stranger));
          const foreign = ownCodeFrom('laptop');
          const owner = await page.evaluate(async (c) => {
            document.getElementById('pj-join-code').value = c;
            await pjVerifyCode();
            return { owner: document.getElementById('pj-join-owner').textContent, err: document.getElementById('pj-join-err').textContent };
          }, foreign);
          chk(owner.owner === 'Your other computer', `${E} Verify of an own code says it is shared by your other computer, with no .kosmosplus.com`, JSON.stringify(owner));
          const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          chk(!wide, `${E} no sideways scroll`);
          chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
          await ctx.close();
        }
      } finally { await browser.close(); }
    }
  } finally {
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-owncode-4649 crashed: ' + ((e && e.stack) || e)); process.exit(1); });
