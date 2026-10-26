'use strict';

/**
 * #5481: the microphone permission lines the card waits on must be readable on a person's Mac. logLine writes only
 * the test harness's file (/tmp/kosmos-app-test, which a real Mac does not have), so those lines went nowhere. They
 * now go through logToSystem, which also writes macOS's unified log. Only lines built from fixed words, states and
 * times may: logLine's other callers carry the board URL with its token (#1946), page titles and file names, so
 * logLine itself must never write the unified log.
 *   node --test native-app.applog-5481.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

/* The body of `func <name>(_ s: String)`, from its opening brace to the matching close. */
function bodyOf(name) {
  const at = SRC.indexOf('func ' + name + '(_ s: String) {');
  assert.ok(at >= 0, 'CONTROL: func ' + name + '(_ s: String) is gone from main.swift');
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) return SRC.slice(open + 1, i); }
  }
  throw new Error('CONTROL: ' + name + ' has no closing brace');
}

/* Each `logToSystem(` call outside its own definition, with its full argument text (to the matching paren). */
function systemCalls() {
  const out = [];
  const re = /logToSystem\(/g;
  let m;
  while ((m = re.exec(SRC))) {
    if (SRC.slice(Math.max(0, m.index - 5), m.index) === 'func ') continue;
    let depth = 0;
    for (let i = m.index + 'logToSystem'.length; i < SRC.length; i += 1) {
      if (SRC[i] === '(') depth += 1;
      else if (SRC[i] === ')') { depth -= 1; if (depth === 0) { out.push(SRC.slice(m.index, i + 1)); break; } }
    }
  }
  return out;
}

test('#5481: logLine never writes the unified log (its callers carry the board token, titles and file names)', () => {
  const body = bodyOf('logLine');
  assert.ok(body.includes('logFilePath'), 'CONTROL: this is not logLine\'s body');
  assert.doesNotMatch(body, /NSLog|os_log|Logger\(|logToSystem/, 'logLine writes the unified log: every caller\'s line, the tokenized board URL among them, would be kept there for days');
});

test('#5481: logToSystem writes the unified log with a fixed format, and the harness file too', () => {
  const body = bodyOf('logToSystem');
  assert.match(body, /NSLog\("%@", s\)/, 'logToSystem does not write the unified log');
  assert.doesNotMatch(body, /NSLog\(s\)/, 'NSLog with the line as its format string');
  assert.match(body, /logLine\(s\)/, 'the harness file no longer gets the line');
});

test('#5481: only the two microphone permission lines and the two tls-pin lines (kosmos#6589) go to the unified log, and none carries a URL, title, name or path', () => {
  const calls = systemCalls();
  assert.equal(calls.length, 5, 'logToSystem has ' + calls.length + ' callers; each new one needs its content checked and this count raised:\n' + calls.join('\n'));
  assert.ok(calls.some((c) => c.startsWith('logToSystem("voice: back from Settings (')), 'the return-from-Settings line is not one of them');
  assert.ok(calls.some((c) => c.startsWith('logToSystem("voice: speech permission ')), 'the speech permission answer line is not one of them');
  // kosmos#6589 follow-up: an S-7c refusal and an unanswered pin ask, in fixed words (no host), so a person's Mac keeps them.
  assert.ok(calls.some((c) => c.startsWith('logToSystem(mismatch ? "tls-pin: refused a computer: ')), 'the tls-pin refusal line is not one of them');
  assert.ok(calls.some((c) => c.startsWith('logToSystem("tls-pin: the board did not answer (status ')), 'the tls-pin unanswered-ask line is not one of them');
  // kosmos#7193 review 2: a refusal held back while an alert is on screen, fixed words, no computer name.
  assert.ok(calls.some((c) => c === 'logToSystem("tls-pin: an alert or another sheet is already on screen, so this refusal is not shown")'), 'the held-back line is not one of them');
  // The tls-pin lines may interpolate only the HTTP status and concatenate nothing, so no computer address (or any other
  // value a person or a page chose) can reach the unified log through them, whatever a variable is called.
  for (const c of calls.filter((x) => x.includes('tls-pin'))) {
    const rest = c.replace('\\(code.map(String.init) ?? "none")', '');
    assert.doesNotMatch(rest, /\\\(|\+/, 'a tls-pin unified-log line interpolates or concatenates something besides the HTTP status: ' + c);
  }
  for (const c of calls) {
    assert.doesNotMatch(c, /url|URL|absoluteString|title|Title|path|Path|name\b|token|Token|body\[/, 'a unified-log line carries something a page, a person or the board token could be in: ' + c);
  }
});
