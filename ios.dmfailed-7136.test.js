'use strict';
/**
 * kosmos#7136: the iPhone chat's failed line and Try again are the board's (web/index.html dmFailedLine and
 * dmRetrySend, kosmos#6720), in its words and by its rule. The phone's behaviour is tested in its own logic suite
 * (ios/LogicTests/main.swift, "the board's failed line and Try again"); this pins the two sources to each other, so a
 * change to either side that is not made to both goes red here.
 *
 *   node --test ios.dmfailed-7136.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BOARD = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SWIFT = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'BoardLogic.swift'), 'utf8');

/* One top-level function of the board (async or not), from its declaration to the closing brace at the start of a line. */
function boardFunction(src, name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  if (start < 0) return '';
  const end = src.indexOf('\n}\n', start);
  return end < 0 ? '' : src.slice(start, end + 2);
}

/* The phone's half: the failed-line extension and the row's canSendAgain. */
function swiftParts(src) {
  const ext = src.indexOf('static let failedWords');
  const extEnd = ext < 0 ? -1 : src.indexOf('\n}\n', ext);
  const can = src.indexOf('var canSendAgain: Bool {');
  return {
    ext: ext < 0 || extEnd < 0 ? '' : src.slice(ext, extEnd),
    can: can < 0 ? '' : src.slice(can, src.indexOf('\n        }\n', can)),
    parse: src.slice(src.indexOf('static func parseRows'), src.indexOf('static func parseRows') + 4000),
  };
}

/* Every way the two sides disagree, as sentences; [] when they agree. */
function pinProblems(board, swift) {
  const line = boardFunction(board, 'dmFailedLine');
  const retry = boardFunction(board, 'dmRetrySend');
  const phone = swiftParts(swift);
  const problems = [];
  const both = (what, boardHas, phoneHas) => {
    if (!boardHas) problems.push('the board no longer has ' + what);
    if (!phoneHas) problems.push('the phone no longer has ' + what);
  };
  if (!line) problems.push('dmFailedLine was not found in web/index.html');
  if (!retry) problems.push('dmRetrySend was not found in web/index.html');
  if (!phone.ext) problems.push('the failed-line extension was not found in BoardLogic.swift');
  // The words.
  both('"Message failed to deliver"', line.includes('>Message failed to deliver'), phone.ext.includes('static let failedWords = "Message failed to deliver"'));
  both('"try again"', line.includes("'try again'"), phone.ext.includes('"try again"'));
  both('"sending…"', line.includes("'sending\\u2026'"), phone.ext.includes('"sending\\u{2026}"'));
  both('the reason when the Mac gives none ("we could not reach them")', line.includes("'we could not reach them'"), phone.ext.includes('"we could not reach them"'));
  // The rule: retryable, newest, no reply, no files, no wire.
  both('the retryable condition', line.includes('m.delivery.retryable === true'), phone.can.includes('retryable'));
  both('the newest-only condition', /DM_NEWEST_MINE_AT === m\.at/.test(line) && line.includes('&& newest'), /newestMineAt == row\.atRaw/.test(phone.ext) && phone.ext.includes('&& newest'));
  both('the no-reply condition', line.includes('!m.replyTo'), phone.can.includes('replyTo == nil'));
  both('the no-files condition', line.includes('m.attachments.length'), phone.can.includes('attachments.isEmpty'));
  both('the no-wire condition', line.includes('!m.wire'), phone.parse.includes('resendable = failed && wire == nil'));
  // The retry: the same row, by retry_of, with the words as the row holds them.
  both('retry_of with the row\'s own words', retry.includes('JSON.stringify({ text: row.text, retry_of: at })'), phone.ext.includes('["text": text, "retry_of": at]'));
  // What is said after.
  for (const said of ["'Sent.'", "'We could not confirm it went. Check its window before sending it again.'", "'Message failed to deliver.'",
    "'We could not reach Kosmos, so we cannot tell whether it went. Look at the conversation before trying again.'", "'we could not send it again'"]) {
    both('the line ' + said, retry.includes(said), phone.ext.includes('"' + said.slice(1, -1) + '"') || (said === "'Message failed to deliver.'" && phone.ext.includes('failedWords + "."')));
  }
  return problems;
}

test('the phone\'s failed line and Try again match the board\'s dmFailedLine and dmRetrySend', () => {
  assert.deepEqual(pinProblems(BOARD, SWIFT), []);
});

test('CONTROL: the pin goes red when either side changes alone', () => {
  const words = pinProblems(BOARD.replace("(flying ? 'sending\\u2026' : 'try again')", "(flying ? 'sending\\u2026' : 'retry')"), SWIFT);
  assert.ok(words.some((p) => /board no longer has "try again"/.test(p)), words.join('; '));
  const rule = pinProblems(BOARD, SWIFT.replace('&& replyTo == nil', ''));
  assert.ok(rule.some((p) => /phone no longer has the no-reply condition/.test(p)), rule.join('; '));
  const route = pinProblems(BOARD.replace('retry_of: at })', 'reply_to: at })'), SWIFT);
  assert.ok(route.some((p) => /retry_of/.test(p)), route.join('; '));
  assert.ok(pinProblems('', SWIFT).includes('dmFailedLine was not found in web/index.html'), 'a board without the function is reported, not passed');
});
