'use strict';

/*
 * #4375: the owner's industry picker in Settings > Automation > Community ("Works for a law firm" on the
 * agents' public profiles). Optional, from the board's fixed list, never free text.
 *
 * Every /api/community-industry request is answered at the browser (page.route) except DEFAULT's GET, so
 * the check writes nothing and each arm sees exactly the state it names:
 *   DEFAULT     the board's own read (a sandboxed board has none set): the picker shows under the switch,
 *               labelled, reads None, offers None plus the board's 16 industries, and opening wrote nothing.
 *   COPY        the switch's explanation says profiles show the business picked below.
 *   SET         a read of "legal" selects "A law firm".
 *   UNREADABLE  ok:false shows NO industry as chosen ("Could not be read just now", not pickable), says so,
 *               and keeps None pickable: a privacy control never shows a position it does not know.
 *   403         a gated read draws the same could-not-read, never a false None.
 *   CHANGE      picking an industry PUTs exactly { industry: <key> } once and paints the answer.
 *   CLEAR       picking None PUTs { industry: null }.
 *   CHANGE-FAIL a refused save says so in the picker's own line and reads the board again.
 *   PENDING     a second choice made while the first save is out is saved after it, never alongside it, and the
 *               board ends up storing it (arrow keys on a closed select fire a change per step).
 *   FAIL-BOTH   a refused save stays said when the re-read after it fails too.
 * DEFAULT is also the control for the others: it proves the picker is found and read.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-industry-4375.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const ROUTE = '**/api/community-industry';
const LIST = [
  ['accounting', 'an accounting practice'], ['legal', 'a law firm'], ['consulting', 'a consultancy'],
  ['marketing-agency', 'a marketing agency'], ['software', 'a software company'], ['ecommerce-retail', 'an online or retail shop'],
  ['real-estate', 'a real estate business'], ['healthcare', 'a healthcare practice'], ['education', 'an education business'],
  ['construction-trades', 'a construction or trades business'], ['manufacturing', 'a manufacturer'],
  ['hospitality-food', 'a hospitality or food business'], ['logistics', 'a logistics business'],
  ['media-creative', 'a media or creative studio'], ['nonprofit', 'a nonprofit'], ['other', 'a business'],
].map(([key, label]) => ({ key, label, display: label.charAt(0).toUpperCase() + label.slice(1) }));   // as the board sends it

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

/* Load the page and wait until its own script is running (not networkidle: the page polls the board). */
async function load(pg) {
  await pg.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await pg.waitForFunction(() => typeof showTab === 'function' && typeof industryPaint === 'function', null, { timeout: 30000 });
  await pg.waitForSelector('#boot-cover', { state: 'hidden', timeout: 60000 });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
}

// Open Settings > Automation once the picker has been painted from the board's answer.
async function openAutomation(pg) {
  await load(pg);
  await pg.waitForFunction(() => { const s = document.getElementById('community-industry'); return s && !s.hidden && s.options.length > 0; }, null, { timeout: 30000 });
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(400);
}

function readPicker(pg) {
  return pg.evaluate(() => {
    const sel = document.getElementById('community-industry');
    const row = document.getElementById('community-row');
    const share = document.getElementById('community-share');
    const label = sel && sel.labels && sel.labels[0];
    const box = sel && sel.getBoundingClientRect();
    const rbox = row && row.getBoundingClientRect();
    const sbox = share && share.getBoundingClientRect();
    return {
      found: Boolean(sel),
      shown: Boolean(box && box.width > 0 && box.height > 0),
      order: Boolean(box && rbox && sbox && box.top > rbox.bottom && box.bottom <= sbox.top + 1),
      label: label ? label.textContent.trim() : '',
      value: sel ? sel.value : null,
      selectedText: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
      selectedDisabled: Boolean(sel && sel.selectedOptions[0] && sel.selectedOptions[0].disabled),
      options: sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })) : [],
      msg: (document.getElementById('community-industry-msg') || {}).textContent || '',
      hint: ((document.getElementById('community-row') || {}).querySelector ? document.getElementById('community-row').querySelector('p.dhint').textContent : ''),
    };
  });
}

const body = (industry, ok = true) => ({ industry, ok, industries: LIST });
const answer = (b, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = () => browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    // DEFAULT: the board's own read. GET only; a PUT here would be a write, so it is refused and counted.
    const p1 = await page();
    let wrote = false;
    await p1.route(ROUTE, (route) => { if (route.request().method() === 'GET') return route.continue(); wrote = true; return route.abort(); });
    await openAutomation(p1);
    const d = await readPicker(p1);
    check('DEFAULT: the industry picker exists', d.found, JSON.stringify(d.found));
    check('DEFAULT: it is visible, between the switch and the share line', d.shown && d.order, JSON.stringify({ shown: d.shown, order: d.order }));
    check('DEFAULT: it is labelled for what it does', /public profiles/.test(d.label), JSON.stringify(d.label));
    check('DEFAULT: none picked reads None', d.value === '' && /^None/.test(d.selectedText), JSON.stringify([d.value, d.selectedText]));
    check('DEFAULT: it offers None and exactly the board\'s 16 industries, capitalised', d.options.length === 17 && d.options[0].value === ''
      && d.options.slice(1).every((o, i) => o.value === LIST[i].key && o.text === LIST[i].label.charAt(0).toUpperCase() + LIST[i].label.slice(1)), JSON.stringify(d.options.slice(0, 3)));
    check('DEFAULT: opening the page wrote nothing', wrote === false);
    check('COPY: the switch says profiles show the business picked below', /public profiles also show the kind of business you pick below/.test(d.hint), JSON.stringify(d.hint));
    await p1.close();

    // SET: the board's answer selects it.
    const p2 = await page();
    await p2.route(ROUTE, answer(body('legal')));
    await openAutomation(p2);
    const s = await readPicker(p2);
    check('SET: a read of legal selects "A law firm"', s.value === 'legal' && s.selectedText === 'A law firm', JSON.stringify([s.value, s.selectedText]));
    check('SET: nothing says it could not be read', s.msg === '', JSON.stringify(s.msg));
    await p2.close();

    // UNREADABLE and 403: no industry shown as chosen, None still pickable.
    for (const [name, route] of [['UNREADABLE', answer(body(null, false))], ['403', answer({ error: 'this board belongs to the account that started it' }, 403)]]) {
      const pu = await page();
      await pu.route(ROUTE, route);
      await openAutomation(pu);
      const u = await readPicker(pu);
      check(name + ': the chosen option says it could not be read, and cannot be picked', /Could not be read/.test(u.selectedText) && u.selectedDisabled, JSON.stringify([u.selectedText, u.selectedDisabled]));
      check(name + ': no industry and not None is shown as chosen', u.value === '__unknown', JSON.stringify(u.value));
      check(name + ': None is still offered, so the person can clear it', u.options.some((o) => o.value === '' && !o.disabled), JSON.stringify(u.options.slice(0, 2)));
      if (name === 'UNREADABLE') {
        // The board's answer carries the list even for a corrupt setting, so "Pick one" is true there.
        check(name + ': every industry is still offered (the list comes with the answer)', u.options.filter((o) => !o.disabled && o.value && o.value !== '__unknown').length === 16, String(u.options.length));
      }
      check(name + ': the picker\'s line says so', /could not read which business/.test(u.msg), JSON.stringify(u.msg));
      // With the list (a readable board answer) any choice sets it again; without it (a 403 on first load) only None.
      // With the list any choice can set it again; without it (a 403 on first load: the save is refused too) it promises nothing.
      check(name + ': the line promises only what can work', name === 'UNREADABLE' ? /Pick one, or None/.test(u.msg) : /Try again in a moment\.$/.test(u.msg), JSON.stringify(u.msg));
      await pu.close();
    }

    // CHANGE, then CLEAR: one PUT each, exactly the key or null, painted from the answer.
    const p4 = await page();
    const puts = [];
    let current = null;
    await p4.route(ROUTE, (route) => {
      if (route.request().method() === 'PUT') { const b = JSON.parse(route.request().postData() || '{}'); puts.push(b); current = b.industry; }
      return answer(body(current))(route);
    });
    await openAutomation(p4);
    await p4.selectOption('#community-industry', 'software');
    await p4.waitForTimeout(500);
    const c = await readPicker(p4);
    check('CHANGE: one PUT with exactly { industry: "software" }', puts.length === 1 && JSON.stringify(puts[0]) === '{"industry":"software"}', JSON.stringify(puts));
    check('CHANGE: the answer is painted and the save is said, true whatever the switch reads', c.value === 'software' && /^Saved\. While Community is on, your agents. public profiles show it\.$/.test(c.msg), JSON.stringify([c.value, c.msg]));
    await p4.selectOption('#community-industry', '');
    await p4.waitForTimeout(500);
    const cl = await readPicker(p4);
    check('CLEAR: None PUTs { industry: null }', puts.length === 2 && JSON.stringify(puts[1]) === '{"industry":null}', JSON.stringify(puts));
    check('CLEAR: it reads None and says Kosmos takes it off the profiles even with Community off', cl.value === '' && /^Saved\. Kosmos takes it off your agents. public profiles, even with Community off\.$/.test(cl.msg), JSON.stringify([cl.value, cl.msg]));
    await p4.close();

    // CHANGE-FAIL: a refused save says so and reads the board again.
    const p5 = await page();
    let gets = 0;
    await p5.route(ROUTE, (route) => {
      if (route.request().method() === 'PUT') return answer({ error: 'we could not save that setting' }, 400)(route);
      gets++;
      return answer(body('legal'))(route);
    });
    await openAutomation(p5);
    const before = gets;
    await p5.selectOption('#community-industry', 'software');
    await p5.waitForTimeout(600);
    const f = await readPicker(p5);
    check('CHANGE-FAIL: the refusal is said in the picker\'s line', /could not save/.test(f.msg), JSON.stringify(f.msg));
    check('CHANGE-FAIL: the board is read again and its value shown', gets > before && f.value === 'legal', JSON.stringify({ gets, before, value: f.value }));
    await p5.close();

    // PENDING: the first save is slow; a second choice made meanwhile is saved after it, not dropped.
    const p6 = await page();
    const order = [];
    let cur6 = null;
    let inFlight = 0;
    let maxInFlight = 0;
    await p6.route(ROUTE, async (route) => {
      if (route.request().method() === 'PUT') {
        const b = JSON.parse(route.request().postData() || '{}');
        order.push(b.industry);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        if (order.length === 1) await new Promise((res) => setTimeout(res, 800));
        cur6 = b.industry;                              // what the board STORED, in the order saves finished
        inFlight--;
      }
      return answer(body(cur6))(route);
    });
    await openAutomation(p6);
    await p6.evaluate(() => {
      const sel = document.getElementById('community-industry');
      sel.value = 'accounting'; sel.dispatchEvent(new Event('change'));
      sel.value = 'legal'; sel.dispatchEvent(new Event('change'));
    });
    await p6.waitForTimeout(2000);
    const pe = await readPicker(p6);
    check('PENDING: the choice made during a save is saved after it, last', order.length >= 2 && order[order.length - 1] === 'legal', JSON.stringify(order));
    check('PENDING: the picker ends on the last choice', pe.value === 'legal', JSON.stringify(pe.value));
    check('PENDING: the board ends up STORING the last choice (no slow first save lands after it)', cur6 === 'legal', JSON.stringify(cur6));
    check('PENDING: saves never overlap', maxInFlight === 1, String(maxInFlight));
    await p6.close();

    // FAIL-BOTH: the save fails and so does the re-read (the board went away): the refusal stays on screen.
    const p7 = await page();
    let broken = false;
    let brokenGets = 0;
    await p7.route(ROUTE, (route) => {
      if (!broken) return answer(body('legal'))(route);
      if (route.request().method() === 'PUT') return answer({ error: 'we could not save that setting' }, 500)(route);
      brokenGets++;
      return answer({ error: 'no' }, 403)(route);
    });
    await openAutomation(p7);
    broken = true;
    await p7.selectOption('#community-industry', 'software');
    await p7.waitForTimeout(700);
    const fb = await readPicker(p7);
    check('FAIL-BOTH: a failed save stays said when the re-read fails too', /could not save/.test(fb.msg), JSON.stringify(fb.msg));
    check('FAIL-BOTH: the board was read again, and the unsaved choice is not shown as the position', brokenGets >= 1 && fb.value === '__unknown', JSON.stringify({ brokenGets, value: fb.value }));
    await p7.close();

    // CLEAR-UNREACHABLE: taking it off says which profiles it cannot reach (an agent the community shut out).
    const p8 = await page();
    await p8.route(ROUTE, (route) => answer({ ...body(route.request().method() === 'PUT' ? null : 'legal'), unreachable: 1 })(route));
    await openAutomation(p8);
    await p8.selectOption('#community-industry', '');
    await p8.waitForTimeout(500);
    const ur = await readPicker(p8);
    check('CLEAR-UNREACHABLE: the save names the one profile Kosmos can no longer change', /except 1 agent the community has shut out/.test(ur.msg), JSON.stringify(ur.msg));
    await p8.close();

    // CLEAR-CANNOT-SEND: when the send layer cannot run at all (unreachable: null) the clear promises nothing now.
    const p9 = await page();
    await p9.route(ROUTE, (route) => answer({ ...body(route.request().method() === 'PUT' ? null : 'legal'), unreachable: null })(route));
    await openAutomation(p9);
    await p9.selectOption('#community-industry', '');
    await p9.waitForTimeout(500);
    const cs9 = await readPicker(p9);
    check('CLEAR-CANNOT-SEND: with nothing able to send, it says it comes off once Kosmos can send again', /^Saved\. Kosmos takes it off your agents. public profiles once it can send to the community again\.$/.test(cs9.msg), JSON.stringify(cs9.msg));
    await p9.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-community-industry-4375: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-community-industry-4375 threw: ' + (e && e.message || e)); process.exit(1); });
