// Browser-check-surface: plus-asks plus-ask-rows plus-asks-title askcard ask-rows plus-join plus-join-match askwait JOIN_WAIT_WORDS
'use strict';
/**
 * The "wants to connect" sheet (#4637, Josh 09-29: "radically redesign... doesn't fit the branding"; Mona Lisa's flow
 * outline on #4754, Josh's go 09-30 17:34).
 *
 * What this pins, and why each line can fail:
 *  - another of the person's computers joining (#4773's joining_computer) reads "Your computer "windowsbox" wants to
 *    join", with "Allow it if windowsbox shows this same code." (#4794); a phone beside it (the CONTROL) keeps its
 *    own name and the device-in-your-hand line;
 *  - each sheet carries the Kosmos+ brand, the code once as one large line read out a character at a time, then
 *    Allow and a quiet Not me (no Deny, no letter boxes);
 *  - Allow on the computer turns its sheet into "windowsbox is connected." with where to remove it;
 *  - on another page the notice says the sheet's words ("Your computer "windowsbox" wants to join." for one, "2 devices want
 *    to connect to your Kosmos." for two) with Review;
 *  - an Allow that fails leaves the request waiting (the heading stays, its sheet first); with nothing waiting the heading goes;
 *  - #4794 slice 1: the computer's sheet says "Allow it if windowsbox shows this same code." and Allow sends that code (a
 *    phone's Allow sends none); with no code yet a quiet line says why (code_wait, Mona Lisa's words; an unknown value
 *    gets the default) and Allow is disabled; a refused code ("code_changed") is worded;
 *  - #4794: on the computer WAITING, #plus-join replaces the coordinator's sentence: working out, the code with "The
 *    codes match" (which posts that code), "Matched. Now press Allow on <name>.", ran out, too many tries;
 *  - 1400 and 390 wide, no sideways scroll, no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   HEADED=0 node docs/browser-checks/render-connect-sheet-4637.js
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-connect-sheet-4637: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const now = () => Math.floor(Date.now() / 1000);
/* The worst contrast of an element's text against every stop of its host's gradient (the sheet's or the notice's
   navy), WCAG relative luminance. The small new text on navy is measured, not assumed (review round 3). */
const WORST_CONTRAST = `(el) => {
  const nums = (v) => (v.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const host = el.closest('.askreq') || el.closest('#askcard');
  const stops = (getComputedStyle(host).backgroundImage.match(/rgba?\\([^)]*\\)/g) || []).map(nums);
  const fg = lum(nums(getComputedStyle(el).color));
  return stops.length ? Math.min(...stops.map((st) => { const b = lum(st); return (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05); })) : 0;
}`;
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'hers.kosmosplus.com' } };

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const width of [1400, 390]) {
      const tag = `[${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      let pending = [
        { device_id: 'd-pc', name: 'windowsbox', code: '482 915', first_seen: now() - 30, joining_computer: 'windowsbox' },
        { device_id: 'd-ph', name: 'iPhone', code: 'K7-4M', first_seen: now() - 90, joining_computer: null },
      ];
      let remoteNow = REMOTE;   // #4794: switched to waiting-allow for the joining arms
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? remoteNow : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: pending, email: 'you@example.com' })));
      let phoneFailsOnce = true;   // the phone's first Allow fails: its sheet must still read as waiting
      const allowBodies = {};      // #4794: what each Allow sent
      let codeChangedOnce = false; // #4794: set to refuse one computer Allow with code_changed
      await page.route('**/api/remote/devices/allow', (route, req) => {
        const sent = JSON.parse(req.postData() || '{}'); const id = sent.device_id; allowBodies[id] = sent;
        if (codeChangedOnce) { codeChangedOnce = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'code_changed' }) }); }
        if (id === 'd-ph' && phoneFailsOnce) { phoneFailsOnce = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the tunnel did not answer' }) }); }
        pending = pending.filter((d) => d.device_id !== id); return route.fulfill(json({ ok: true }));
      });
      await page.route('**/api/remote/devices/deny', (route, req) => { const id = JSON.parse(req.postData() || '{}').device_id; pending = pending.filter((d) => d.device_id !== id); return route.fulfill(json({ ok: true })); });
      await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, allowed: [], pending })));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

      /* On another page, one request: the notice says the sheet's own words. */
      const both = pending;
      pending = both.filter((d) => d.device_id === 'd-pc');
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(300);
      const one = await page.evaluate(() => (document.getElementById('askcard').innerText || '').replace(/\s+/g, ' ').trim());
      chk(/Your computer "windowsbox" wants to join\./.test(one), `${tag} one computer waiting: the notice says "Your computer "windowsbox" wants to join."`, one);
      pending = both;
      /* On another page: the compact notice, in the same words. */
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(500);
      const note = await page.evaluate(() => {
        const c = document.getElementById('askcard');
        return { shown: !!(c && !c.hidden && c.getBoundingClientRect().height > 0), text: (c && c.innerText || '').replace(/\s+/g, ' ').trim(), review: !!(c && c.querySelector('[data-ask="open"]')) };
      });
      chk(note.shown && /2 devices want to connect to your Kosmos\./.test(note.text) && note.review && /kosmos\+/i.test(note.text), `${tag} on another page: a Kosmos+ notice with Review`, JSON.stringify(note));
      const noteContrast = await page.evaluate((fn) => { const w = eval(fn); const n = document.querySelector('#askcard .asknote');
        return n ? [...n.querySelectorAll('span')].map((e) => Math.round(w(e) * 100) / 100) : []; }, WORST_CONTRAST);
      chk(noteContrast.length === 2 && noteContrast.every((r) => r >= 4.5), `${tag} the notice's words read on its navy (4.5:1)`, JSON.stringify(noteContrast));
      /* Review W2: the notice's edges line up with the banner under it (#conn). Fails if the banner is not shown. */
      const edges = await page.evaluate(() => {
        const a = document.getElementById('askcard').getBoundingClientRect(), c = document.getElementById('conn');
        const b = c && !c.hidden && c.getBoundingClientRect().height > 0 ? c.getBoundingClientRect() : null;
        return b ? { dl: Math.round(a.left - b.left), dr: Math.round(a.right - b.right) } : null;
      });
      chk(edges && Math.abs(edges.dl) <= 1 && Math.abs(edges.dr) <= 1, `${tag} the notice lines up with the banner under it`, JSON.stringify(edges));

      /* On Kosmos Plus: the sheets. */
      await page.evaluate(() => showTab('settings'));
      // First run can open after the early Escape; it must not sit over the Kosmos+ tab.
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForSelector('#plus-ask-rows .askreq', { timeout: 5000 }).catch(() => {});
      const sheets = await page.evaluate(() => [...document.querySelectorAll('#plus-ask-rows .askreq')].map((r) => {
        const code = r.querySelector('.askcodebig');
        const acts = [...r.querySelectorAll('.acts button')].map((b) => b.textContent.trim());
        return { brand: (r.querySelector('.askbrand') || {}).textContent || '', head: (r.querySelector('.askwho b') || {}).textContent || '',
          say: (r.querySelector('.asksay') || {}).textContent || '', code: code ? code.textContent : '', label: code ? code.getAttribute('aria-label') : '',
          size: code ? parseFloat(getComputedStyle(code).fontSize) : 0, boxes: r.querySelectorAll('.devcode-cell').length,
          aboveActs: !!(code && code.nextElementSibling && code.nextElementSibling.classList.contains('acts')), acts,
          inside: !code || code.getBoundingClientRect().right <= r.getBoundingClientRect().right + 0.5,
          /* The headline gets the sheet's width, not the icon's 40px column (a grid slip read one word per line). */
          headShare: (r.querySelector('.askwho') || r).getBoundingClientRect().width / r.getBoundingClientRect().width };
      }));
      /* Measured while the sheets are there (an empty list would pass every()). */
      const nowrap = await page.evaluate(() => { const t = [...document.querySelectorAll('#plus-ask-rows .askreq .askwho span')]; return t.length === 2 && t.every((e) => getComputedStyle(e).whiteSpace === 'nowrap'); });
      const contrast = await page.evaluate((fn) => { const w = eval(fn); const pick = (sel) => document.querySelector('#plus-ask-rows ' + sel);
        return Object.fromEntries([['brand', '.askbrand'], ['time', '.askwho span'], ['notme', '.btn.quiet'], ['say', '.asksay']].map(([k, sel]) => [k, pick(sel) ? Math.round(w(pick(sel)) * 100) / 100 : 0])); }, WORST_CONTRAST);
      chk(Object.values(contrast).every((r) => r >= 4.5), `${tag} the sheet's small text reads on the navy (4.5:1 against every stop of its gradient)`, JSON.stringify(contrast));
      const pc = sheets.find((x) => /windowsbox/.test(x.head)) || {};
      const ph = sheets.find((x) => /iPhone/.test(x.head)) || {};
      chk(pc.head === 'Your computer "windowsbox" wants to join' && pc.say === 'Allow it if windowsbox shows this same code.',
        `${tag} a computer joining reads as one of your own computers`, JSON.stringify(pc));
      chk(ph.head === 'iPhone wants to connect to your Kosmos' && /Allow only if this code is showing on the device in your hand\./.test(ph.say) && !/signed it in/.test(ph.say),
        `${tag} CONTROL: a phone keeps its own name and the device-in-your-hand line`, JSON.stringify(ph));
      chk(sheets.length === 2 && sheets.every((x) => /kosmos\+/i.test(x.brand) && x.boxes === 0 && x.size >= 28 && x.aboveActs && x.inside && x.headShare >= 0.5 && JSON.stringify(x.acts) === JSON.stringify(['Allow', 'Not me'])),
        `${tag} each sheet: the Kosmos+ brand, a headline across the sheet, the code once and large (no boxes), directly above Allow and Not me`, JSON.stringify(sheets));
      chk(pc.code === '482 915' && pc.label === '4 8 2, 9 1 5', `${tag} the code is read out a character at a time`, JSON.stringify([pc.code, pc.label]));
      chk(await page.evaluate(() => document.getElementById('plus-asks-title').textContent) === 'Waiting for you', `${tag} the section says Waiting for you, not the old wording`);

      /* Allow the computer: its sheet says it is connected. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-pc"]');
      await page.waitForFunction(() => /windowsbox is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const done = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/windowsbox is connected\. You can remove it any time under Devices\./.test(done) && !/trust each other/.test(done),
        `${tag} after Allow: "windowsbox is connected." and where to remove it`, done);
      chk(/iPhone wants to connect to your Kosmos/.test(done), `${tag} the other request is still waiting`, done);
      chk(allowBodies['d-pc'] && allowBodies['d-pc'].code === '482 915', `${tag} #4794: Allow on the computer sends the code it showed`, JSON.stringify(allowBodies['d-pc']));
      chk(await page.evaluate(() => !document.getElementById('plus-asks-title').hidden), `${tag} with a request still waiting, the heading shows`);
      /* Review W1: under the heading, what waits comes first; the answered line follows it. */
      const order = await page.evaluate(() => [...document.getElementById('plus-ask-rows').children].map((e) => e.classList.contains('askreq') ? 'waiting' : 'answered'));
      chk(JSON.stringify(order) === JSON.stringify(['waiting', 'answered']), `${tag} the waiting sheet sits under the heading, the answered line after it`, JSON.stringify(order));
      /* Review round 1: an Allow that fails leaves the request waiting: the heading stays and its sheet stays first. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-ph"]');
      await page.waitForFunction(() => /did not answer/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const err = await page.evaluate(() => ({ title: !document.getElementById('plus-asks-title').hidden, reason: /the tunnel did not answer/.test(document.getElementById('plus-ask-rows').innerText),
        order: [...document.getElementById('plus-ask-rows').children].map((e) => e.classList.contains('askreq') ? 'waiting' : 'answered') }));
      chk(err.title && err.reason && JSON.stringify(err.order) === JSON.stringify(['waiting', 'answered']), `${tag} a failed Allow still waits and says why: the heading stays, its sheet first`, JSON.stringify(err));
      /* Review W1: with nothing left waiting, "Waiting for you" goes; the success lines stand alone. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-ph"]');
      await page.waitForFunction(() => /iPhone is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const after = await page.evaluate(() => ({ title: !document.getElementById('plus-asks-title').hidden, text: (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' ') }));
      chk(allowBodies['d-ph'] && allowBodies['d-ph'].code === undefined, `${tag} #4794 CONTROL: a phone's Allow sends no code`, JSON.stringify(allowBodies['d-ph']));
      chk(!after.title && /windowsbox is connected\./.test(after.text) && /iPhone is connected\./.test(after.text), `${tag} nothing waiting: no "Waiting for you" over the success lines`, JSON.stringify(after));

      chk(nowrap, `${tag} "a moment ago" stays on one line`);
      /* #4794: a computer whose code is not worked out yet: a quiet line in the code's place, Allow disabled, Not me enabled. */
      const waitCase = async (code_wait) => {
        pending = [{ device_id: 'd-w', name: 'laptop3', code: '', first_seen: now() - 10, joining_computer: 'laptop3', code_wait }];
        await page.evaluate(() => pollAsk());
        await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-w"]', { timeout: 5000 }).catch(() => {});
        return page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); if (!r) return null;
          const a = r.querySelector('[data-ask="allow"]'), n = r.querySelector('[data-ask="deny"]');
          return { wait: (r.querySelector('.askwait') || {}).textContent || '', code: !!r.querySelector('.askcodebig'), allowOff: !!(a && a.disabled), denyOn: !!(n && !n.disabled) }; });
      };
      const dl = await waitCase('daily_limit');
      chk(dl && dl.wait === 'This computer has added as many computers as it can today. Try again tomorrow.' && !dl.code && dl.allowOff && dl.denyOn,
        `${tag} #4794: no code yet (daily_limit): Mona's line, no code, Allow disabled, Not me enabled`, JSON.stringify(dl));
      const wac = await (async () => {   // was_a_computer comes on a row with no joining_computer (devices.rs)
        pending = [{ device_id: 'd-wac', name: 'oldbox', code: '777 777', first_seen: now() - 10, joining_computer: null, code_wait: 'was_a_computer' }];
        await page.evaluate(() => pollAsk());
        await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-wac"]', { timeout: 5000 }).catch(() => {});
        return page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); const a = r && r.querySelector('[data-ask="allow"]');
          return r ? { wait: (r.querySelector('.askwait') || {}).textContent || '', allowOff: !!(a && a.disabled), code: !!r.querySelector('.askcodebig') } : null; });
      })();
      chk(wac && wac.wait === 'This started as a computer and now shows as a device, so it cannot be allowed. Press Not me.' && wac.allowOff && !wac.code,
        `${tag} #4794: was_a_computer (no joining_computer, even WITH a code): its line, no code, Allow disabled (reviews 1, 3)`, JSON.stringify(wac));
      const unk = await waitCase(null);
      chk(unk && unk.wait === 'Working out the code with laptop3. It shows here in a moment.' && unk.allowOff,
        `${tag} #4794: no code and no reason: the default line, Allow disabled`, JSON.stringify(unk));
      /* #4794: Allow refused because the code changed is worded, not relayed raw. */
      pending = [{ device_id: 'd-cc', name: 'laptop4', code: '135 792', first_seen: now() - 10, joining_computer: 'laptop4' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]', { timeout: 5000 }).catch(() => {});
      codeChangedOnce = true;
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]');
      await page.waitForFunction(() => /code changed/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const cc = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/The code changed before you pressed Allow\. Check the new one on laptop4, then press Allow again\./.test(cc) && !/code_changed/.test(cc),
        `${tag} #4794: a refused code is worded ("The code changed..."), never the raw tag`, cc);
      const heldOff = await page.evaluate(() => { const a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]'); return !!(a && a.disabled); });
      chk(heldOff, `${tag} #4794: after "code changed", Allow waits while the same code shows (review 3)`);
      pending = [{ device_id: 'd-cc', name: 'laptop4', code: '864 201', first_seen: now() - 10, joining_computer: 'laptop4' }];
      await page.evaluate(() => pollAsk());
      await page.waitForTimeout(400);
      const fresh = await page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); const a = r && r.querySelector('[data-ask="allow"]');
        return r ? { allowOn: !!(a && !a.disabled), say: (r.querySelector('.asksay') || {}).textContent || '', code: (r.querySelector('.askcodebig') || {}).textContent || '' } : null; });
      chk(fresh && fresh.allowOn && fresh.code === '864 201' && !/code changed/.test(fresh.say), `${tag} #4794: a new code clears the refusal and Allow is back (review 3)`, JSON.stringify(fresh));

      /* #4794: this computer WAITING to be allowed. The pill says so; #plus-join replaces the coordinator's sentence. */
      let join = { supported: true, held: true, join_code: '', on: null, asked_of: ['homemac'], failed: false, confirmed: false, confirm_expired: false };
      let confirmBody = null;
      remoteNow = { ...REMOTE, status: { state: 'waiting-allow', because: 'waiting for one of your computers to allow this one' } };
      let joinDelayMs = 0;     // review 1: hold the pairing round open, as the tunnel's real round can take seconds
      let confirmRefuse = '';  // review 1: a confirm the tunnel refuses (code_expired)
      await page.route('**/api/remote/join', async (route) => { if (joinDelayMs) await new Promise((r) => setTimeout(r, joinDelayMs)); return route.fulfill(json(join)); });
      await page.route('**/api/remote/join/confirm', (route, req) => { confirmBody = JSON.parse(req.postData() || '{}');
        if (confirmRefuse) { const why = confirmRefuse; confirmRefuse = ''; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: why }) }); }
        join = { ...join, confirmed: true }; return route.fulfill(json({ ok: true, confirmed: true, with: 'homemac' })); });
      const readJoin = async () => { await page.evaluate(() => { PLUS_JOIN_AT = 0; return paintPlus(); }); await page.waitForTimeout(700);
        return page.evaluate(() => { const j = document.getElementById('plus-join'), b = document.getElementById('plus-join-match'), c = j && j.querySelector('.askcodebig');
          return { shown: !!(j && !j.hidden), text: (j && j.innerText || '').replace(/\s+/g, ' ').trim(), code: c ? c.textContent : '', label: c ? c.getAttribute('aria-label') : '',
            size: c ? parseFloat(getComputedStyle(c).fontSize) : 0, button: b ? b.getAttribute('aria-label') : null, status: document.getElementById('plus-status').textContent,
            pill: document.getElementById('plus-pill').textContent }; }); };
      let jr = await readJoin();
      chk(jr.shown && jr.text === 'Working out the code with homemac...' && !jr.button && jr.status === '' && jr.pill === 'Waiting to be allowed',
        `${tag} #4794 waiting: "Working out the code with homemac...", no button, the coordinator's sentence gone`, JSON.stringify(jr));
      join = { ...join, join_code: '482 915', on: 'homemac' };
      jr = await readJoin();
      chk(jr.shown && /^Check that homemac shows this same code\./.test(jr.text) && jr.code === '482 915' && jr.label === '4 8 2, 9 1 5' && jr.size >= 28 && jr.button === 'The codes match: 4 8 2, 9 1 5',
        `${tag} #4794 waiting: the code large (as on the Allow card) and "The codes match"`, JSON.stringify(jr));
      /* Review 1: while a pairing round is in flight the coordinator's sentence must not come back beside the block. */
      joinDelayMs = 2500;
      const midRound = await page.evaluate(async () => { PLUS_JOIN_AT = 0; const p = paintPlus(); await new Promise((r) => setTimeout(r, 1200));
        const st = document.getElementById('plus-status').textContent; await p; return st; });
      joinDelayMs = 0;
      chk(midRound === '', `${tag} #4794: during a pairing round the coordinator's sentence stays away (one wait message)`, JSON.stringify(midRound));
      /* Review 1: a confirm the tunnel refuses (the code ran out) is worded, not relayed raw. */
      confirmRefuse = 'code_expired';
      await page.click('#plus-join-match');
      await page.waitForFunction(() => /ran out/.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      const refused = await page.evaluate(() => (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' '));
      chk(/That code ran out\. A new one is on its way\./.test(refused) && !/code_expired/.test(refused), `${tag} #4794: a refused confirm (expired) is worded`, refused);
      /* Review 2: the same refusal again must leave the button pressable (an identical repaint was skipped before). */
      confirmRefuse = 'code_expired';
      await page.click('#plus-join-match');
      await page.waitForTimeout(800);
      const again2 = await page.evaluate(() => { const b = document.getElementById('plus-join-match'); return { there: !!b, enabled: !!(b && !b.disabled) }; });
      chk(again2.there && again2.enabled, `${tag} #4794: after the same refusal twice the button can be pressed again`, JSON.stringify(again2));
      await page.click('#plus-join-match');
      await page.waitForFunction(() => /Matched\./.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      jr = await readJoin();
      chk(confirmBody && confirmBody.code === '482 915' && /^Matched\. Now press Allow on homemac\./.test(jr.text) && jr.code === '482 915' && !jr.button,
        `${tag} #4794 waiting: "The codes match" posts the code shown; then "Matched. Now press Allow on homemac." and the code stays`, JSON.stringify({ confirmBody, jr }));
      join = { ...join, join_code: '', confirmed: false, confirm_expired: true };
      jr = await readJoin();
      chk(jr.text === 'That code ran out. A new one is on its way.' && !jr.button && !jr.code, `${tag} #4794 waiting: a code that ran out says a new one follows, no button`, JSON.stringify(jr));
      join = { ...join, failed: true };
      jr = await readJoin();
      chk(jr.text === 'Too many tries. On homemac, press Not me on this request, then sign this computer in again.' && !jr.button,
        `${tag} #4794 waiting: too many tries says the recovery`, JSON.stringify(jr));
      /* Review 3 (the tunnel's own contract): after the other computer's Allow this computer is connected and no longer
         held, but the code stays until it is confirmed here. The block must still show it, with the button. */
      join = { ...join, held: false, failed: false, confirm_expired: false, confirmed: false, join_code: '246 810', on: 'homemac' };
      remoteNow = REMOTE;   // connected
      jr = await readJoin();
      chk(jr.shown && /^Check that homemac shows this same code\./.test(jr.text) && jr.code === '246 810' && jr.button && jr.pill === 'Connected' && jr.status === '',
        `${tag} #4794: allowed but not yet confirmed: the code and The codes match stay (the pill says Connected, the sentence stays away)`, JSON.stringify(jr));
      /* By the page's clock a code older than the tunnel's 10 minutes is shown as run out, even if rounds keep failing. */
      await page.evaluate(() => { PLUS_JOIN_CODE_AT = Date.now() - 601 * 1000; });
      remoteNow = { ...REMOTE, status: { state: 'waiting-allow', because: 'waiting' } };
      join = { ...join, held: true };
      await page.evaluate(() => paintPlusJoin());
      const old = await page.evaluate(() => (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim());
      chk(old === 'That code ran out. A new one is on its way.', `${tag} #4794: a code past 10 minutes by the page's clock reads as run out`, old);
      /* CONTROL: connected and confirmed (not waiting), the block is gone. */
      join = { ...join, held: false, confirmed: true };
      remoteNow = REMOTE;
      jr = await readJoin();
      chk(!jr.shown && jr.pill === 'Connected', `${tag} #4794 CONTROL: connected, no pairing block`, JSON.stringify(jr));
      /* Not me on a computer joining names it the way its sheet did (review round 5). */
      pending = [{ device_id: 'd-pc2', name: 'Laptop2', code: 'M5-N6', first_seen: now() - 20, joining_computer: 'laptop2' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#plus-ask-rows [data-ask="deny"][data-id="d-pc2"]', { timeout: 5000 }).catch(() => {});
      await page.click('#plus-ask-rows [data-ask="deny"][data-id="d-pc2"]');
      await page.waitForFunction(() => /Turned away\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const away = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/Turned away\. That computer, laptop2, was not let in/.test(away) && !/Laptop2/.test(away), `${tag} Not me on a computer names it as its sheet did`, away);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} no page errors`, JSON.stringify(errs));
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
