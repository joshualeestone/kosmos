'use strict';

/**
 * #5481: the native app's log lines must reach somewhere on a person's Mac. logLine wrote only to the test harness's
 * file ($KOSMOS_APP_LOG, else /tmp/kosmos-app-test/app.log, a folder a real Mac does not have), so every native
 * diagnostic, the microphone permission lines #5481 waits on among them, was written nowhere. It now also writes the
 * unified log (NSLog), readable with: log show --last 1d --predicate 'process == "Kosmos"'.
 *   node --test native-app.applog-5481.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

/* The body of `func logLine`, from its opening brace to the matching close. */
function logLineBody() {
  const at = SRC.indexOf('func logLine(_ s: String) {');
  assert.ok(at >= 0, 'CONTROL: func logLine(_ s: String) is gone from main.swift');
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) return SRC.slice(open + 1, i); }
  }
  throw new Error('CONTROL: logLine has no closing brace');
}

test('#5481: every logLine line goes to the unified log, before and whatever the file write does', () => {
  const body = logLineBody();
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  assert.equal(lines[0], 'NSLog("%@", s)', 'logLine does not write the unified log first, so a person\'s Mac records nothing');
  // The format string keeps a % in a line from being read as a format (NSLog(s) would).
  assert.doesNotMatch(body, /NSLog\(s\)/, 'NSLog with the line as its format string');
  // The test harness still gets its file (tools/test-install.sh sets KOSMOS_APP_LOG and reads it).
  assert.match(body, /FileHandle\(forWritingAtPath: logFilePath\)/, 'the harness file write is gone');
});

test('#5481: the microphone permission lines the card waits on are written through logLine', () => {
  assert.match(SRC, /logLine\("voice: back from Settings \("/, 'the return-from-Settings line no longer goes through logLine');
  assert.match(SRC, /logLine\("voice: speech permission "/, 'the speech permission answer line no longer goes through logLine');
});

test('#5481: a voice error is logged to the unified log exactly once (#5311 kept, no duplicate)', () => {
  const at = SRC.indexOf('let said = "voice: ended, "');
  assert.ok(at >= 0, 'CONTROL: the #5311 voice-ended line is gone');
  const block = SRC.slice(at, SRC.indexOf('emit(["kind": "error", "reason": reason])', at));
  // Our own stop (empty reason): NSLog directly. A real error: logLine, which now writes the unified log itself.
  assert.match(block, /if reason\.isEmpty \{ NSLog\("%@", said\) \} else \{\s*logLine\(said\)/, 'the voice-ended line is not logged once either way');
});
