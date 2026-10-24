// Browser-check-surface: tkr-line tkr-agent
'use strict';

/**
 * kosmos#6842 slice 1: a closed task's receipt names the pull requests each agent worked on while it held the task.
 *
 * ⚠️ WHY A BROWSER. web.receipt-5153.test.js reads the HTML string tkReceiptPrsHtml returns. It cannot see whether
 * that line RENDERS: a link that is really an <a> in the real page, a long repository name that wraps instead of
 * pushing the line past its box on a phone, and a URL that is not a github.com pull request painted as plain text.
 * This drives the page's real tkReceiptHtml into a real DOM at phone and desktop widths and reads what painted.
 *
 * HERMETIC: file://, no board, no fetch. Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-task-receipt-prs-6842.js
 * HEADED by default, as the other checks here; HEADED=0 on a machine with no console session (the verdicts are the
 * same: it reads the computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-task-receipt-prs-6842: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
// No hyphen and no other break point: Chromium breaks after a hyphen, so a hyphenated name wraps with or without a
// wrap rule and could not catch an overflow (challenge iteration 8). GitHub allows a name of letters only.
const LONG = 'example/arepositorynamelongenoughtoneedwrappingonaphonewithnohyphen';
const RECEIPT = {
  closedAt: '2026-10-21T15:00:00.000Z',
  retries: { reopened: 0, handoffs: 0 },
  agents: [{
    who: 'ann', available: true, provider: 'claude', transcriptsWithWork: 1, commands: 2, files: [], filesMore: 0,
    models: { 'claude-opus-5-5': { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 3 } },
    prs: [
      { repo: LONG, number: 12345, url: 'https://github.com/' + LONG + '/pull/12345' },
      { repo: 'example/app', number: 7, url: 'javascript:alert(1)' },
    ],
    prsMore: 2,
  }],
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-task-receipt-prs-6842: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const problems = [];
  try {
    for (const width of [390, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate((receipt) => {
        if (typeof tkReceiptHtml !== 'function') return { error: 'tkReceiptHtml is not a function' };
        // A holder of the receipt's own class, visible, in the page's own stylesheet (the real one sits in a task view
        // this check does not open).
        const holder = document.createElement('div');
        holder.className = 'tkreceipt';
        holder.style.cssText = 'display:block;max-width:100%;';
        document.body.prepend(holder);
        holder.innerHTML = tkReceiptHtml(receipt, { id: 'p', agents: [] });
        const line = [...holder.querySelectorAll('.tkr-line')].find((l) => /pull request/.test(l.textContent || ''));
        if (!line) return { error: 'no pull request line painted', html: holder.innerHTML.slice(0, 400) };
        const links = [...line.querySelectorAll('a')];
        const box = line.getBoundingClientRect();
        return {
          text: (line.textContent || '').replace(/\s+/g, ' ').trim(),
          links: links.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), right: a.getBoundingClientRect().right })),
          height: box.height, right: box.right, scrollW: line.scrollWidth, clientW: line.clientWidth, vw: window.innerWidth,
        };
      }, RECEIPT);
      await page.close();
      const at = '@' + width + 'px: ';
      if (r.error) { problems.push(at + r.error + (r.html ? ' ' + r.html : '')); continue; }
      if (!/^Worked on pull requests /.test(r.text)) problems.push(at + 'the line does not read "Worked on pull requests": ' + r.text);
      if (!/and 2 more\.$/.test(r.text)) problems.push(at + 'the agent\'s uncounted pull requests are not said: ' + r.text);
      if (r.links.length !== 1) problems.push(at + 'expected exactly one link (the javascript: URL must paint as text): ' + JSON.stringify(r.links));
      else {
        const a = r.links[0];
        if (a.href !== 'https://github.com/' + LONG + '/pull/12345') problems.push(at + 'the link goes to ' + a.href);
        if (a.target !== '_blank' || !/noopener/.test(a.rel || '')) problems.push(at + 'the link opens without target=_blank rel=noopener');
        if (a.right > r.vw + 1) problems.push(at + 'the link paints past the window: right ' + a.right + ' > ' + r.vw);
      }
      if (!(r.height > 0)) problems.push(at + 'the line has no height (did not paint)');
      if (r.scrollW > r.clientW + 1) problems.push(at + 'the line overflows its box: scrollWidth ' + r.scrollW + ' > ' + r.clientW);
      if (r.right > r.vw + 1) problems.push(at + 'the line paints past the window: right ' + r.right + ' > ' + r.vw);
    }
  } finally { await browser.close(); }
  if (problems.length) {
    console.error('FAIL  render-task-receipt-prs-6842:');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-task-receipt-prs-6842: the receipt\'s pull request line paints one safe github.com link, wraps at 390px, and counts the rest');
})();
