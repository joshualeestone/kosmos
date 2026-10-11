'use strict';
/* #5805 slice 3: a capped Claude card says "Out of usage until <time>" from its limitUntil while the reset is ahead,
 * and says nothing about a time that has passed (its limit line stays on screen until something is typed).
 * The page's own functions, lifted out of index.html and run.
 *   node --test web.limituntil-5805.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function src(name) {
  const m = PAGE.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  return m[0];
}
const stateReason = new Function(src('quotaResetWords') + src('stateReason') + '\nreturn stateReason;')();

test('#5805 slice 3: a capped Claude card says when its usage comes back, and never a past time', () => {
  const ahead = new Date(Date.now() + 2 * 3600e3).toISOString();
  // Read off the screen: hedged (#215). Reported: said plainly.
  const said = stateReason({ state: 'rate_limited', stateConfidence: 'scraped', limitUntil: ahead });
  assert.match(said, /^Looks like a usage limit until \d{1,2}:\d{2}/, said);
  const reported = stateReason({ state: 'rate_limited', stateConfidence: 'structured', limitUntil: ahead });
  assert.match(reported, /^Out of usage until \d{1,2}:\d{2}/, reported);
  const past = new Date(Date.now() - 60e3).toISOString();
  assert.equal(stateReason({ state: 'rate_limited', stateConfidence: 'scraped', limitUntil: past }), 'Looks like a usage limit');
  assert.equal(stateReason({ state: 'rate_limited', stateConfidence: 'scraped', limitUntil: null }), 'Looks like a usage limit', 'CONTROL: no reset read');
  // An Antigravity quota keeps its own wording (its arm comes first).
  assert.match(stateReason({ state: 'rate_limited', quotaUntil: ahead, limitUntil: ahead }), /^Usage limit reached\. The Google quota resets at /);
});
