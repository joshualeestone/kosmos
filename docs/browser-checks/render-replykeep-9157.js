/**
 * kosmos#9157 (follow-up to #9132): a reply being written in a chat comes back after a reload, still answering its
 * message, and a kept reply no longer holds the Mac window's self-restart onto an update.
 *
 * What this asserts, in a real page: Reply is started on April's message and words are TYPED after it (real
 * keystrokes); the reply is written to localStorage and updateNothingToLose() says nothing would be lost. After a
 * reload, opening April's chat shows the "Replying to" strip again and the words in the box, and pressing Enter posts
 * them with reply_to naming the original message. CONTROL: with storage refusing writes, the same reply leaves
 * updateNothingToLose() false (the restart still waits), and after a reload no strip shows.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-replykeep-9157.js
 *
 * The page set-up is render-keepdrafts-9132's.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const WORDS = 'yes, that one';
const AT = new Date(Date.now() - 60 * 1000).toISOString();

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const THREAD = {
  messages: [{ from: 'april', at: AT, text: 'shall I use the blue one?' }],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

async function boot(page, refuseStorage) {
  await page.addInitScript(([fx, refuse]) => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.__posts = [];
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/thread') && opts && opts.method === 'POST') {
        window.__posts.push(JSON.parse(opts.body));
        return enc({ ok: true, placed: true });
      }
      if (u.includes('/thread')) return enc(fx);
      if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
      return enc({});
    };
    if (refuse) Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };
  }, [THREAD, refuseStorage]);
  await page.goto(PAGE);
}
async function openApril(page) {
  await page.evaluate(() => {
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  });
  await page.evaluate(() => paintTalk('april', 'April'));
  // The thread is fetched and drawn after paintTalk returns: wait for April's rows.
  await page.waitForFunction((at) => typeof DM_ROWS !== 'undefined' && DM_ROWS_OF === 'april' && DM_ROWS.has(at), AT, { timeout: 10000 });
}
const strip = (page) => page.evaluate(() => {
  const el = document.getElementById('d-reply');
  return { shown: !!el && !el.hidden, text: el ? el.textContent : '' };
});

async function run(browser, refuseStorage) {
  const arm = refuseStorage ? 'storage refused (control)' : 'storage works';
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await boot(page, refuseStorage);
  await openApril(page);
  chk(await page.evaluate(() => updateNothingToLose()) === true, `${arm}: before the reply, nothing holds the restart`);
  await page.evaluate((at) => dmReplyStart(at), AT);   // the same call the message's Reply button makes
  await page.click('#d-say');
  await page.keyboard.type(WORDS);
  const typed = await page.evaluate(() => ({
    reply: DM_REPLY.april ? DM_REPLY.april.at : null,
    stored: (() => { try { return localStorage.getItem('kosmos.draft.dmreply.april'); } catch { return 'unreadable'; } })(),
    safe: updateNothingToLose(),
  }));
  console.log(`  ${arm}, after Reply and typing: ${JSON.stringify(typed)}`);
  chk(typed.reply === AT && (await strip(page)).shown, `${arm}: the reply is pending and its strip shows`);
  if (!refuseStorage) {
    chk(!!typed.stored && JSON.parse(typed.stored).v.at === AT, `${arm}: the reply is written to localStorage`);
    chk(typed.safe === true, `${arm}: a kept reply with words does not hold the restart`);
  } else {
    chk(typed.stored === null, `${arm}: nothing reached storage`);
    chk(typed.safe === false, `${arm}: a reply storage refused still holds the restart`);
  }
  await page.reload();
  await openApril(page);
  const back = { box: await page.evaluate(() => document.getElementById('d-say').value), strip: await strip(page) };
  console.log(`  ${arm}, after a reload: ${JSON.stringify(back)}`);
  if (!refuseStorage) {
    chk(back.strip.shown && /Replying to/.test(back.strip.text), `${arm}: after a reload the "Replying to" strip is back`);
    chk(back.box === WORDS, `${arm}: after a reload the words are back in the box`);
    await page.click('#d-say');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__posts.length > 0, null, { timeout: 10000 }).catch(() => {});
    const posts = await page.evaluate(() => window.__posts);
    console.log(`  ${arm}, posted: ${JSON.stringify(posts)}`);
    chk(posts.length === 1 && posts[0].text === WORDS && posts[0].reply_to === AT,
      `${arm}: Enter posts the words as a reply to the original message`);
  } else {
    chk(!back.strip.shown, `${arm}: after a reload no reply strip shows (it was never kept)`);
  }
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
  console.log('ALL PASS: render-replykeep-9157');
})().catch((e) => { console.error(e); process.exit(1); });
