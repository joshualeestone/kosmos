'use strict';
/**
 * kosmos#3651 (Josh, 2026-09-24 17:05): "i want to put Grok right under Gemini in all
 * lists, so it would be Claude/OpenAI/Gemini/Grok."
 *
 * ONE order, PROVIDER_ORDER in web/index.html, read by every provider list. This check
 * loads the real page (file://, no server) and asserts, in the browser:
 *   - PROVIDER_ORDER itself starts Claude, OpenAI, Gemini, Grok;
 *   - each provider picker (#d-provider, #acct-provider-pick, #create-provider) has its
 *     options in that order, AND its visible logo combobox lists them in the same order;
 *   - the first-run provider list shows Claude, GPT, Gemini, Grok in that order;
 *   - the Settings account list's provider boxes come in that order even when the
 *     accounts arrive in the reverse order;
 *   - CONTROL: a picker whose options are shuffled (Grok before Gemini) is put back in
 *     order by orderProviderOptions, so the order comes from the constant and not only
 *     from how the HTML happens to be written.
 *
 * Run: NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-provider-order-3651.js
 */
const nodePath = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-provider-order-3651: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function ok(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { problems.push(name + (detail ? '  ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-provider-order-3651: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(PAGE);

  const r = await page.evaluate(() => {
    const FOUR = ['anthropic', 'openai', 'google', 'xai'];
    const canon = (v) => (PROVIDER_ORDER_ALIAS[v] || v);
    const out = { order: PROVIDER_ORDER.slice(), selects: {} };
    for (const id of ['d-provider', 'acct-provider-pick', 'create-provider']) {
      const sel = document.getElementById(id);
      const values = sel ? [...sel.options].map((o) => o.value).filter((v) => v !== '').map(canon) : null;
      const wrap = sel && sel.parentNode.querySelector('.pcombo');
      const shown = wrap ? [...wrap.querySelectorAll('.pcombo-opt')].map((li) => li.dataset.value).filter((v) => v !== '').map(canon) : null;
      const ranks = values ? values.map((v) => providerRank(v)) : [];
      out.selects[id] = {
        values, shown,
        firstFour: values ? values.slice(0, 4) : null,
        sorted: ranks.every((x, i) => i === 0 || ranks[i - 1] <= x),
        widgetMatches: !!(values && shown && values.join() === shown.join()),
      };
    }
    out.FOUR = FOUR;
    // First-run provider rows, in document order, keeping only the four that work.
    const fr = [...document.querySelectorAll('#firstrun .llm [data-pmark]')].map((e) => e.getAttribute('data-pmark'));
    out.firstrun = fr.filter((k) => ['claude', 'openai', 'gemini', 'xai'].includes(k));
    // Account boxes, fed in the REVERSE order.
    const html = accountGroupsHtml([
      { provider: 'xai', providerName: 'xAI Grok', keyTail: 'g' },
      { provider: 'google', providerName: 'Google Gemini', keyTail: 'm' },
      { provider: 'openai', providerName: 'OpenAI', email: 'o@x' },
      { provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'c@x' },
    ], () => '');
    out.accountHeads = [...html.matchAll(/acct-prov-name">([^<]+)</g)].map((m) => m[1]);
    // CONTROL: shuffle #d-provider so Grok precedes Gemini, then re-run the helper.
    const sel = document.getElementById('d-provider');
    const grok = sel.querySelector('option[value="xai"]');
    const gem = sel.querySelector('option[value="google"]');
    sel.insertBefore(grok, gem);
    const shuffled = [...sel.options].map((o) => o.value);
    orderProviderOptions('d-provider');
    out.control = { shuffled, after: [...sel.options].map((o) => o.value) };
    return out;
  });

  ok('PROVIDER_ORDER starts Claude, OpenAI, Gemini, Grok',
    JSON.stringify(r.order.slice(0, 4)) === JSON.stringify(r.FOUR), JSON.stringify(r.order));
  for (const [id, s] of Object.entries(r.selects)) {
    ok('#' + id + ' lists Claude, OpenAI, Gemini, Grok first', JSON.stringify(s.firstFour) === JSON.stringify(r.FOUR), JSON.stringify(s.values));
    ok('#' + id + ' is in PROVIDER_ORDER throughout', s.sorted, JSON.stringify(s.values));
    ok('#' + id + ' logo combobox shows the same order as its select', s.widgetMatches, JSON.stringify({ values: s.values, shown: s.shown }));
  }
  ok('first-run lists Claude, GPT, Gemini, Grok in that order',
    JSON.stringify(r.firstrun) === JSON.stringify(['claude', 'openai', 'gemini', 'xai']), JSON.stringify(r.firstrun));
  ok('Settings account boxes come in provider order even when listed in reverse',
    JSON.stringify(r.accountHeads) === JSON.stringify(['Anthropic / Claude', 'OpenAI', 'Google Gemini', 'xAI Grok']), JSON.stringify(r.accountHeads));
  ok('CONTROL: the shuffle applied (Grok before Gemini)',
    r.control.shuffled.indexOf('xai') < r.control.shuffled.indexOf('google'), JSON.stringify(r.control.shuffled));
  ok('CONTROL: orderProviderOptions puts a shuffled picker back in PROVIDER_ORDER',
    r.control.after.indexOf('google') < r.control.after.indexOf('xai'), JSON.stringify(r.control.after));
  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  if (problems.length) {
    console.error('render-provider-order-3651: ' + problems.length + ' problem(s)');
    process.exit(1);
  }
  console.log('render-provider-order-3651: every provider list reads PROVIDER_ORDER (Claude, OpenAI, Gemini, Grok).');
})().catch((err) => {
  console.error('FAIL  render-provider-order-3651: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
