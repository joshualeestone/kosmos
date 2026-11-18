'use strict';

/**
 * kosmos#8667: an agent with no model recorded says "No model recorded: set it in AI Settings", and the link opens
 * that agent's AI Settings, never the card's plain open or its answer route.
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN CLICK. The unit suite (web.nomodel-8667.test.js) pins the markup and
 * the order of the click route in the source; only a browser can show what a real click on the link does in the
 * grid and the list (and that My Agents draws no model line): which function runs, with which section, and that
 * a modified click is left to the browser.
 *
 *   node docs/browser-checks/render-nomodel-8667.js <url>
 *
 * Read-only: it draws fixture agents with the page's own card() and lrow() renderers into the grid, the list and My Agents, stubs
 * openDetail / pjAnswerFrom to record their calls (so nothing navigates), clicks, and reads the record. It
 * never POSTs, so it needs no sandbox.
 */
const { chromium } = require('playwright');
(async () => {
  const BOARD = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  try {
    await pg.goto(BOARD + '/?tab=agents', { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    const draw = () => pg.evaluate(() => {
      try {
        window.__calls = [];
        openDetail = (...args) => { window.__calls.push(['openDetail', ...args]); };   // eslint-disable-line no-global-assign

        pjAnswerFrom = (...args) => { window.__calls.push(['answer', ...args]); };     // eslint-disable-line no-global-assign
        const base = (over) => Object.assign({ name: 'Cleo', role: '', running: true, state: 'idle', isNamedOurs: true,
          reported: false, confidence: 'structured', stateConfidence: 'structured' }, over);
        const none = base({ sessionName: 'nomodel' });
        const named = base({ sessionName: 'named', plannedModelName: 'Sonnet 5' });
        const asking = base({ sessionName: 'asking', state: 'needs_you', isNamedOurs: true, running: true,
          question: { text: 'Which one?' } });
        document.getElementById('grid').innerHTML = [none, named, asking].map((a) => card(a)).join('');
        const row = (a) => lrow(a);
        document.getElementById('my-agents-list').innerHTML = row(base({ sessionName: 'mine' }));
        document.getElementById('alist').innerHTML = row(none);
        return 'OK';
      } catch (e) { return 'ERR: ' + e.message; }
    });
    const setup = await draw();
    say(/^OK/.test(setup), 'fixture cards render without error', setup);

    const link = (scope, who) => scope + ' a.modelset[data-ai-settings="' + who + '"]';
    const calls = () => pg.evaluate(() => window.__calls.splice(0));
    const textOf = (sel) => pg.$eval(sel, (el) => el.innerText).catch(() => 'missing');

    say((await textOf('.acard[data-agent="nomodel"] .amodel')) === 'No model recorded: set it in AI Settings',
      'the no-model card says the new line', await textOf('.acard[data-agent="nomodel"] .amodel'));
    say((await textOf('.acard[data-agent="nomodel"] .amodel a.modelset')) === 'AI Settings', 'its link is "AI Settings"');
    say(!(await pg.$('.acard[data-agent="named"] a.modelset')), 'CONTROL: a card with a model has no link');
    say((await textOf('.acard[data-agent="named"] .amodel')) === 'Claude Sonnet 5', 'CONTROL: a named model is unchanged');
    const href = await pg.$eval(link('#grid', 'nomodel'), (el) => el.getAttribute('href')).catch(() => 'missing');
    say(href === '?tab=detail&agent=nomodel&sec=model', 'the link is the #7280 address of its AI Settings', href);

    /* Review 2: the board repaints the grid from its own 5 s poll, so each arm draws the fixtures again just before
       it clicks. */
    await draw();
    // A plain click: AI Settings, once, and never the card's plain open (openDetail with no section).
    await calls();
    const before = pg.url();   // the board rewrites its own address after boot, so compare with itself
    await pg.click(link('#grid', 'nomodel'));
    let got = await calls();
    say(got.length === 1 && got[0][0] === 'openDetail' && got[0][1] === 'nomodel' && got[0][2] === 'model',
      'a click opens that agent on its AI Settings, and nothing else', JSON.stringify(got));
    say(pg.url() === before, 'the click did not navigate the page away', before + ' -> ' + pg.url());

    // A modified click is left to the browser: the page runs nothing of its own.
    const popup = pg.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await pg.click(link('#grid', 'nomodel'), { modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    const opened = await popup;
    got = await calls();
    say(got.length === 0, 'a modified click runs nothing in the page', JSON.stringify(got));
    if (opened) await opened.close().catch(() => {});

    await draw();
    // CONTROL: clicking the card itself (away from the link) is still the plain open.
    await pg.click('.acard[data-agent="nomodel"] .aname button.namego');
    got = await calls();
    say(got.length === 1 && got[0][0] === 'openDetail' && got[0][2] === undefined,
      'CONTROL: the card itself still opens plainly', JSON.stringify(got));

    await draw();
    // A card with a question to answer: its link still opens AI Settings, never the answer route.
    const askSel = '.acard[data-agent="asking"]';
    say(!!(await pg.$(askSel + '[data-answer]')), 'premise: the asking card carries its answer route');
    if (await pg.$(link('#grid', 'asking'))) {
      await pg.click(link('#grid', 'asking'));
      got = await calls();
      say(got.length === 1 && got[0][0] === 'openDetail' && got[0][2] === 'model',
        'a card with a question: the link opens AI Settings, not the answer', JSON.stringify(got));
      await pg.click(askSel + ' .aname button.namego');
      got = await calls();
      say(got.length === 1 && got[0][0] === 'answer', 'CONTROL: the asking card\'s name still answers', JSON.stringify(got));
    } else {
      say(false, 'the asking card has the link', 'none');
    }

    await draw();
    // The list row (#alist, the board's list view): the whole sentence is the link, and a real click on it opens AI
    // Settings. The list is shown for this arm (the board opens on the grid view), so the pointer reaches the row.
    await pg.evaluate(() => { const l = document.getElementById('alist'); l.hidden = false; l.style.display = 'block'; });
    const rowLink = link('#alist', 'nomodel');
    say((await textOf(rowLink)) === 'No model recorded: set it in AI Settings', 'the list row: the whole line is the link',
      await textOf(rowLink));
    if (await pg.$(rowLink)) {
      await pg.click(rowLink);
      got = await calls();
      say(got.length === 1 && got[0][0] === 'openDetail' && got[0][1] === 'nomodel' && got[0][2] === 'model',
        'the list row: a click opens that agent on its AI Settings, and nothing else', JSON.stringify(got));
    }

    /* Review 3: My Agents shows no model cell at all (.myagents-list hides it), so the link is never reachable there.
       Review 5: its column sits in the hidden detail panel on this tab, so both are shown first, and the row's name
       must be visible, or "not visible" would only say the panel is closed. */
    await pg.evaluate(() => {
      for (const id of ['panel-detail', 'my-agents']) { const el = document.getElementById(id); el.hidden = false; el.style.display = 'block'; }
    });
    const mine = link('#my-agents-list', 'mine');
    say(await pg.isVisible('#my-agents-list .lrow[data-agent="mine"] .lname'), 'premise: My Agents\' row is on screen (its name shows)');
    say(!!(await pg.$(mine)) && !(await pg.isVisible(mine)), 'My Agents: the row draws no visible model line, so no link');
  } catch (e) {
    say(false, 'the check stopped: ' + e.message);
  } finally {
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
