'use strict';

/**
 * The reload toast, rendered in both tones beside the one it must not look
 * like (#270). #3955: both are now the one-line update chip, and this also
 * opens the "Kosmos has been updated" window (tiles, focus, Tab, Escape, seen).
 *
 * 🔑 THE CLAIM IS A COMPARISON, so both states are captured in one run: the
 * shipped offer toast is red and earns it, and the reload state must read as
 * neutral. A check that only rendered the new one could pass on a toast painted
 * the same alarming red as the thing it is not.
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
  if (!m) return null;
  return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
}
function over(fg, bg) {
  /* A translucent label composited on its own background, because measuring the
     declared colour of a 0.62-alpha white would report a contrast nobody sees. */
  return fg.c.map((v, i) => v * fg.a + bg.c[i] * (1 - fg.a));
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
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
    await pg.evaluate((hl) => { document.getElementById('klink').focus(); wnOpen('0.6.98', hl); }, HL);   // eslint-disable-line no-undef
    await pg.waitForTimeout(250);
    const wn = await pg.evaluate(() => {
      const back = document.getElementById('whatsnew');
      const box = back && back.querySelector('.wn-box');
      const r = box && box.getBoundingClientRect();
      return back ? {
        shown: !back.hidden, dim: getComputedStyle(back).backgroundColor, title: box.querySelector('#wn-title').textContent,
        ver: box.querySelector('#wn-ver').textContent, tiles: box.querySelectorAll('.wn-tile').length,
        icons: box.querySelectorAll('.wn-tile svg').length, focus: document.activeElement && document.activeElement.id,
        centred: r && Math.abs((r.left + r.width / 2) - innerWidth / 2) < 4, more: box.querySelector('#wn-more').getAttribute('href'),
        rel: box.querySelector('#wn-more').getAttribute('rel'),
      } : null;
    });
    chk(Boolean(wn && wn.shown), theme + ': the update window opens', JSON.stringify(wn));
    if (wn) {
      chk(wn.title === 'Kosmos has been updated' && wn.ver === 'Version 0.6.98', theme + ': it says Kosmos has been updated, and the version', wn.title + ' / ' + wn.ver);
      chk(wn.tiles === 4 && wn.icons === 4, theme + ': four highlight tiles, each with its icon', wn.tiles + ' tiles, ' + wn.icons + ' icons');
      chk(wn.focus === 'wn-ok' && wn.centred, theme + ': focus on Got it, the card centred over the dimmed app', JSON.stringify({ focus: wn.focus, centred: wn.centred, dim: wn.dim }));
      chk(wn.more === 'https://installkosmos.com/versions#v0-6-98' && wn.rel === 'noreferrer noopener', theme + ': "See everything that changed" goes to this version on the site', wn.more);
    }
    await pg.screenshot({ path: path.join(OUT, 'whatsnew-' + theme + '.png') });
    // Tab stays inside the window, both ways.
    await pg.keyboard.press('Tab');
    let at = await pg.evaluate(() => document.activeElement && document.activeElement.id);
    await pg.keyboard.press('Tab');
    const wrapped = await pg.evaluate(() => document.activeElement && document.activeElement.id);
    chk(at === 'wn-more' && wrapped === 'wn-ok', theme + ': Tab stays inside the window', at + ' then ' + wrapped);
    await pg.keyboard.press('Shift+Tab');
    at = await pg.evaluate(() => document.activeElement && document.activeElement.id);
    chk(at === 'wn-more', theme + ': Shift+Tab stays inside it too', at);
    // Escape closes it, focus goes back, and the version is recorded as seen on the board.
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(400);
    const after = await pg.evaluate(async () => ({
      gone: !document.getElementById('whatsnew'), focus: document.activeElement && document.activeElement.id,
      seen: (await (await fetch('/api/whats-new', { cache: 'no-store' })).json()).seen,
    }));
    chk(after.gone && after.focus === 'klink', theme + ': Escape closes it and focus goes back where it was', JSON.stringify(after));
    chk(after.seen === '0.6.98', theme + ': closing records the version as seen, so it does not show again', String(after.seen));
    // Without highlights (a hotfix): the title and version alone, no empty grid.
    await pg.evaluate(() => wnOpen('0.6.99', null));   // eslint-disable-line no-undef
    await pg.waitForTimeout(200);
    const bare = await pg.evaluate(() => ({ tilesHidden: document.getElementById('wn-tiles').hidden, ver: document.getElementById('wn-ver').textContent }));
    chk(bare.tilesHidden && bare.ver === 'Version 0.6.99', theme + ': with no highlights, the title and the version alone', JSON.stringify(bare));
    if (theme === 'light') await pg.screenshot({ path: path.join(OUT, 'whatsnew-bare-light.png') });
    await pg.click('#wn-ok');
    await pg.waitForTimeout(200);
    chk(!(await pg.$('#whatsnew')), theme + ': Got it closes it');

    chk(errs.length === 0, theme + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
