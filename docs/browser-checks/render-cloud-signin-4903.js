'use strict';
// Browser-check-surface: fr-conn-url fr-conn-cloudsay-code fr-conn-cloudsay-open frCloudSigninDetail frConnPaintUrl fr-conn-code data-cloud-hide data-cloud-copy boardEmpty d-rename-hint import-folder fr-pane-5
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
    // Review 1: first with no link yet (the sentence says one is coming), then the link arriving inside the phase.
    frPaintConnect({ phase: 'signin-awaiting-code', url: null });
    const before = host.textContent;
    const linkBefore = !!document.querySelector('#fr-conn-url a');
    frConnPaintUrl(URL);
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
      sub: host.textContent, before, linkBefore, placeholder: input ? input.getAttribute('placeholder') : 'NO INPUT',
      label: !!host.querySelector('label[for="fr-conn-code"]'),
    };
  }, { cloud, URL });
  got.errors = errors;
  await page.close();
  return got;
}

/* kosmos#4903 seams G and H: what data-cloud-hide hides is CSS keyed on a stamp applyPlatformCopy writes, which no
   source check can see, so this measures the computed display of each row once the cloud meta is set and the copy
   layer applied, and reads the words No agents yet paints. */
async function hideArm(browser, cloud) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  await page.goto('file://' + PAGE);
  const got = await page.evaluate((cloud) => {
    if (cloud) {
      let m = document.querySelector('meta[name="kosmos-cloud-machine"]');
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'kosmos-cloud-machine'); document.head.appendChild(m); }
      m.setAttribute('content', '1');
    }
    if (typeof applyPlatformCopy !== 'function' || typeof boardEmpty !== 'function') return { error: 'applyPlatformCopy / boardEmpty missing' };
    applyPlatformCopy(document);
    const pane = document.getElementById('fr-pane-5');
    for (let n = pane; n; n = n.parentElement) { n.removeAttribute('hidden'); if (getComputedStyle(n).display === 'none') n.style.display = 'block'; }
    const rows = [...pane.querySelectorAll('.llm .llm-m[data-pmark]')].map((s) => [s.getAttribute('data-pmark'), getComputedStyle(s.closest('.llm')).display !== 'none']);
    const folder = document.getElementById('import-folder');
    for (let n = folder; n; n = n.parentElement) n.removeAttribute('hidden');
    const hint = document.getElementById('d-rename-hint');
    return {
      rows, folderShown: !!folder && getComputedStyle(folder).display !== 'none' && folder.getBoundingClientRect().height > 0,
      folderHidden: !!folder && !!folder.closest('[data-cloud-hide]') && getComputedStyle(folder.closest('[data-cloud-hide]')).display === 'none',
      empty: (() => { const d = document.createElement('div'); d.innerHTML = boardEmpty(); return d.textContent; })(),
      hint: hint ? hint.textContent : 'NO HINT',
    };
  }, cloud);
  got.errors = errors;
  await page.close();
  return got;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (e) { console.error('could not launch chromium: ' + e.message); process.exit(1); }
  const WHITE = 'rgb(255, 255, 255)';
  for (const width of [1280, 700, 393]) {
    const c = await arm(browser, { cloud: true, width });
    if (c.error) { check(`cloud ${width}: the sign-in screen paints`, false, JSON.stringify(c)); continue; }
    check(`cloud ${width}: the sign-in link is gold (the card's --gold-bright), not white`, c.bg === c.gold && c.bg !== WHITE, `link ${c.bg}, gold ${c.gold}`);
    check(`cloud ${width}: the link is a button, not underlined text`, c.deco === 'none', c.deco);
    check(`cloud ${width}: the sentence says the link is below`, /sign-in page below/.test(c.sub) && !/in a moment|its link appears/i.test(c.sub), c.sub.slice(0, 140));
    check(`cloud ${width}: the code field has the placeholder and no second label`, c.placeholder === 'Paste the code from Claude' && !c.label, `${c.placeholder} / label ${c.label}`);
    check(`cloud ${width}: no page errors`, c.errors.length === 0, c.errors.join(' | '));
    check(`cloud ${width}: before the link arrives, no link and the sentence says it is coming`, !c.linkBefore && /in a moment/.test(c.before) && !/below/.test(c.before), c.before.slice(0, 120));
    if (width <= 720) check(`cloud ${width}: the link is full width in the phone layout`, c.linkW >= c.boxW - 1, `link ${Math.round(c.linkW)} of ${Math.round(c.boxW)}`);
    else check(`CONTROL cloud ${width}: on a desktop the link is not stretched`, c.linkW < c.boxW - 1, `link ${Math.round(c.linkW)} of ${Math.round(c.boxW)}`);
    const m = await arm(browser, { cloud: false, width });
    if (m.error) { check(`mac ${width}: the sign-in screen paints`, false, JSON.stringify(m)); continue; }
    check(`CONTROL mac ${width}: the fallback link stays quiet (white)`, m.bg === WHITE, m.bg);
    check(`CONTROL mac ${width}: the code label stays, with no placeholder`, m.label && m.placeholder === null, `label ${m.label} / ${m.placeholder}`);
  }
  // Seams G and H.
  const hc = await hideArm(browser, true);
  const hm = await hideArm(browser, false);
  if (hc.error || hm.error) check('seam G/H: the page paints', false, JSON.stringify(hc.error ? hc : hm));
  else {
    const shown = (r) => r.rows.filter((x) => x[1]).map((x) => x[0]);
    check('cloud: the first-run Connect list shows Claude alone (computed display)', JSON.stringify(shown(hc)) === '["claude"]', JSON.stringify(shown(hc)));
    check('CONTROL mac: the Connect list shows more than Claude', shown(hm).length > 1 && shown(hm).includes('claude'), JSON.stringify(shown(hm)));
    check('cloud: the folder import is hidden by data-cloud-hide (computed display none)', hc.folderHidden, '');
    check('CONTROL mac: the folder import is not hidden by data-cloud-hide', !hm.folderHidden, '');
    check('cloud: No agents yet says the agent runs on your cloud machine', /runs on your cloud machine and keeps going while you are away/.test(hc.empty), hc.empty.slice(0, 160));
    check('CONTROL mac: No agents yet keeps "this computer"', /runs on this computer/.test(hm.empty), hm.empty.slice(0, 160));
    check('cloud: the rename hint says your cloud machine', /where they live on your cloud machine,/.test(hc.hint), hc.hint);
    check('CONTROL mac: the rename hint says this computer', /where they live on this computer,/.test(hm.hint), hm.hint);
    check('seam G/H: no page errors', hc.errors.length === 0 && hm.errors.length === 0, hc.errors.concat(hm.errors).join(' | '));
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
