'use strict';

/**
 * Message line spacing is 1.6 (Josh, 2026-11-06 18:04, relayed by Splinter: "yes 1.6").
 * It was 1.55. The rule is `.msg p` in web/index.html, which is how the PROJECT ROOM
 * draws a message (pjRoomRow wraps its words in <p>, into #pj-room).
 *
 * ⚠️ NOT the agent conversation. dmRow puts its words straight into .msg-bd with no <p>,
 * so the agent chat takes the body font (13px/16px, about 1.23) and this rule never
 * reaches it. The picture Josh picked from labelled both threads 1.55, which was true
 * only of the room; that is reported to Splinter and the agent chat is a separate call.
 * Nor a message from outside Kosmos in a shared project (`.msg.ext`, words in
 * `.msg-ext-tx`, no <p>), also 13px/16px, before and after this change.
 * This check PRINTS the agent chat's measured text size and spacing as INFO, whichever
 * way it is drawn, so a later change to it shows in the log; it asserts nothing about it.
 *
 * WHAT IT MEASURES. A real row from each thread's own row builder, placed in that
 * thread's own container, so any rule scoped to one thread would show. For the
 * message paragraph it reads the computed line-height and font-size (both px) and
 * asserts their ratio is 1.6; then it measures a paragraph that wraps to several lines
 * and asserts its height divided by its line count is 1.6 times the font size, so the
 * value is what is DRAWN and not only what is declared. Light and dark.
 *
 * CONTROL. On the page before this change the ratio is 1.55 (23.25px per line), and
 * both the ratio arm (tolerance 0.01) and the drawn arm (tolerance 0.5px) red.
 *
 * Not covered: the hint and note lines that also say 1.55 (.dhint, .usage-method),
 * which are not message threads and were left alone on purpose. The iPhone app sets
 * no line spacing of its own on message text (git grep lineSpacing ios/ found none),
 * so it is not part of this change.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-msg-linespacing-1106.js
 */
const path = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-msg-linespacing-1106: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
const WANT = 1.6;

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const LONG = 'This message is long enough to wrap onto several lines in a narrow thread, '
  + 'so the height of the paragraph can be divided by its number of lines and compared '
  + 'with the line spacing the page asks for. It keeps going for a while longer here.';

(async () => {
  if (!ENGINES.length) { console.error('FAIL  no known engine in ENGINES=' + process.env.ENGINES); process.exit(1); }
  for (const engine of ENGINES) {
    const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
    try {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
        const errs = [];
        page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
        await page.addInitScript(() => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0;
          window.fetch = async () => enc({});
        });
        await page.goto(PAGE);
        const r = await page.evaluate((LONG) => {
          const out = {};
          const show = (el) => {
            for (let n = el; n && n !== document.body; n = n.parentElement) {
              n.hidden = false; n.inert = false;
              if (getComputedStyle(n).display === 'none') n.style.display = 'block';
            }
          };
          const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
          const measure = (host, html) => {
            if (!host) return { error: 'no container' };
            show(host);
            host.style.width = '420px';
            host.innerHTML = html;
            const p = host.querySelector('.msg p');
            const bd = host.querySelector('.msg-bd');
            const bc = bd && getComputedStyle(bd);
            const words = p ? 'a <p>' : 'no <p>, the words sit in .msg-bd';
            if (!p) return { error: 'no .msg p in the row', how: words, text: bc ? bc.fontSize + ' / ' + bc.lineHeight : 'no .msg-bd' };
            const cs = getComputedStyle(p);
            const lh = parseFloat(cs.lineHeight); const fs = parseFloat(cs.fontSize);
            const h = p.getBoundingClientRect().height;
            const lines = Math.round(h / lh);
            return { lh, fs, ratio: lh / fs, h, lines, drawn: lines ? h / lines : 0, how: words, text: cs.fontSize + ' / ' + cs.lineHeight };
          };
          const msg = { from: 'April', at: new Date().toISOString(), text: LONG };
          out.dm = typeof dmRow === 'function'
            ? measure(document.getElementById('d-dmthread'), dmRow(msg, 'April'))
            : { error: 'dmRow is not a function' };
          out.room = typeof pjRoomRow === 'function'
            ? measure(document.getElementById('pj-room'), pjRoomRow(msg, { id: 'fleet', members: [] }))
            : { error: 'pjRoomRow is not a function' };
          return out;
        }, LONG);
        const t = `[${engine} ${theme}]`;
        { const d = r.dm;   // the agent chat: printed, never asserted (see the header)
          console.log(`INFO  ${t} agent conversation (not changed here): ${d.how || d.error}, text ${d.text || '?'}`); }
        const m = r.room;
        if (m.error) chk(false, `${t} project room: a message paragraph rendered`, m.error + ' (' + m.how + ')');
        else {
          chk(Math.abs(m.ratio - WANT) <= 0.01, `${t} project room: line spacing is ${WANT}`,
            `line-height=${m.lh}px font-size=${m.fs}px ratio=${m.ratio.toFixed(3)}`);
          chk(m.lines >= 3, `${t} project room: the test paragraph wraps to several lines`, `lines=${m.lines}`);
          chk(Math.abs(m.drawn - WANT * m.fs) <= 0.5, `${t} project room: each drawn line is ${WANT} times the text size`,
            `height=${m.h.toFixed(2)} lines=${m.lines} per-line=${m.drawn.toFixed(2)} want=${(WANT * m.fs).toFixed(2)}`);
        }
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
