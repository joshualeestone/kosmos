'use strict';
// Browser-check-surface: fr-conn-url fr-conn-cloudsay-code fr-conn-cloudsay-open frCloudSigninDetail frConnPaintUrl fr-conn-code
/**
 * kosmos#4903 S5 design (Mona Lisa, card comment 6433522198), first run's Claude sign-in on a Kosmos cloud machine:
 *   1. the sign-in link is the PRIMARY button, gold and filled, no underline, full width on a phone. It used to lose to
 *      `#firstrun .btn` (white), so a source check cannot see it: this measures the computed paint.
 *   2. the sentence says "below" once the link is there;
 *   3. the code field carries "Paste the code from Claude" and no second label.
 * CONTROL: the Mac keeps its quiet white fallback link and its label.
 * HERMETIC: loads web/index.html over file://, no board. The cloud machine is the served meta the board writes
 * (kosmos-cloud-machine = 1), set on the page before painting.
 *
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-cloud-signin-4903.js
 */
const nodePath = require('path');
const { chromium } = require('playwright');

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const URL = 'https://claude.com/cai/oauth/authorize?code=true&x=1';
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

async function arm(browser, { cloud, width }) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  await page.goto('file://' + PAGE);
  const got = await page.evaluate(({ cloud, URL }) => {
    if (cloud) {
      let m = document.querySelector('meta[name="kosmos-cloud-machine"]');
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'kosmos-cloud-machine'); document.head.appendChild(m); }
      m.setAttribute('content', '1');
    }
    if (typeof frPaintConnect !== 'function' || typeof onCloudMachine !== 'function') return { error: 'frPaintConnect / onCloudMachine missing' };
    if (onCloudMachine() !== cloud) return { error: 'the page did not read the cloud meta as set' };
    document.getElementById('firstrun').hidden = false;
    const host = document.getElementById('fr-sub');
    for (let n = host; n; n = n.parentElement) {
      n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    frPaintConnect({ phase: 'signin-awaiting-code', url: URL });
    const box = document.getElementById('fr-conn-url');
    const link = box && box.querySelector('a.btn');
    if (!link) return { error: 'no sign-in link painted', html: box ? box.innerHTML.slice(0, 160) : null };
    // The gold the first-run card itself resolves, measured beside the link (not a hard-coded colour).
    const ref = document.createElement('span');
    ref.style.background = 'var(--gold-bright)';
    box.appendChild(ref);
    const gold = getComputedStyle(ref).backgroundColor;
    ref.remove();
    const cs = getComputedStyle(link);
    const lr = link.getBoundingClientRect(), br = box.getBoundingClientRect();
    const input = document.getElementById('fr-conn-code');
    return {
      bg: cs.backgroundColor, gold, deco: cs.textDecorationLine, linkW: lr.width, boxW: br.width,
      sub: host.textContent, placeholder: input ? input.getAttribute('placeholder') : 'NO INPUT',
      label: !!host.querySelector('label[for="fr-conn-code"]'),
    };
  }, { cloud, URL });
  got.errors = errors;
  await page.close();
  return got;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (e) { console.error('could not launch chromium: ' + e.message); process.exit(1); }
  const WHITE = 'rgb(255, 255, 255)';
  for (const width of [1280, 393]) {
    const c = await arm(browser, { cloud: true, width });
    if (c.error) { check(`cloud ${width}: the sign-in screen paints`, false, JSON.stringify(c)); continue; }
    check(`cloud ${width}: the sign-in link is gold (the card's --gold-bright), not white`, c.bg === c.gold && c.bg !== WHITE, `link ${c.bg}, gold ${c.gold}`);
    check(`cloud ${width}: the link is a button, not underlined text`, c.deco === 'none', c.deco);
    check(`cloud ${width}: the sentence says the link is below`, /sign-in page below/.test(c.sub) && !/in a moment|its link appears/i.test(c.sub), c.sub.slice(0, 140));
    check(`cloud ${width}: the code field has the placeholder and no second label`, c.placeholder === 'Paste the code from Claude' && !c.label, `${c.placeholder} / label ${c.label}`);
    check(`cloud ${width}: no page errors`, c.errors.length === 0, c.errors.join(' | '));
    if (width < 600) check('cloud 393: the link is full width on a phone', c.linkW >= c.boxW - 1, `link ${Math.round(c.linkW)} of ${Math.round(c.boxW)}`);
    const m = await arm(browser, { cloud: false, width });
    if (m.error) { check(`mac ${width}: the sign-in screen paints`, false, JSON.stringify(m)); continue; }
    check(`CONTROL mac ${width}: the fallback link stays quiet (white)`, m.bg === WHITE, m.bg);
    check(`CONTROL mac ${width}: the code label stays, with no placeholder`, m.label && m.placeholder === null, `label ${m.label} / ${m.placeholder}`);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
