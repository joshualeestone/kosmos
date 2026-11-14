// Browser-check-surface: conn-found conn-found-list cf-svc cf-acts s-sec-connect
'use strict';
/**
 * kosmos#8519: Settings > Connections ends with "What your agents found": which actions worked, or were refused, when
 * an agent used a service, read from GET /api/connections/found (the disk only).
 *
 * Asserted in light and dark, at a desktop and a phone width, with two services found (one Kosmos connection, one
 * plugin used outside Kosmos):
 *   - the box is shown, after the Connections box, with Kosmos's own connections first, then the outside ones;
 *   - each service's fold says how many actions do not work, and opens to one row per action: the action, the
 *     outcome in words, and who found it and when;
 *   - a row fits the width with nothing scrolling sideways, a long action name included;
 *   - the outcome words and the who-and-when line keep 4.5:1 against the page;
 *   - an action or note that holds markup is shown as text, never run as markup.
 * CONTROLS: with nothing found the box stays hidden, and so it does when the read fails; so "shown" is the data's
 * doing, not a box that always shows.
 *
 * file://, like render-conn-ask-4451.js; the board's answer is stood in for by wrapping fetch for that one route.
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-conn-found-8519.js
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const fail = [];
let ran = 0;
const chk = (ok, label, extra) => { ran += 1; console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

function parse(c) {
  const s = String(c);
  const cm = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (cm) return { r: +cm[1] * 255, g: +cm[2] * 255, b: +cm[3] * 255, a: cm[4] === undefined ? 1 : +cm[4] };
  const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum({ r, g, b }) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function over(top, under) { const a = top.a; return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }; }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const NOW = Date.now();
const FOUND = { services: [
  { key: 'github', name: 'GitHub', kind: 'kosmos', notWorking: 1, actions: [
    { action: 'create release', outcome: 'needs-scope', words: 'Needs a wider sign-in', at: NOW - 3 * 3600e3, by: 'leo', note: 'the token cannot write contents', how: 'agent', n: 1 },
    { action: 'open pull request', outcome: 'works', words: 'Works', at: NOW - 3600e3, by: 'mara', note: '', how: 'agent', n: 1 }] },
  { key: 'hubspot', name: 'hubspot', kind: 'other', notWorking: 2, actions: [
    { action: 'crm_merge_contacts_across_every_associated_company_record', outcome: 'not-offered', words: 'The service does not offer this', at: NOW - 600e3, by: 'leo', note: '', how: 'auto', n: 3 },
    { action: '<b>x</b>', outcome: 'needs-permission', words: 'The account is not allowed to do this', at: NOW - 120e3, by: 'mara', note: '<img src=x onerror=window.__pwned=1>', how: 'agent', n: 1 }] },
] };

async function open(browser, w, h, theme, answer) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  await ctx.addInitScript((a) => {
    const real = window.fetch.bind(window);
    window.fetch = (u, o) => {
      if (String(u).includes('/api/connections/found')) {
        if (a === 'fail') return Promise.reject(new Error('down'));
        return Promise.resolve(new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return real(u, o);
    };
  }, answer);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    showTab('settings');
    settingsOpen('connect');
  });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      for (const theme of ['light', 'dark']) {
        const t = `[${w}x${h} ${theme}]`;
        const { ctx, page, errs } = await open(browser, w, h, theme, FOUND);
        const m = await page.evaluate(() => {
          const box = document.getElementById('conn-found');
          if (!box) return { missing: true };
          const conn = document.querySelector('#s-sec-connect > .dbox');
          return { missing: false, shown: !box.hidden && box.getBoundingClientRect().height > 0,
            afterConn: !!conn && !!(conn.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING),
            groups: [...box.querySelectorAll('h4.con-group')].map((x) => x.textContent),
            rows: [...box.querySelectorAll('details.cf-svc > summary')].map((s) => s.querySelector('b').textContent + ' | ' + s.querySelector('.con-state').textContent) };
        });
        chk(!m.missing && m.shown, `${t} the box is shown when agents found something`, JSON.stringify(m));
        if (m.missing) { await ctx.close(); continue; }
        chk(m.afterConn, `${t} it sits after the Connections box`);
        chk(JSON.stringify(m.groups) === '["Connections in Kosmos","Services your agents use outside Kosmos"]', `${t} Kosmos's own first, then the outside ones`, JSON.stringify(m.groups));
        chk(JSON.stringify(m.rows) === '["GitHub | 1 action does not work","hubspot | 2 actions do not work"]', `${t} each fold says how many do not work`, JSON.stringify(m.rows));
        await page.evaluate(() => document.querySelectorAll('#conn-found details.cf-svc').forEach((d) => { d.open = true; }));
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => {
          const lis = [...document.querySelectorAll('#conn-found .cf-acts li')];
          const box = document.getElementById('conn-found');
          let under = null;
          for (let a = box; a; a = a.parentElement) {
            const b = getComputedStyle(a).backgroundColor;
            if (b && !/rgba\([^)]*,\s*0\)$/.test(b) && !/\/\s*0\)$/.test(b) && b !== 'transparent') { under = b; break; }
          }
          const words = document.querySelector('#conn-found .cf-words:not(.cf-ok)');
          const meta = document.querySelector('#conn-found .cf-meta');
          return { n: lis.length,
            first: lis[0] && [lis[0].querySelector('.cf-act').textContent, lis[0].querySelector('.cf-words').textContent, lis[0].querySelector('.cf-meta').textContent],
            auto: lis.map((l) => l.querySelector('.cf-meta').textContent).find((x) => x.startsWith('Seen on a refused call')) || null,
            overflow: lis.filter((l) => { const R = l.getBoundingClientRect(); return R.right > innerWidth + 0.5 || l.scrollWidth > l.clientWidth + 1; }).length,
            pageScroll: document.documentElement.scrollWidth > innerWidth + 1,
            markup: !!document.querySelector('#conn-found .cf-acts b, #conn-found .cf-acts img'),
            literal: lis.some((l) => l.querySelector('.cf-act').textContent === '<b>x</b>'),
            pwned: window.__pwned === 1,
            under, words: words && getComputedStyle(words).color, meta: meta && getComputedStyle(meta).color };
        });
        chk(r.n === 4, `${t} one row per action`, String(r.n));
        chk(JSON.stringify(r.first) === JSON.stringify(['create release', 'Needs a wider sign-in', r.first && r.first[2]]) && /^Recorded by leo, 3 hours ago\. The token cannot write contents$/.test(r.first[2]),
          `${t} a row says the action, the outcome in words, and who found it and when`, JSON.stringify(r.first));
        chk(!!r.auto && /^Seen on a refused call by leo, 10 minutes ago, 3 times$/.test(r.auto), `${t} an automatic finding says it was seen on a refused call`, JSON.stringify(r.auto));
        chk(r.overflow === 0 && !r.pageScroll, `${t} every row fits, nothing scrolls sideways`, JSON.stringify({ overflow: r.overflow, pageScroll: r.pageScroll }));
        chk(!r.markup && r.literal && !r.pwned, `${t} markup in an action or note is shown as text`, JSON.stringify({ markup: r.markup, literal: r.literal, pwned: r.pwned }));
        const under = parse(r.under);
        for (const [k, c] of [['outcome words', r.words], ['who-and-when line', r.meta]]) {
          const ink = parse(c);
          if (ink && under) { const x = contrast(over(ink, under), under); chk(x >= 4.5, `${t} the ${k} keep 4.5:1 (${x.toFixed(2)}:1)`); }
          else chk(false, `${t} ${k} colours readable`, JSON.stringify({ c, under: r.under }));
        }
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `conn-found-${w}-${theme}.png`), fullPage: true });
        await ctx.close();
      }
    }
    // CONTROLS: nothing found, and a failed read, both leave the box hidden.
    for (const [label, answer] of [['nothing found', { services: [] }], ['the read failed', 'fail']]) {
      const { ctx, page, errs } = await open(browser, 1280, 900, 'light', answer);
      const hidden = await page.evaluate(() => { const b = document.getElementById('conn-found'); return !!b && b.hidden; });
      chk(hidden, `CONTROL: ${label}, the box stays hidden`);
      chk(errs.length === 0, `CONTROL: ${label}, no page errors`, errs.join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fail.length ? `\n${fail.length} of ${ran} FAILED` : `\nall ${ran} passed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
