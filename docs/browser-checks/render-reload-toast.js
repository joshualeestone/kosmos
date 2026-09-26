'use strict';

/**
 * The update chip in both of its states (#3955, Mona Lisa's mock A and B: "An update is available"
 * and "Reload to finish updating", one gold action each), in light and dark, and the "Kosmos has been
 * updated" window (tiles, contrast, focus, Tab, Escape). Before #3955 this compared a red offer toast
 * with a neutral reload toast (#270); the chip replaced both.
 *
 * The page's own poll decides which state to draw, and neither is reachable
 * against a healthy local board (the baked version and the served version
 * agree, which is the point of a real install). So the states are driven the
 * way the page drives them: by calling the renderer with the globals set.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/rt PORT=17371 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17371 node docs/browser-checks/render-reload-toast.js /tmp/rtshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17371';
const OUT = process.argv[2] || '/tmp/rtshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* WCAG: 3:1 for a graphical boundary, 4.5:1 for the sentence. */
function lum(c) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
function rgb(s) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
  if (m) return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  /* #3955: a color-mix() background computes to `color(srgb r g b [/ a])`, channels 0 to 1. */
  const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(s);
  if (c) return { c: [c[1] * 255, c[2] * 255, c[3] * 255], a: c[4] === undefined ? 1 : +c[4] };
  throw new Error('a colour this check cannot read: ' + s);   // never a null that crashes three lines later
}
function over(fg, bg) {
  /* A translucent label composited on its own background, because measuring the
     declared colour of a 0.62-alpha white would report a contrast nobody sees. */
  return fg.c.map((v, i) => v * fg.a + bg.c[i] * (1 - fg.a));
}

/* #3955: this check opens and closes the update window, which records a version as seen on the
   board it shares with later checks. Record the board's OWN version as seen, before each pass and
   at the end, so no page load here or after meets the window by accident. */
async function seenIsCurrent() {
  const got = await (await fetch(URL + '/api/whats-new', { cache: 'no-store' })).json();
  await (await fetch(URL + '/api/whats-new/seen', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: got.current }) })).text();
}

(async () => {
  /* The board's own version is recorded as seen again however this ends (round 3): a throw midway
     must not leave the update window opening on the checks that share this board. */
  let b = null;   // outside the try, so a failure midway still closes the browser (round 4)
  try {
    b = await chromium.launch({ headless: process.env.HEADED === '0' });
    for (const theme of ['light', 'dark']) {
      await seenIsCurrent();
      const pg = await b.newPage({ viewport: { width: 1400, height: 700 }, colorScheme: theme });
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(URL, { waitUntil: 'networkidle' });
      if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
      await pg.waitForTimeout(800);

      for (const state of ['offer', 'stale']) {
        /* Drive the page's own renderer, with the globals the poll would set. */
        await pg.evaluate(([s]) => {
          // eslint-disable-next-line no-undef
          SERVED_VERSION = s === 'stale' ? '9.9.9' : null;
          const meta = document.querySelector('meta[name="kosmos-version"]');
          if (meta && s === 'stale') meta.setAttribute('content', '0.0.1');
          /* #758: ENGINE_STALE outranks both states this check drives (#338,
             by design -- a server behind the code on disk makes an update
             offer or a stale page moot). The page's own poll set it from a
             REAL /api/status read against the booted board, which shares a
             mutable checkout with everything else running on this machine --
             a release or another agent's merge touching that checkout while
             this board has been up flips it true, and every renderUpdateToast
             call below would then draw the engine-changed toast instead of
             the offer/stale pair this check exists to test. Pinned to null,
             not inherited: this check is #270 (offer vs. reload), never #338. */
          // eslint-disable-next-line no-undef
          ENGINE_STALE = null;
          // eslint-disable-next-line no-undef
          document.getElementById('utoast-slot').innerHTML = '';
          // eslint-disable-next-line no-undef
          delete document.getElementById('utoast-slot').dataset.v;
          // eslint-disable-next-line no-undef
          renderUpdateToast(s === 'offer' ? { version: '9.9.9' } : null);
        }, [state]);
        await pg.waitForTimeout(250);

        // #3955 (Mona Lisa's mock A and B): both states are the one-line chip with one gold action.
        const el = await pg.$('.uchip');
        chk(Boolean(el), theme + '/' + state + ': the chip is drawn');
        if (!el) continue;
        const box = await el.boundingBox();
        chk(Boolean(box && box.width > 150 && box.height >= 24 && box.height <= 34), theme + '/' + state + ': it is one small line',
          box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'none');

        const seen = await pg.evaluate(() => {
          const t = document.querySelector('.uchip');
          const cs = getComputedStyle(t);
          const b = t.querySelector('button');
          const bs = getComputedStyle(b);
          return {
            bg: cs.backgroundColor, text: cs.color, words: t.innerText,
            btnBg: bs.backgroundColor, btnText: bs.color,
            buttons: t.querySelectorAll('button').length,
          };
        });
        const bg = rgb(seen.bg);
        const text = rgb(seen.text);
        const btnBg = rgb(seen.btnBg);
        const btnText = rgb(seen.btnText);
        chk(ratio(over(text, bg), bg.c) >= 4.5, theme + '/' + state + ': the words clear 4.5:1',
          ratio(over(text, bg), bg.c).toFixed(2));
        chk(ratio(over(btnText, btnBg), btnBg.c) >= 4.5, theme + '/' + state + ': the action\'s words clear 4.5:1 on its gold',
          ratio(over(btnText, btnBg), btnBg.c).toFixed(2));
        chk(seen.buttons === 1, theme + '/' + state + ': one action and no dismiss', String(seen.buttons));
        if (state === 'stale') {
          chk(/Reload to finish updating/.test(seen.words) && !/Kosmos updated|previous version|Install/i.test(seen.words),
            theme + ': it asks for the reload and never calls the old page updated', seen.words);
        } else {
          chk(/An update is available/.test(seen.words) && !/9\.9\.9|Later/.test(seen.words),
            theme + ': the offer is one line with no version and no Later', seen.words);
        }
        await pg.screenshot({ path: path.join(OUT, 'toast-' + state + '-' + theme + '.png'), clip: { x: 0, y: 0, width: 700, height: 130 } });
      }
      /* #3955 (Mona Lisa's mock C): "Kosmos has been updated", opened the way whatsNewCheck opens it,
         with four highlights, then with none. The window is made on open and removed on close. */
      await pg.evaluate(() => { document.getElementById('utoast-slot').innerHTML = ''; });
      const HL = [
        { icon: 'swarm', title: 'Swarms', line: 'One agent brings in helpers when parts of a task can run at once.' },
        { icon: 'tasks', title: 'Subtasks', line: 'Break a task into smaller ones, and see them fold under it.' },
        { icon: 'phone', title: 'Kosmos on your phone', line: 'Chat with your agents from anywhere with Kosmos+.' },
        { icon: 'list', title: 'A cleaner Tasks view', line: 'All your tasks in one list, without the extra box around them.' },
      ];
      // A fresh sandbox shows a first-visit tip; close it so the shot is the window alone (the real window waits for it).
      await pg.evaluate(() => { const x = document.querySelector('.tip-x'); if (x && x.offsetParent) x.click(); });
      await pg.evaluate((hl) => { document.getElementById('klink').focus(); wnOpen('0.6.98', hl); }, HL);   // eslint-disable-line no-undef
      await pg.waitForTimeout(250);
      const wn = await pg.evaluate(() => {
        const back = document.getElementById('whatsnew');
        const box = back && back.querySelector('.wn-box');
        const r = box && box.getBoundingClientRect();
        return back ? {
          shown: !back.hidden, dim: getComputedStyle(back).backgroundColor, title: box.querySelector('#wn-title').textContent,
          pill: !!box.querySelector('.wn-ver') || /Version \d/.test(box.textContent), gotit: /Got it/.test(box.textContent), tiles: box.querySelectorAll('.wn-tile').length,
          x: (() => { const b = box.querySelector('#wn-x'); if (!b) return null; const xr = b.getBoundingClientRect();
            return { label: b.getAttribute('aria-label'), topRight: xr.top - r.top < 40 && r.right - xr.right < 40 }; })(),
          ring: getComputedStyle(document.activeElement).outlineStyle,
          link: (() => { const a = box.querySelector('#wn-more').getBoundingClientRect(); return { left: a.left - r.left < 48, bottom: r.bottom - a.bottom < 48 }; })(),
          icons: box.querySelectorAll('.wn-tile svg').length, focus: document.activeElement && document.activeElement.id,
          centred: r && Math.abs((r.left + r.width / 2) - innerWidth / 2) < 4, more: box.querySelector('#wn-more').getAttribute('href'),
          rel: box.querySelector('#wn-more').getAttribute('rel'),
        } : null;
      });
      chk(Boolean(wn && wn.shown), theme + ': the update window opens', JSON.stringify(wn));
      if (wn) {
        chk(wn.title === 'Kosmos has been updated to 0.6.98' && !wn.pill, theme + ': the title names the version, with no version pill (Josh)', wn.title);
        chk(!wn.gotit && wn.x && wn.x.label === 'Close' && wn.x.topRight, theme + ': no Got it; an X top-right closes it (Josh)', JSON.stringify({ gotit: wn.gotit, x: wn.x }));
        chk(wn.link.left && wn.link.bottom, theme + ': "See everything that changed" sits bottom-left (Josh)', JSON.stringify(wn.link));
        chk(wn.tiles === 4 && wn.icons === 4, theme + ': four highlight tiles, each with its icon', wn.tiles + ' tiles, ' + wn.icons + ' icons');
        chk(wn.focus === '' && wn.ring === 'none' && wn.centred, theme + ': focus on the window itself with no ring (Josh), the card centred over the dimmed app',
          JSON.stringify({ focus: wn.focus, ring: wn.ring, centred: wn.centred, dim: wn.dim }));
        // The URL is split so the selectors test does not read its fragment as a page id.
        chk(wn.more === 'https://installkosmos.com/versions' + '#' + 'v0-6-98' && wn.rel === 'noreferrer noopener',
          theme + ': "See everything that changed" goes to this version on the site', wn.more);
      }
      // The window's words clear 4.5:1 (round 4 tiles; round 5 the link too; the X, 3:1 as a control).
      const words = await pg.evaluate(() => {
        const box = document.querySelector('#whatsnew .wn-box');
        const t = box.querySelector('.wn-tile');
        const cs = (el) => getComputedStyle(el);
        return [
          ['the tile title', cs(t.querySelector('b')).color, cs(t).backgroundColor],
          ['the tile line', cs(t.querySelector('.wn-words span')).color, cs(t).backgroundColor],
          ['the close X', cs(box.querySelector('#wn-x')).color, cs(box).backgroundColor],
          ['"See everything that changed"', cs(box.querySelector('#wn-more')).color, cs(box).backgroundColor],
        ];
      });
      for (const [what, fg, bg] of words) {
        const r = ratio(over(rgb(fg), rgb(bg)), rgb(bg).c);
        chk(r >= 4.5, theme + ': ' + what + ' clears 4.5:1', r.toFixed(2));
      }
      await pg.screenshot({ path: path.join(OUT, 'whatsnew-' + theme + '.png') });
      // Tab stays inside the window, both ways.
      await pg.keyboard.press('Tab');
      let at = await pg.evaluate(() => document.activeElement && document.activeElement.id);
      await pg.keyboard.press('Tab');
      const wrapped = await pg.evaluate(() => document.activeElement && document.activeElement.id);
      chk(at === 'wn-x' && wrapped === 'wn-more', theme + ': Tab goes to the X, then the link', at + ' then ' + wrapped);
      // Keyboard focus is shown, and in gold, not the black ring (Josh).
      const kring = await pg.evaluate(() => { const c = getComputedStyle(document.activeElement); return { style: c.outlineStyle, color: c.outlineColor }; });
      chk(kring.style !== 'none' && !/^rgb\(0, 0, 0\)$|^rgb\(2[0-9], 2[0-9], 2[0-9]\)$/.test(kring.color), theme + ': a keyboard focus ring shows, not black', JSON.stringify(kring));
      await pg.keyboard.press('Tab');
      const wrap2 = await pg.evaluate(() => document.activeElement && document.activeElement.id);
      chk(wrap2 === 'wn-x', theme + ': Tab stays inside the window', wrap2);
      await pg.keyboard.press('Shift+Tab');
      at = await pg.evaluate(() => document.activeElement && document.activeElement.id);
      chk(at === 'wn-more', theme + ': Shift+Tab stays inside it too', at);   // from the X back round to the link
      // Escape closes it, focus goes back, and the version is recorded as seen on the board.
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(400);
      const after = await pg.evaluate(async () => ({
        gone: !document.getElementById('whatsnew'), focus: document.activeElement && document.activeElement.id,
        seen: (await (await fetch('/api/whats-new', { cache: 'no-store' })).json()).seen,
      }));
      chk(after.gone && after.focus === 'klink', theme + ': Escape closes it and focus goes back where it was', JSON.stringify(after));
      // (Seen is recorded by whatsNewCheck as the window opens; web.whatsnew-3955.test.js pins it. This check opens it directly.)
      // Opened again, the X closes it. (A release with no highlights shows no window at all: web.whatsnew-3955.test.js.)
      await pg.evaluate((hl) => wnOpen('0.6.99', hl.slice(0, 1)), HL);   // eslint-disable-line no-undef
      await pg.waitForTimeout(200);
      const one = await pg.evaluate(() => document.querySelectorAll('#wn-tiles .wn-tile').length);
      chk(one === 1, theme + ': one highlight is one tile', String(one));
      if (theme === 'light') await pg.screenshot({ path: path.join(OUT, 'whatsnew-one-light.png') });
      await pg.click('#wn-x');
      await pg.waitForTimeout(200);
      chk(!(await pg.$('#whatsnew')), theme + ': the X closes it');

      chk(errs.length === 0, theme + ': no console errors', errs.join(' | '));
      await pg.close();
    }
  } catch (e) {
    fail.push('the check stopped: ' + (e && e.message));
    console.log('FAIL  the check stopped: ' + (e && e.message));
  } finally {
    if (b) await b.close().catch(() => {});
    await seenIsCurrent().catch(() => {});
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
