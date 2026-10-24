'use strict';
/*
 * kosmos#6734: the cap is 100 MB, but Kosmos waits five minutes for a whole upload. When a large file's upload fails
 * at the network, the page says that a slow connection can outlast the wait; a small one keeps the plain sentence.
 * The page's own attachUpload runs here, with a fetch that fails.
 *
 *   node --test web.attach-slow-6734.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function asyncFnSource(name) {
  const start = PAGE.indexOf('async function ' + name + '(');
  assert.notEqual(start, -1, name + ' is gone from the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const consts = ['ATTACH_MAX_BYTES', 'ATTACH_SLOW_BYTES'].map((n) => {
  const m = PAGE.match(new RegExp('const ' + n + ' = [^;]+;'));
  assert.ok(m, n + ' is gone from the page');
  return m[0];
});

async function failedUpload(size, fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'))) {
  const el = { textContent: '', disabled: false, focus() {} };
  const run = new Function('document', 'fetch', 'attachTarget', 'attachList', 'attachAdd',
    consts.join('\n') + '\nconst ATTACH_MAX = 10;\nlet ATTACH_UPLOADING = 0;\n' + asyncFnSource('attachUpload') + '\nreturn attachUpload;');
  const attachUpload = run({ getElementById: () => el }, fetchImpl,
    () => true, () => [], () => {});
  await attachUpload({ name: 'clip.mov', size, type: 'video/quicktime' }, { msgId: 'm', textId: 't', btnId: 'b', url: () => '/x' });
  return el.textContent;
}

test('#6734: a large upload that fails at the network says a slow connection can outlast the wait', async () => {
  const MB = 1024 * 1024;
  const big = await failedUpload(60 * MB);
  // Review 10: it names both causes, since the page cannot tell Kosmos being unreachable from the wait running out.
  assert.equal(big, 'We could not reach Kosmos to add clip.mov. If your connection is slow, a file this large can take longer than Kosmos waits for one.');
  assert.ok(!big.includes(String.fromCharCode(0x2014)), 'no em dash');
  // CONTROL: a small one keeps the plain sentence, so the size decides it.
  assert.equal(await failedUpload(MB), 'We could not reach Kosmos to add that file.');
});

test('#6734: an upload that timed out (408) says it took too long to arrive, whatever the size', async () => {
  // Node answers its request timeout with 408 rather than dropping the connection (measured on Node 26), so fetch
  // resolves and the catch never runs: this is the path a slow upload takes.
  const timedOut = () => Promise.resolve({ ok: false, status: 408, json: () => Promise.reject(new SyntaxError('not json')) });
  for (const size of [60 * 1024 * 1024, 1024]) {
    assert.equal(await failedUpload(size, timedOut),
      'We could not finish adding clip.mov: it took too long to arrive. Try again on a faster connection.');
  }
  // CONTROL: another failed status keeps the generic sentence.
  const other = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('not json')) });
  assert.equal(await failedUpload(1024, other), 'We could not add that file (status 502).');
  // Review 17: a large file's 502 or 504 (the tunnel cutting a slow upload) gets the slow-connection sentence.
  for (const status of [502, 504]) {
    const cut = () => Promise.resolve({ ok: false, status, json: () => Promise.reject(new SyntaxError('not json')) });
    assert.equal(await failedUpload(60 * 1024 * 1024, cut),
      'We could not reach Kosmos to add clip.mov. If your connection is slow, a file this large can take longer than Kosmos waits for one.');
  }
  const refusedWithWords = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'the board said why' }) });
  assert.equal(await failedUpload(60 * 1024 * 1024, refusedWithWords), 'the board said why', 'CONTROL: a sentence from the board wins');
});
