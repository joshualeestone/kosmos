/**
 * kosmos#9132: half-typed words in a chat box come back after a reload, and a kept draft no longer holds the Mac
 * window's self-restart onto an update.
 *
 * What this asserts, in a real page: words TYPED into April's message box (real keystrokes, so the page's own input
 * handler parks them) are written to localStorage at once; updateNothingToLose() says nothing would be lost; after a
 * reload, opening April's chat puts the words back in the box. CONTROL: with storage refusing writes, the same typing
 * leaves updateNothingToLose() false (the words would be lost, so the restart still waits), and after a reload the box
 * is empty.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-keepdrafts-9132.js
 *
 * The page set-up is render-dm-send-clears-4944's.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const WORDS = 'half a sentence I will finish later';

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const THREAD = {
  messages: [{ from: 'april', at: new Date().toISOString(), text: 'ready when you are.' }],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

async function openApril(page, refuseStorage) {
  await page.addInitScript(([fx, refuse]) => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/thread')) return enc(fx);
      if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
      return enc({});
    };
    // CONTROL arm: storage refuses every write, as a full or refused store does.
    if (refuse) Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };
  }, [THREAD, refuseStorage]);
  await page.goto(PAGE);
  await page.evaluate(() => {
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  });
  await page.evaluate(() => paintTalk('april', 'April'));
}

async function run(browser, refuseStorage) {
  const arm = refuseStorage ? 'storage refused (control)' : 'storage works';
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await openApril(page, refuseStorage);
  // Before typing, nothing holds the restart, so a held restart after typing is the draft's doing (both arms).
  chk(await page.evaluate(() => updateNothingToLose()) === true, `${arm}: before typing, nothing holds the restart`);
  await page.click('#d-say');
  await page.keyboard.type(WORDS);
  const typed = await page.evaluate(() => ({
    box: document.getElementById('d-say').value,
    parked: TALK_DRAFTS.april || null,
    stored: (() => { try { return localStorage.getItem('kosmos.draft.talk.april'); } catch { return 'unreadable'; } })(),
    safe: updateNothingToLose(),
  }));
  console.log(`  ${arm}, after typing: ${JSON.stringify(typed)}`);
  chk(typed.box === WORDS && typed.parked === WORDS, `${arm}: the typed words are in the box and parked for April`);
  if (!refuseStorage) {
    chk(!!typed.stored && JSON.parse(typed.stored).v === WORDS, `${arm}: the draft is written to localStorage as it is typed`);
    chk(typed.safe === true, `${arm}: a kept draft does not hold the restart (updateNothingToLose is true)`);
  } else {
    chk(typed.stored === null, `${arm}: nothing reached storage`);
    chk(typed.safe === false, `${arm}: words storage refused still hold the restart (updateNothingToLose is false)`);
  }
  await page.reload();
  await page.evaluate(() => {
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  });
  await page.evaluate(() => paintTalk('april', 'April'));
  const back = await page.evaluate(() => document.getElementById('d-say').value);
  console.log(`  ${arm}, after a reload: box ${JSON.stringify(back)}`);
  if (!refuseStorage) chk(back === WORDS, `${arm}: after a reload, opening April's chat puts the words back in the box`);
  else chk(back === '', `${arm}: after a reload the box is empty (the words were never kept)`);
  chk(errs.length === 0, `${arm}: no page errors`, errs.join(' | '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    await run(browser, false);
    await run(browser, true);
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log(`FAILED ${fail.length}: ${fail.join('; ')}`); process.exit(1); }
  console.log('ALL PASS: render-keepdrafts-9132');
})().catch((e) => { console.error(e); process.exit(1); });
