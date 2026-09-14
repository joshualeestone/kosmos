'use strict';

/**
 * kosmos#2808 (grant half): DRIVE the agent-page one-click GRANT button
 * (`#d-qask-grant`) in a real browser -- the plainly-worded "Give this agent
 * permission and clear this message" primary that shipped as Josh's remaining
 * literal ask on top of the render slice (`render-qask-clear-2808.js`).
 *
 * ⚠️ WHY THIS EXISTS. The button has node coverage (`web.qask-grant-2808.test.js`),
 * but that test LIFTS the gate + click handler and runs them against stubs -- it
 * never puts the button on a screen. `node --test` cannot see whether the grant
 * button actually renders inside a painted `#d-qask` block, whether it is
 * REACHABLE (this repo has shipped a control that was in the DOM and `inert` --
 * render-talk screenshotted a perfect page nothing on it could click), whether
 * the real click-listener posts the affirmative option to the agent, or whether
 * the gate that HIDES it on the folder-trust prompt survives on a real paint.
 * This check closes that gap, the same split render-qask-clear-2808.js uses.
 *
 * Per docs/browser-checks/README.md (#1769): a committed headless check runs from
 * ANY session, no MCP, no operator. It loads the page over file:// and answers
 * every route from `addInitScript` (like render-talk), so it needs no board and
 * can never touch a real one.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-qask-grant-2808.js
 *   # add SHOT=/abs/path.png to also write a screenshot of the painted button.
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory, so
 * without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND.
 *
 * The thread the stub feeds `paintTalk` is the route's own shape -- `asking:true`,
 * `presence:'on'`, a `question` carrying the permission menu, and a parsed
 * `options` array with an AFFIRMATIVE opt[0] (Claude's "1. Yes"). The grant
 * button sends its answer to POST /api/agent/<name>/thread, the SAME route the
 * raw option buttons use; the stub returns `delivery:{state:'placed'}` for that
 * send so the answered-hold hides the box (the "clear this message" half).
 */

const path = require('path');
const playwright = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';
const SHOT = process.env.SHOT || '';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

function initStub() {
  // The permission menu, as the pane shows it (question.text = the screen slice).
  window.__q = [
    '│ Claude wants to run: npm run migrate:prod',
    '│ Do you want to proceed?',
    '│',
    '│ ❯ 1. Yes',
    '│   2. Yes, and don\'t ask again this session',
    '│   3. No, and tell Claude what to do differently',
  ].join('\n');
  // The parsed menu the engine sends alongside the screen (chat.optionsIn shape).
  // Affirmative opt[0] -> the grant button gates ON. `__trust` swaps in the
  // folder-trust prompt (answerNote set), the red-capable contrast where it must
  // HIDE even though the menu still looks affirmative.
  window.__opts = [{ n: 1, label: 'Yes' }, { n: 2, label: 'Yes, and don\'t ask again this session' }, { n: 3, label: 'No, and tell Claude what to do differently' }];
  window.__trust = false;
  window.setInterval = () => 0;       // refuse the 5s poll (render-talk lesson)
  window.__posted = [];
  window.__asking = true;
  const enc = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    window.__posted.push({ url: u, opts: opts || null });
    if (u.includes('/thread')) {
      // A POST carrying an answer (chose/text) is the SEND, not the paint read
      // (which is a GET). Return a PLACED delivery so the answered-hold arms.
      if (opts && opts.method === 'POST') {
        return enc({ ok: true, delivery: { state: 'placed' }, recorded: true });
      }
      if (!window.__asking) {
        return enc({ ok: true, asking: false, agent: { sessionName: 'april' }, presence: 'on', messages: [], options: null });
      }
      return enc({
        ok: true,
        asking: true,
        agent: { sessionName: 'april' },
        presence: 'on',
        // A live-pane question (not reported). answerNote only on the trust prompt.
        question: { text: window.__q },
        answerNote: window.__trust ? 'Pressing 1 trusts this folder for this agent.' : null,
        options: window.__opts,
        messages: [],
      });
    }
    if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
    return enc({ ok: true, agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-qask-grant-2808: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0).' : '.'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;   // file:// avatar (render-talk exemption)
    pageErrors.push('console: ' + m.text());
  });

  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  const openAgent = () => page.evaluate(() => {
    document.querySelectorAll('body > [inert], body > *').forEach((el) => { el.inert = false; el.removeAttribute && el.removeAttribute('inert'); });
    LAST = [];
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    return paintTalk('april', 'April');
  });
  await openAgent();
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // ---- Scenario 1: the grant button paints, is reachable, reads Josh's words,
  //      and the raw option buttons COEXIST below it ----
  const s1 = await page.evaluate(() => {
    const q = document.getElementById('d-qask');
    const g = document.getElementById('d-qask-grant');
    const qopts = document.getElementById('d-qopts');
    if (!g) return { error: 'the grant button is not in the DOM' };
    const reach = (btn) => {
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: !btn.hidden && r.height > 0, reachable: !!(hit && (hit === btn || btn.contains(hit))) };
    };
    return {
      qaskShown: q && q.hidden === false,
      grant: { ...reach(g), text: (g.textContent || '').trim(), n: g.dataset.n, label: g.dataset.label },
      rawOptCount: qopts.querySelectorAll('.qopt').length,
      qoptsShown: !qopts.hidden,
    };
  });
  if (s1.error) { console.error('render-qask-grant-2808: ' + s1.error); await browser.close(); process.exit(1); }
  check('the #d-qask block paints for an asking thread', s1.qaskShown, JSON.stringify(s1.qaskShown));
  check('the grant button is visible', s1.grant.visible, JSON.stringify(s1.grant));
  check('the grant button is reachable (not inert/covered)', s1.grant.reachable, JSON.stringify(s1.grant.reachable));
  check('the grant button reads Josh\'s exact wording',
    s1.grant.text === 'Give this agent permission and clear this message', JSON.stringify(s1.grant.text));
  check('the grant button targets the affirmative option 1 ("Yes")',
    s1.grant.n === '1' && s1.grant.label === 'Yes', JSON.stringify({ n: s1.grant.n, label: s1.grant.label }));
  check('the raw option buttons COEXIST below (grant does not replace them)',
    s1.qoptsShown && s1.rawOptCount === 3, 'shown=' + s1.qoptsShown + ' count=' + s1.rawOptCount);

  if (SHOT) {
    // try/catch STATEMENT, not a promise `.catch(...)`: the catch/launch scan in
    // browser-checks-reason-grep.test.js counts a `.catch((e) => console...)` as
    // an emit site, and a screenshot-failed line is not a quotable finding. A
    // plain try/catch adds no counted site; only the launch catch above does.
    try { await page.screenshot({ path: SHOT }); console.log('SHOT  wrote ' + SHOT); }
    catch (e) { console.error('FAIL  render-qask-grant-2808: screenshot failed: ' + (e && e.message)); }
  }

  // ---- Scenario 2: a real click posts the affirmative and the box clears ----
  await page.evaluate(() => { window.__posted = []; });
  await page.click('#d-qask-grant');
  // Re-drive the paint (polls are disabled): the placed send armed the answered-
  // hold, so the SAME question now reads as answered and the box hides.
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === true;
  }, { timeout: 5000 }).catch(() => {});
  const s2 = await page.evaluate(() => {
    const q = document.getElementById('d-qask');
    const sends = window.__posted.filter((p) => p.opts && p.opts.method === 'POST' && /\/thread$/.test(p.url));
    const c = sends[0] || null;
    let body = null;
    try { body = c && c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; } catch { body = 'unparseable'; }
    return { sendCalls: sends.length, url: c && c.url, body, qaskHidden: q && q.hidden === true };
  });
  check('a grant click POSTs the thread route for the painted agent exactly once',
    s2.sendCalls === 1 && /\/api\/agent\/april\/thread$/.test(s2.url || ''), (s2.url || '') + ' calls=' + s2.sendCalls);
  check('it sends the affirmative digit on the wire and its words in the bubble',
    s2.body && s2.body.text === '1' && s2.body.chose === 'Yes', JSON.stringify(s2.body));
  check('a placed grant takes the whole #d-qask box OFF screen (the "clear" half)',
    s2.qaskHidden, JSON.stringify(s2.qaskHidden));

  // ---- Scenario 3 (red-capable contrast): the folder-trust prompt HIDES the
  //      grant button even though its menu still looks affirmative ----
  await page.evaluate(async () => {
    window.__trust = true; window.__asking = true;
    // Clear any hold from the send above IN PLACE (TALK_ANSWERED is a page const).
    Object.keys(TALK_ANSWERED).forEach((k) => delete TALK_ANSWERED[k]);
    await paintTalk('april', 'April');
  });
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});
  const s3 = await page.evaluate(() => {
    const g = document.getElementById('d-qask-grant');
    const tr = document.getElementById('d-qask-trust-restart');
    return { grantHidden: !!g.hidden, trustShown: !tr.hidden, qaskShown: !document.getElementById('d-qask').hidden };
  });
  check('the box still paints on the trust prompt', s3.qaskShown, JSON.stringify(s3.qaskShown));
  check('the grant button is HIDDEN on the folder-trust prompt (Trust & Restart owns it)',
    s3.grantHidden, JSON.stringify(s3.grantHidden));
  check('and Trust & Restart is the shown action there', s3.trustShown, JSON.stringify(s3.trustShown));

  if (pageErrors.length) { console.error('PAGE ERRORS:\n  ' + pageErrors.join('\n  ')); }
  await browser.close();

  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;
  console.log('\nrender-qask-grant-2808: ' + (total - failed) + '/' + total + ' checks passed'
    + (pageErrors.length ? ' (with ' + pageErrors.length + ' page error(s))' : ''));
  process.exit(failed === 0 && pageErrors.length === 0 ? 0 : 1);
})();
