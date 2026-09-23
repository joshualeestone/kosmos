'use strict';
// Browser-check-surface: data-pmark="gemini"
/**
 * kosmos#3422: the Gemini provider mark paints in the enhanceProviderSelect combobox.
 *
 * The bug: the firstrun `[data-pmark="gemini"]` span was a radialGradient with a fixed id
 * (`fill="url(#pmark-gemini-g)"`). `providerMarkNode('google')` CLONES that span into the
 * settings / create-agent provider combobox; a cloned gradient-url reference collides on the
 * duplicated id and renders BLANK, while the monochrome `currentColor` marks (Claude, OpenAI,
 * ...) clone fine. So Gemini alone showed no mark ("where the others show theirs, Gemini
 * shows none"). The fix replaces it with Josh's monochrome `currentColor` path.
 *
 * This drives the REAL clone path: it calls the shipped `providerMarkNode('google', ...)`,
 * inserts the returned node under a known `color`, and asserts the mark is a non-empty SVG
 * path that inherits `currentColor` (so it actually paints the ink), carries no `url(#...)`
 * gradient dependency, and is not the fallback initial-letter chip. Claude is the positive
 * control (a mark that always worked); a synthetic gradient node is the negative control
 * (the paint check must reject it), so neither assertion is vacuous.
 *
 * Run: NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-gemini-logo-3422.js
 *      (HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-gemini-logo-3422: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const problems = [];
function ok(name, cond, detail) { if (!cond) problems.push(name + (detail ? '  ' + detail : '')); else console.log('PASS  ' + name); }

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-gemini-logo-3422: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, colorScheme: theme });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);
    const t = '[' + theme + '] ';

    const r = await page.evaluate(() => {
      if (typeof providerMarkNode !== 'function') return { fatal: 'providerMarkNode is not defined' };
      // The exact clone the combobox uses. INK is a distinctive color so a currentColor mark
      // resolves to it and a broken (transparent / gradient) one does not.
      const INK = 'rgb(3, 5, 7)';
      const paint = (node) => {
        const host = document.createElement('div');
        host.style.color = INK;
        host.style.position = 'absolute';
        host.style.left = '-9999px';
        host.appendChild(node);
        document.body.appendChild(host);
        const svg = node.querySelector('svg');
        const path = node.querySelector('svg path');
        const res = {
          isChip: node.classList.contains('pcombo-chip'),
          hasSvg: !!svg,
          hasPath: !!path,
          pathD: path ? (path.getAttribute('d') || '') : '',
          // A gradient dependency is a fill/stroke ATTRIBUTE of `url(#...)`, read off the
          // elements, not the innerHTML (which can carry an explanatory comment mentioning
          // the old id).
          urlFill: [svg, ...(svg ? svg.querySelectorAll('*') : [])].filter(Boolean)
            .some((el) => ['fill', 'stroke'].some((a) => /url\(#/.test(el.getAttribute(a) || ''))),
          // currentColor resolves to the host color; a gradient/transparent fill does not.
          fill: path ? getComputedStyle(path).fill : (svg ? getComputedStyle(svg).fill : ''),
        };
        host.remove();
        return res;
      };

      const gem = paint(providerMarkNode('google', 'Google Gemini'));
      const claude = paint(providerMarkNode('anthropic', 'Claude'));

      // Negative control: a `url(#...)` gradient fill must NOT read as painting the ink AND
      // must be detected as a url dependency, so both gemini assertions below can actually
      // fail on the pre-fix shape. Built via DOM APIs with a runtime-concatenated id so the
      // source carries no literal `#name` (the browser-check selector linter reads those as
      // page-id references).
      const SVGNS = 'http://www.w3.org/2000/svg';
      const grad = document.createElement('span');
      const gsvg = document.createElementNS(SVGNS, 'svg');
      const gpath = document.createElementNS(SVGNS, 'path');
      gpath.setAttribute('d', 'M0 0h10v10H0Z');
      gpath.setAttribute('fill', 'url(' + '#' + 'grProbe' + ')');
      gsvg.appendChild(gpath);
      grad.appendChild(gsvg);
      const gradPainted = paint(grad);

      return { INK, gem, claude, gradFill: gradPainted.fill, gradUrlFill: gradPainted.urlFill };
    });

    if (r.fatal) { ok(t + r.fatal, false); await page.close(); continue; }

    // Positive control first: if Claude (a mark that always worked) does not paint the ink,
    // the harness is wrong and the gemini result proves nothing.
    ok(t + 'CONTROL: the Claude mark paints the ink (harness works)', r.claude.hasPath && r.claude.fill === r.INK, JSON.stringify(r.claude.fill));
    // Negative control: a gradient fill must NOT read as the ink, or the fill check is vacuous.
    ok(t + 'CONTROL: a gradient-fill svg does NOT read as the ink', r.gradFill !== r.INK, JSON.stringify(r.gradFill));
    ok(t + 'CONTROL: a gradient fill IS detected as a url(#...) dependency', r.gradUrlFill === true, JSON.stringify(r.gradUrlFill));

    ok(t + 'the Gemini mark is an svg with a non-empty path (not the fallback chip)', r.gem.hasSvg && r.gem.hasPath && r.gem.pathD.length > 20 && !r.gem.isChip, JSON.stringify({ hasSvg: r.gem.hasSvg, hasPath: r.gem.hasPath, dLen: r.gem.pathD.length, isChip: r.gem.isChip }));
    ok(t + 'the cloned Gemini mark carries NO url(#...) gradient dependency', r.gem.urlFill === false, JSON.stringify(r.gem.urlFill));
    ok(t + 'the Gemini mark paints the currentColor ink (not blank), the clone-blank fix', r.gem.fill === r.INK, JSON.stringify(r.gem.fill));

    ok(t + 'no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
  }

  await browser.close();
  if (problems.length) { console.error('\n' + problems.length + ' FAILED'); problems.forEach((p) => console.error('  FAIL  ' + p)); process.exit(1); }
  console.log('\nall Gemini-mark checks passed');
})();
