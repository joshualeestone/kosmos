// Browser-check-surface: d-dmthread d-reply d-say rxn-reply msg-replyto pj-replying data-jump-at
'use strict';

/**
 * Replying in a Direct Message (#4256, Josh 2026-09-27: "when will we get message replies ... on projects
 * and direct messages"). The room has had Reply since #3745; this is the same on the agent's own page.
 *
 *   R1  an agent's message offers Reply in its bar; the person's own rows have no bar
 *   R2  Reply puts "Replying to <agent>: <first line>" above the box, focuses the box, and the box is
 *       described by the strip
 *   R3  the send carries reply_to (the message's `at`); CONTROL: an ordinary send carries none
 *   R4  once the reply has gone, the strip goes
 *   R5  x stops replying
 *   R6  a reply in the thread carries a header naming what it answers, and the header jumps to it
 *   R7  a header whose original is not in the thread says so: "unavailable", or "further back" when
 *       older messages were not sent; never silence
 *   R8  phone: Reply in the tapped-open bar is a thumb-sized target
 *
 * Harness: loaded over file:// with fetch answered here (render-unread-edge-3743.js's posture), so the
 * DM goes through the real paintTalk and the real sendTalk.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dm-reply-4256.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const T0 = Date.parse('2026-09-27T14:00:00Z');
const at = (i) => new Date(T0 + i * 60000).toISOString();
const agentRow = (i, text) => ({ from: 'april', at: at(i), text });
const youRow = (i, text, extra) => ({ at: at(i), text, delivery: { state: 'placed', paneState: 'idle' }, ...(extra || {}) });

async function openDm(page, messages, olderCount) {
  await page.evaluate(([msgs, older]) => {
    window.__fx = { messages: msgs, olderCount: older || 0 };
    window.__posts = [];
    CURRENT = { sessionName: 'april', name: 'April' };
    LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  }, [messages, olderCount]);
  await page.evaluate(() => paintTalk('april', 'April'));
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => {
      window.setInterval = () => 0;   // no polls: the check paints when it chooses
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/thread') && init && init.method === 'POST') {
          const body = JSON.parse(init.body || '{}');
          window.__posts.push(body);
          window.__fx = { messages: window.__fx.messages.concat([{ at: new Date().toISOString(), text: body.text,
            delivery: { state: 'placed', paneState: 'idle' }, ...(body.reply_to ? { replyTo: body.reply_to } : {}) }]) };
          return enc({ delivery: { state: 'placed', at: new Date().toISOString() }, recorded: true });
        }
        if (u.includes('/thread')) return enc(window.__fx);
        return enc({});
      };
    });
    await page.goto(PAGE);
    await page.bringToFront();

    await openDm(page, [agentRow(1, 'Morning. I read the brief.'), youRow(2, 'Great'), agentRow(3, 'The login fix is done\nand tested on staging')]);

    // R1
    const bars = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg')].map((r) => ({
      you: r.classList.contains('you'), reply: !!r.querySelector('.rxn-reply') })));
    chk(bars.length === 3 && bars.filter((b) => !b.you).every((b) => b.reply) && bars.filter((b) => b.you).every((b) => !b.reply),
      'R1 each agent message offers Reply; the person\'s own rows have no bar', JSON.stringify(bars));

    // R2
    await page.hover('#d-dmthread .msg:not(.you) >> nth=1');
    await page.click('#d-dmthread .msg:not(.you) >> nth=1 >> .rxn-reply');
    const strip = await page.evaluate(() => {
      const el = document.getElementById('d-reply'); const say = document.getElementById('d-say');
      return { hidden: el.hidden, text: el.textContent.replace(/\s+/g, ' ').trim(), focused: document.activeElement === say,
        described: say.getAttribute('aria-describedby') };
    });
    chk(!strip.hidden && strip.text.startsWith('Replying to April: The login fix is done') && !strip.text.includes('staging'),
      'R2 Reply shows "Replying to April: <first line>" above the box', JSON.stringify(strip));
    chk(strip.focused && strip.described === 'd-reply-what', 'R2 the box has focus and is described by the strip', JSON.stringify(strip));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'dm-reply-strip.png') }); }

    // R3 + R4
    await page.fill('#d-say', 'Ship it');
    await page.click('#d-send');
    await page.waitForFunction(() => window.__posts.length === 1);
    await page.waitForTimeout(300);
    const sent = await page.evaluate(() => ({ post: window.__posts[0], hidden: document.getElementById('d-reply').hidden,
      described: document.getElementById('d-say').getAttribute('aria-describedby') }));
    chk(sent.post && sent.post.reply_to === at(3) && sent.post.text === 'Ship it', 'R3 the send carries reply_to, the answered message\'s at', JSON.stringify(sent.post));
    chk(sent.hidden && sent.described === null, 'R4 once the reply has gone, the strip goes', JSON.stringify(sent));
    await page.fill('#d-say', 'And one more');
    await page.click('#d-send');
    await page.waitForFunction(() => window.__posts.length === 2);
    const plain = await page.evaluate(() => window.__posts[1]);
    chk(plain && !('reply_to' in plain), 'R3 CONTROL: an ordinary send carries no reply_to', JSON.stringify(plain));

    // R6: the kept reply now carries a header naming what it answers, and it jumps there
    await page.waitForTimeout(300);
    const head = await page.evaluate(() => {
      const h = document.querySelector('#d-dmthread .msg.you .msg-replyto');
      return h ? { tag: h.tagName, text: h.textContent.replace(/\s+/g, ' ').trim(), jump: h.getAttribute('data-jump-at') } : null;
    });
    chk(head && head.tag === 'BUTTON' && head.text === 'April: The login fix is done' && head.jump === at(3),
      'R6 the reply carries a header naming the message it answers', JSON.stringify(head));
    await page.click('#d-dmthread .msg.you .msg-replyto');
    const jumped = await page.evaluate((want) => {
      const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.msg') : null;
      return { mid: row && row.getAttribute('data-mid'), flash: !!(row && row.classList.contains('msg-flash')), want };
    }, at(3));
    chk(jumped.mid === at(3) && jumped.flash, 'R6 the header jumps to the original and highlights it', JSON.stringify(jumped));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'dm-reply-header.png') });

    // R5: x stops replying
    await page.hover('#d-dmthread .msg:not(.you) >> nth=0');
    await page.click('#d-dmthread .msg:not(.you) >> nth=0 >> .rxn-reply');
    const on5 = await page.evaluate(() => !document.getElementById('d-reply').hidden);
    await page.click('#d-reply .pj-replying-x');
    const off5 = await page.evaluate(() => ({ hidden: document.getElementById('d-reply').hidden, focused: document.activeElement === document.getElementById('d-say') }));
    chk(on5 && off5.hidden && off5.focused, 'R5 x stops replying and puts the keyboard back in the box', JSON.stringify({ on5, ...off5 }));

    // R7: an original that is not in the thread is named, never silent
    await openDm(page, [agentRow(1, 'Hi'), youRow(2, 'About that', { replyTo: '2020-01-01T00:00:00.000Z' })], 0);
    const gone = await page.evaluate(() => { const h = document.querySelector('#d-dmthread .msg.you .msg-replyto'); return h ? { cls: h.className, text: h.textContent } : null; });
    await openDm(page, [agentRow(1, 'Hi'), youRow(2, 'About that', { replyTo: '2020-01-01T00:00:00.000Z' })], 40);
    const back = await page.evaluate(() => { const h = document.querySelector('#d-dmthread .msg.you .msg-replyto'); return h ? h.textContent : null; });
    chk(gone && /\bgone\b/.test(gone.cls) && gone.text === 'Original message unavailable' && back === 'Original message is further back',
      'R7 a missing original says unavailable, or further back when older messages were not sent', JSON.stringify({ gone, back }));

    // R8: phone, the tapped-open bar's Reply is a thumb-sized target
    const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const pp = await phone.newPage();
    await pp.addInitScript(() => {
      window.setInterval = () => 0;
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url) => (String(url).includes('/thread') ? enc(window.__fx) : enc({}));
    });
    await pp.goto(PAGE);
    const touch = await pp.evaluate(() => window.matchMedia('(hover: none)').matches);
    await pp.evaluate((msgs) => {   // the agent page opened the way a phone opens it (render-dm-tapreact-718.js's setup)
      window.__fx = { messages: msgs };
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true }];
      openDetail('april', 'talk');
    }, [agentRow(1, 'Hi there'), youRow(2, 'Hello')]);
    await pp.evaluate(() => paintTalk('april', 'April'));
    // The tap handler listens for click; dispatched on the bubble so a sticky composer over a one-message
    // thread in this harness cannot take the tap. What is measured is the real CSS on the opened bar.
    await pp.locator('#d-dmthread .msg:not(.you) .msg-bd').dispatchEvent('click');
    await pp.waitForTimeout(200);
    const tgt = await pp.evaluate(() => { const b = document.querySelector('#d-dmthread .msg.rxn-show .rxn-reply'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    chk(touch && tgt && tgt.w >= 36 && tgt.h >= 36, 'R8 on a phone, Reply in the tapped-open bar is at least 36px each way', JSON.stringify({ touch, tgt }));
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'dm-reply-phone.png') });
    await phone.close();

    chk(errs.length === 0, 'R9 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall dm-reply checks passed');
})();
