// Browser-check-surface: plus-waiting plus-waiting-title waitcodein plus-asks askcard
'use strict';
/**
 * kosmos#6590 (S-7d branch c, c1b): the browsers waiting to connect, on Settings > Kosmos+. A browser that opened this
 * computer's address waits there with a code on its own screen; the person types that code here. The real page and a
 * sandboxed board, with the remote routes answered per state, so a press is seen as the request it sends:
 *   T1  no marker (v2 false), and a remote session (403): nothing is drawn (the CONTROL for everything below);
 *   T2  two waiting: the section and its title, one row each with what the tunnel saw, a code field per row, and no
 *       code anywhere on the page (this computer never shows it);
 *   T3  Allow is reachable but aria-disabled short of six characters, and a press says why without sending anything;
 *   T4  a wrong code: the tunnel's sentence (tries left) under that row, and what was typed survives the next poll with
 *       focus kept in the field;
 *   T5  Enter presses Allow; the right code sends knockId and code and says Connected;
 *   T6  Not me sends drop with only the knockId, and says how to undo it; Clear waiting browsers sends clear;
 *   T7  the list could not be read: the sentence and Clear, and no rows;
 *   T8  away from Kosmos+, the compact notice names the waiting browsers;
 *   T6b a row the tunnel drops (five wrong codes) keeps its sentence as the note, with focus on it;
 *   T6c a 200 whose body does not read is never said as Connected;
 *   T10 away from Kosmos+, x puts away the waiting browsers it named and a new one brings the notice back;
 *   T9  no page errors.
 *
 *   HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-typed-allow-6590.js [shotsDir]
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-typedallow-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-typed-allow-6590: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const now = () => Math.floor(Date.now() / 1000);
const ADDR = 'josh1023-typed.kosmosplus.com';
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: ADDR } };
const K1 = 'AbCdEfGhIjKlMnOpQrStUv';
const K2 = '-bCdEfGhIjKlMnOpQrStUw';
const TWO = { v2: true, count: 2, ctAlarm: false, ctFinding: null, waiting: [
  { knockId: K1, firstSeen: now() - 90, uaClass: 'iPhone or iPad', net: '203.0.113.0', vouched: false },
  { knockId: K2, firstSeen: now() - 30, uaClass: 'Windows', net: '2001:db8:1::', vouched: false },
] };

async function open(browser, waitingAnswer, opts = {}) {
  const page = await browser.newPage({ viewport: opts.phone ? { width: 390, height: 844 } : { width: 1400, height: 950 }, colorScheme: opts.dark ? 'dark' : 'light' });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const posts = [];
  const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  const state = { answer: waitingAnswer, post: opts.post || (() => json({ ok: true })) };
  await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
  await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: [], email: 'you@example.com' })));
  await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, allowed: [], pending: [] })));
  await page.route('**/api/remote/waiting', (route) => { const a = state.answer(); route.fulfill(json(a.body, a.status || 200)); });
  await page.route('**/api/remote/waiting/*', (route, req) => {
    const verb = req.url().split('/').pop();
    let body = null;
    try { body = JSON.parse(req.postData() || '{}'); } catch { body = null; }
    posts.push({ verb, body });
    route.fulfill(state.post(verb, body));
  });
  const BASE = opts.base;
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  if (!opts.stayOff) {
    await page.evaluate(() => showTab('settings'));
    await page.click('#s-nav button[data-go="plus"]');
    await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
  }
  await page.evaluate(() => pollWaiting());
  await page.waitForTimeout(400);
  return { page, errs, posts, state };
}
const read = (page) => page.evaluate(() => {
  const vis = (el) => !!(el && !el.hidden && el.getBoundingClientRect().height > 0);
  const sec = document.getElementById('plus-waiting');
  return {
    shown: vis(sec) && vis(document.getElementById('plus-asks')),
    title: (document.getElementById('plus-waiting-title') || {}).textContent || '',
    rows: [...document.querySelectorAll('#plus-waiting .askreq')].map((r) => (r.innerText || '').replace(/\s+/g, ' ')),
    fields: document.querySelectorAll('#plus-waiting .waitcodein').length,
    text: ((sec && sec.innerText) || '').replace(/\s+/g, ' '),
    clear: !!document.querySelector('#plus-waiting [data-wait="clear"]'),
    codeBig: document.querySelectorAll('.askcodebig').length,
    pageText: document.body.innerText,
  };
});

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const allErrs = [];
  try {
    // T1: no marker (even with rows in the answer), a remote session's refusal, and a board older than this page (404:
    // no such route, review 1) draw nothing: no section, no notice away from Kosmos+, no nav dot, no notice keys.
    for (const [label, answer] of [['no marker, rows in the answer', () => ({ body: { ...TWO, v2: false } })],
      ['remote session (403)', () => ({ status: 403, body: { code: 'remote_not_allowed', error: 'x' } })],
      ['an older board (404)', () => ({ status: 404, body: { error: 'no such endpoint' } })]]) {
      const { page, errs } = await open(browser, answer, { base });
      const v = await read(page);
      chk(!v.shown && v.rows.length === 0 && !/Browsers waiting/.test(v.pageText), `T1 ${label}: nothing is drawn on Kosmos+`, JSON.stringify({ shown: v.shown, rows: v.rows.length }));
      allErrs.push(...errs);
      await page.close();
      const { page: off, errs: e2 } = await open(browser, answer, { base, stayOff: true });
      await off.evaluate(() => paintAsk());
      const o = await off.evaluate(() => ({ card: !document.getElementById('askcard').hidden, dot: !!document.querySelector('#s-nav button[data-go="plus"][data-dot]'),
        keys: (ASK.noteKeys || []).filter((k) => String(k).startsWith('knock:')).length }));
      chk(!o.card && !o.dot && o.keys === 0, `T1 ${label}: no notice, no nav dot, no notice keys away from Kosmos+`, JSON.stringify(o));
      // Inert means no extra repaint either: polls that change nothing never call paintAsk (CI's render-snav-head-4979).
      const paints = await off.evaluate(async () => {
        let n = 0; const real = window.paintAsk; window.paintAsk = (...a) => { n += 1; return real(...a); };
        try { await pollWaiting(); await pollWaiting(); } finally { window.paintAsk = real; }
        return n;
      });
      chk(paints === 0, `T1 ${label}: polls that change nothing repaint nothing`, 'paintAsk calls: ' + paints);
      allErrs.push(...e2);
      await off.close();
    }
    // T1b: the real route, unstubbed, answers this page (a same-origin GET carries no Origin) and says v2 false here.
    {
      const page = await browser.newPage();
      await page.goto(base, { waitUntil: 'networkidle' });
      const real = await page.evaluate(async () => { const r = await fetch('/api/remote/waiting', { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null) }; });
      chk(real.status === 200 && real.body && real.body.v2 === false, 'T1b the real route answers the page itself, v2 false with no marker', JSON.stringify(real));
      await page.close();
    }

    // T2-T6 against two waiting browsers.
    let tries = 0;
    const post = (verb, body) => {
      if (verb === 'allow') {
        tries += 1;
        if (body && body.code === 'GOOD-22') return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, allowed: true, device_id: 'd1', acked: true }) };
        return { status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That is not the code that browser shows. 4 more tries for it.', triesLeft: 4 }) };
      }
      return { status: 200, contentType: 'application/json', body: JSON.stringify(verb === 'drop' ? { ok: true, dropped: 1, allowed: false } : { ok: true, cleared: 2 }) };
    };
    const { page, errs, posts } = await open(browser, () => ({ body: TWO }), { base, post });
    let v = await read(page);
    chk(v.shown && /Browsers waiting to connect \(2\)/.test(v.title), 'T2 the section and its title, with the count', JSON.stringify({ shown: v.shown, title: v.title }));
    chk(v.rows.length === 2 && v.fields === 2, 'T2 one row and one code field per waiting browser', JSON.stringify(v.rows));
    chk(/It says it is: iPhone or iPad/.test(v.rows[0]) && /203\.0\.113\.0/.test(v.rows[0]) && /It says it is: Windows/.test(v.rows[1]), 'T2 each row says what the tunnel saw, the browser class as its own claim', JSON.stringify(v.rows));
    chk(v.rows.every((r) => /^A browser wants to connect/.test(r)) && v.rows.every((r) => r.includes(ADDR)), 'T2 the heading claims nothing, and the line names this computer\'s address', JSON.stringify(v.rows));
    chk(v.codeBig === 0 && !/[A-Z0-9]{3}-[A-Z0-9]{3}/.test(v.text.replace('ABC-DEF', '')), 'T2 no code is shown on this computer', v.text);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, '6590-waiting-two.png'), fullPage: false }); }

    // T3: short of six characters.
    const allow1 = `#plus-waiting [data-wait="allow"][data-id="${K1}"]`;
    chk(await page.getAttribute(allow1, 'aria-disabled') === 'true', 'T3 Allow is aria-disabled before a code is typed');
    await page.fill(`#waitcode-${K1}`, 'AB-C');
    // Playwright will not press an aria-disabled button; a person can (that is why it is aria-disabled, not disabled).
    await page.click(allow1, { force: true });
    await page.waitForTimeout(250);
    v = await read(page);
    chk(posts.length === 0 && /Type all six/.test(v.rows[0]), 'T3 a short press says why and sends nothing', JSON.stringify({ posts, row: v.rows[0] }));

    // T4: a wrong code.
    await page.fill(`#waitcode-${K1}`, 'ZZZ-ZZZ');
    chk(await page.getAttribute(allow1, 'aria-disabled') === null, 'T4 Allow wakes at six characters');
    await page.click(allow1);
    await page.waitForTimeout(500);
    v = await read(page);
    chk(posts.length === 1 && posts[0].verb === 'allow' && posts[0].body.knockId === K1 && posts[0].body.code === 'ZZZ-ZZZ', 'T4 Allow sends the knock id and the typed code', JSON.stringify(posts));
    chk(/4 more tries/.test(v.rows[0]), 'T4 the tunnel\'s sentence shows under that row', v.rows[0]);
    await page.focus(`#waitcode-${K1}`);
    await page.evaluate(() => { WAIT.typed[Object.keys(WAIT.typed)[0]] = 'ZZZ-ZZ'; document.querySelector('.waitcodein').value = 'ZZZ-ZZ'; });
    await page.evaluate(() => pollWaiting());
    await page.waitForTimeout(300);
    const kept = await page.evaluate((k) => ({ v: document.getElementById('waitcode-' + k).value, focus: document.activeElement && document.activeElement.id }), K1);
    chk(kept.v === 'ZZZ-ZZ' && kept.focus === 'waitcode-' + K1, 'T4 what was typed survives a poll, with focus kept', JSON.stringify(kept));
    const aria = await page.evaluate((k) => { const f = document.getElementById('waitcode-' + k); return { inv: f.getAttribute('aria-invalid'), desc: (f.getAttribute('aria-describedby') || '').split(' ').map((x) => (document.getElementById(x) || {}).textContent || '').join(' | ') }; }, K1);
    chk(aria.inv === 'true' && /4 more tries/.test(aria.desc), 'T4 the field is marked invalid and described by the answer', JSON.stringify(aria));

    // T5: Enter, the right code.
    await page.fill(`#waitcode-${K1}`, 'GOOD-22');
    await page.press(`#waitcode-${K1}`, 'Enter');
    await page.waitForTimeout(500);
    v = await read(page);
    chk(posts.length === 2 && posts[1].body.code === 'GOOD-22', 'T5 Enter presses Allow', JSON.stringify(posts[1]));
    chk(/Connected/.test(v.text), 'T5 an allowed browser says Connected', v.text);

    // T6: Not me, then Clear.
    await page.click(`#plus-waiting [data-wait="drop"][data-id="${K2}"]`);
    await page.waitForTimeout(400);
    v = await read(page);
    chk(posts[2] && posts[2].verb === 'drop' && JSON.stringify(posts[2].body) === JSON.stringify({ knockId: K2 }), 'T6 Not me sends only the knock id', JSON.stringify(posts[2]));
    chk(/Turned away for today/.test(v.text) && /Clear waiting browsers/.test(v.text), 'T6 Not me says how to undo it', v.text);
    await page.click('#plus-waiting [data-wait="clear"]');
    await page.waitForTimeout(400);
    chk(posts[3] && posts[3].verb === 'clear', 'T6 Clear waiting browsers sends clear', JSON.stringify(posts[3]));
    allErrs.push(...errs);
    await page.close();

    // T6b: the fifth wrong code deletes the row in the tunnel; its sentence moves to the note and focus goes there (review 1).
    {
      let gone = false;
      const answer = () => ({ body: gone ? { ...TWO, count: 1, waiting: [TWO.waiting[1]] } : TWO });
      const post = () => { gone = true; return { status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That is not the code, and that browser has had too many tries. Ask it to sign in again for a new code.', triesLeft: 0 }) }; };
      const { page: p6, errs: e6 } = await open(browser, answer, { base, post });
      await p6.fill(`#waitcode-${K1}`, 'ZZZ-ZZZ');
      await p6.click(`#plus-waiting [data-wait="allow"][data-id="${K1}"]`);
      await p6.waitForTimeout(500);
      const r6 = await p6.evaluate(() => ({ text: (document.getElementById('plus-waiting').innerText || '').replace(/\s+/g, ' '), focus: document.activeElement && document.activeElement.id, rows: document.querySelectorAll('#plus-waiting .askreq').length }));
      chk(r6.rows === 1 && /too many tries/.test(r6.text) && r6.focus === 'plus-waiting-note', 'T6b a row dropped by the tunnel keeps its sentence, as the note, with focus on it', JSON.stringify(r6));
      allErrs.push(...e6);
      await p6.close();
    }

    // T6c: a 200 whose body is not the board's answer is not "Connected" (review 1).
    {
      const post = () => ({ status: 200, contentType: 'text/html', body: '<html>proxy page</html>' });
      const { page: pc, errs: ec } = await open(browser, () => ({ body: TWO }), { base, post });
      await pc.fill(`#waitcode-${K1}`, 'GOOD-22');
      await pc.click(`#plus-waiting [data-wait="allow"][data-id="${K1}"]`);
      await pc.waitForTimeout(500);
      const tc = await pc.evaluate(() => (document.getElementById('plus-waiting').innerText || '').replace(/\s+/g, ' '));
      chk(!/Connected/.test(tc) && /could not save that/i.test(tc), 'T6c an answer that does not read is never said as Connected', tc);
      allErrs.push(...ec);
      await pc.close();
    }

    // T10: away from Kosmos+, x puts away exactly the waiting browsers it named; a new one brings the notice back.
    {
      let rows = TWO;
      const { page: p10, errs: e10 } = await open(browser, () => ({ body: rows }), { base, stayOff: true });
      await p10.evaluate(() => paintAsk());
      await p10.click('#askcard [data-ask="note-dismiss"]');
      await p10.waitForTimeout(200);
      const hid = await p10.evaluate(() => document.getElementById('askcard').hidden);
      rows = { ...TWO, count: 3, waiting: TWO.waiting.concat([{ knockId: 'ZbCdEfGhIjKlMnOpQrStUx', firstSeen: now(), uaClass: 'Android', net: '198.51.100.0', vouched: false }]) };
      await p10.evaluate(() => pollWaiting());
      await p10.waitForTimeout(300);
      const back = await p10.evaluate(() => ({ shown: !document.getElementById('askcard').hidden, text: (document.getElementById('askcard').innerText || '').replace(/\s+/g, ' ') }));
      chk(hid && back.shown && /A browser wants to connect/.test(back.text), 'T10 dismissed, then a new waiting browser brings the notice back naming only it', JSON.stringify({ hid, back }));
      allErrs.push(...e10);
      await p10.close();
    }

    // T7: the list could not be read.
    {
      const { page: p7, errs: e7 } = await open(browser, () => ({ status: 500, body: { error: 'the waiting browsers could not be read', v2: true } }), { base });
      const v7 = await read(p7);
      chk(v7.shown && /could not be read/.test(v7.text) && v7.clear && v7.rows.length === 0, 'T7 an unreadable list says so, with Clear and no rows', JSON.stringify({ shown: v7.shown, text: v7.text }));
      allErrs.push(...e7);
      await p7.close();
    }

    // T8: away from Kosmos+, the compact notice.
    {
      const { page: p8, errs: e8 } = await open(browser, () => ({ body: TWO }), { base, stayOff: true });
      await p8.evaluate(() => paintAsk());
      await p8.waitForTimeout(200);
      const note = await p8.evaluate(() => { const c = document.getElementById('askcard'); return { shown: !!(c && !c.hidden), text: ((c && c.innerText) || '').replace(/\s+/g, ' ') }; });
      chk(note.shown && /2 browsers want to connect/.test(note.text), 'T8 the compact notice names the waiting browsers', JSON.stringify(note));
      allErrs.push(...e8);
      await p8.close();
    }

    // Shots for design review: light and dark, desktop and phone.
    if (SHOTS) {
      for (const [dark, phone] of [[false, false], [true, false], [false, true], [true, true]]) {
        const { page: ps, errs: es } = await open(browser, () => ({ body: TWO }), { base, dark, phone });
        await ps.evaluate(() => { const el = document.getElementById('plus-waiting'); if (el) el.scrollIntoView({ block: 'start' }); });
        await ps.screenshot({ path: path.join(SHOTS, `6590-waiting-${phone ? 'phone' : 'desktop'}-${dark ? 'dark' : 'light'}.png`) });
        allErrs.push(...es);
        await ps.close();
      }
    }
    chk(allErrs.length === 0, 'T9 no page errors', allErrs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.error('render-typed-allow-6590: ' + fail.length + ' check(s) failed'); process.exit(1); }
  console.log('render-typed-allow-6590: the waiting browsers read and behave as designed.');
})().catch((err) => {
  console.error('FAIL  render-typed-allow-6590: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
