'use strict';

/**
 * #3942: the code a paste into a Kosmos+ sign-in code field takes, run from the page's real
 * plusSiCodeFromPaste. A wrong guess is sent as a wrong code (each counts toward the sign-in's
 * too-many-tries limit), so the finder takes exactly one six-digit run or nothing. The rest of the
 * code boxes (auto-submit, paste replaces, caret) are covered in a real browser by
 * docs/browser-checks/render-plus-signin-3478.js.
 *
 *   node --test web.codebox-3942.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

const find = vm.runInNewContext(fnSource('plusSiCodeFromPaste') + '\nplusSiCodeFromPaste');

test('the code alone, however it is split', () => {
  for (const t of ['123456', '123 456', '123-456', ' 123456\n', '1 2 3 4 5 6']) assert.equal(find(t), '123456', JSON.stringify(t));
});

test('a code inside an email line, beside numbers that are not codes', () => {
  assert.equal(find('Your Kosmos+ code is 482 913. Ref 20260926.'), '482913');
  assert.equal(find('Sent 2026-09-26. Your code is 123 456.'), '123456', 'a date is not a code');
  assert.equal(find('Call 555-123-4567 or use 987654'), '987654', 'a phone number is not a code');
});

test('two six-digit numbers: the one after "code", else neither', () => {
  assert.equal(find('Order #482913. Code: 123456'), '123456');
  assert.equal(find('Order 482913 and 123456'), '', 'no way to tell which is the code: send nothing');
});

test('nothing that is not exactly one six-digit code', () => {
  for (const t of ['', '12345', '1234567', 'ID 1234567890', 'no digits here', null, undefined]) assert.equal(find(t), '', JSON.stringify(t));
});

test('other separators a code arrives with: any space, two spaces, a dot, a dash with spaces', () => {
  for (const t of ['123 456', '123 456', '123\t456', '123  456', '123.456', '123 – 456', '123—456']) {
    assert.equal(find(t), '123456', JSON.stringify(t));
  }
});

test('a full stop and a space end a sentence: a code then a year is a code', () => {
  assert.equal(find('Your code: 482913. 2026 is almost over.'), '482913');
});

test('"code" as a word only: a zipcode or barcode number is not picked', () => {
  assert.equal(find('Ref 111111, zipcode 222222'), '', 'two numbers and no word "code": nothing');
  assert.equal(find('Ref 111111, your code 222222'), '222222');
});
