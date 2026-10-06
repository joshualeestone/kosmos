'use strict';
/**
 * kosmos#5311: every reason the Mac app's VoiceBridge.endReason can return has its own sentence in the page's
 * VOICE_SAYS, so a new native reason can never fall to the catch-all by omission (Josh's mic said "Listening stopped
 * because of an error" when macOS had refused because Dictation was off, kLSRErrorDomain 201).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SWIFT = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function endReasonBody() {
  const start = SWIFT.indexOf('static func endReason(domain: String, code: Int) -> String {');
  assert.ok(start > 0, 'endReason moved; this guard reads nothing');
  return SWIFT.slice(start, SWIFT.indexOf('\n    }\n', start));
}
function voiceSays() {
  const m = PAGE.match(/const VOICE_SAYS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'VOICE_SAYS moved; this guard reads nothing');
  return new Set([...m[1].matchAll(/^\s*'([a-z-]+)':/gm)].map((x) => x[1]));
}

test('#5311 every non-empty reason endReason returns has a sentence on the page', () => {
  // Review 1: any spelling of a reason literal, not only lowercase-and-dash.
  const reasons = [...endReasonBody().matchAll(/return "([^"]*)"/g)].map((x) => x[1]).filter(Boolean);
  assert.ok(reasons.length >= 3, 'too few reasons read, so this proves nothing: ' + reasons.join(','));
  const says = voiceSays();
  for (const r of reasons) assert.ok(says.has(r), `endReason returns "${r}" but VOICE_SAYS has no sentence for it`);
});

test('#5311 Dictation off is mapped natively and said honestly on the page', () => {
  assert.match(endReasonBody(), /domain == "kLSRErrorDomain" && code == 201 \{ return "dictation-off" \}/);
  const m = PAGE.match(/'dictation-off': '([^']+)'/);
  assert.ok(m, 'no dictation-off sentence');
  assert.match(m[1], /Dictation is turned off/);
  assert.match(m[1], /System Settings, Keyboard, Dictation/);
  assert.doesNotMatch(m[1], /—/);
});

test('#5311 review 1: every reason the bridge REFUSES with (refuse("...")) has a page sentence too', () => {
  const start = SWIFT.indexOf('final class VoiceBridge');
  const body = start > 0 ? SWIFT.slice(start, SWIFT.indexOf('\nfinal class ', start + 10) > 0 ? SWIFT.indexOf('\nfinal class ', start + 10) : undefined) : SWIFT;
  const refused = [...body.matchAll(/refuse\("([^"]+)"/g)].map((x) => x[1]);
  assert.ok(refused.length >= 3, 'too few refusals read, so this proves nothing: ' + refused.join(','));
  const says = voiceSays();
  for (const r of refused) assert.ok(says.has(r), `the bridge refuses with "${r}" but VOICE_SAYS has no sentence for it`);
});
