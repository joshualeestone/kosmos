'use strict';

/**
 * #3692 (Josh's rule, 2026-09-24, recorded in .claude/plans/help-tips-3574.md): no solid
 * coloured left bars. A card, note or warning is marked with a full hairline border or a
 * tinted background, never a stripe down its left edge.
 *
 * This scans every <style> block in web/index.html, comments removed, for a left bar two
 * pixels or wider: `border-left: <w>px solid <colour>` or `box-shadow: inset <w>px 0 0 ...`.
 * Each one found must belong to a selector in ALLOWED, which lists the few places where a
 * left rule is not a card bar. Hairline separators (under 2px) and transparent borders
 * (CSS triangles) are not bars and are not counted.
 * It reads only those two shorthand forms with px widths. A bar written another way (a
 * border-left-width longhand, border-inline-start, rem units, a bar set in a JS style string)
 * is not seen; none exists in the page today.
 *
 *   node --test web.no-left-bars-3692.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* selector (as written, whitespace collapsed) -> why its left rule is allowed */
const ALLOWED = new Map([
  ['.dm-b .mdq, .pj-msg-text .mdq, .msg-b .mdq, .tkdetail .mdq', 'a quote: the rule is how a quote reads (#3692 scope)'],
  ['.msg .quoteb', 'a quote inside a message (#3692 scope, Josh can overrule)'],
  ['.detail-said', 'a quote: the agent\'s own words (Liu Kang, 2026-09-25, Josh can overrule)'],
  ['.msg-replyto', 'a quote: the message a reply answers, inside the reply (#3745; same call as .msg .quoteb)'],
  ['body:not(.consolidated) #pj-list:not(.asgrid) .pj-row.child', 'the project tree indent guide, not a card'],
  ['body:not(.consolidated).pj-roadmap #pj-list:not(.asgrid) .pj-row.child::before', 'the roadmap tree connector line, not a card'],
]);

function styleText(html) {
  const out = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

/* Every left bar of 2px or more, with the selector of the rule it sits in. */
function leftBars(css) {
  const found = [];
  const re = /border-left\s*:\s*(\d*\.?\d+)px\s+solid\s+([^;}]+)|box-shadow\s*:\s*inset\s+(\d*\.?\d+)px\s+0\s+0\b/g;
  let m;
  while ((m = re.exec(css))) {
    const width = parseFloat(m[1] || m[3]);
    if (width < 2) continue;
    if (m[2] && /^transparent\b/.test(m[2].trim())) continue;
    const open = css.lastIndexOf('{', m.index);
    const start = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1)) + 1;
    const selector = css.slice(start, open).replace(/\s+/g, ' ').trim();
    found.push({ selector, decl: m[0].trim() });
  }
  return found;
}

test('#3692: no card, note or warning has a solid left bar', () => {
  const bars = leftBars(styleText(PAGE));
  const offenders = bars.filter((b) => !ALLOWED.has(b.selector));
  assert.deepEqual(offenders, [], 'left bars outside the allowed list:\n' +
    offenders.map((b) => `  ${b.selector} { ${b.decl} }`).join('\n'));
});

test('#3692 control: the scanner flags a bar, and ignores a hairline, a triangle and a comment', () => {
  const css = styleText('<style>.a { border-left: 2px solid var(--warn-ink); }\n' +
    '.b { box-shadow: inset 3px 0 0 red; }\n.c { border-left: 0.5px solid var(--separator); }\n' +
    '.d { border-left: 4px solid transparent; }\n/* .e { border-left: 3px solid red; } */</style>');
  assert.deepEqual(leftBars(css).map((b) => b.selector), ['.a', '.b']);
});

test('#3692 control: every allowed selector still has its left rule, so the list cannot go stale', () => {
  const seen = new Set(leftBars(styleText(PAGE)).map((b) => b.selector));
  for (const sel of ALLOWED.keys()) assert.ok(seen.has(sel), `allowed selector no longer has a left bar: ${sel}`);
});
