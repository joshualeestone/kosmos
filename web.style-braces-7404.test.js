'use strict';
/**
 * kosmos#7404 (backupscreens-7404, challenge round 1): every <style> block in web/index.html closes every brace it opens.
 * A rule copied without its last line left one `{` open, and a browser with CSS nesting then read the ~470 lines after
 * it as nested inside that rule, so none of them matched (the Kosmos+ sign-in fields among them). Every per-property
 * check stayed green, because each read a property declared before the break. This counts braces with comments and
 * quoted strings removed, so a brace inside either is not counted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** The depth problems in one stylesheet's text: [] when balanced. Exported shape kept local; tested below. */
function braceProblems(css) {
  const t = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
  let depth = 0; let line = 1; const out = [];
  for (const ch of t) {
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) { out.push('a } with nothing open, line ' + line + ' of the block'); depth = 0; } }
  }
  if (depth !== 0) out.push(depth + ' { left open at the end of the block');
  return out;
}

test('the counter sees an unclosed rule, a stray close, and ignores braces in comments and strings', () => {
  assert.deepEqual(braceProblems('a { b: c; }\n'), []);
  assert.equal(braceProblems('a { b: c;\nd { e: f; }\n').length, 1);
  assert.equal(braceProblems('a { b: c; } }\n').length, 1);
  assert.deepEqual(braceProblems('/* { */ a { content: "{"; b: \'}\'; }\n'), []);
});

test('every <style> block in web/index.html is brace-balanced', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
  assert.ok(blocks.length >= 1, 'no <style> block read: the reader is broken, not the page');
  const bad = [];
  blocks.forEach((m, i) => { for (const p of braceProblems(m[1])) bad.push('style block ' + (i + 1) + ': ' + p); });
  assert.deepEqual(bad, [], 'a stylesheet in web/index.html does not close its braces:\n  ' + bad.join('\n  '));
});
