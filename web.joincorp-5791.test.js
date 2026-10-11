'use strict';
/* kosmos#5791 (Josh 10-10 14:32): joining a company. An outlined "Join Corporate Account" button; opened, an X Cancel
   and one sentence, a code field and Connect Account, which joins with no preview step (the company decided). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const org = PAGE.slice(PAGE.indexOf('<div id="plus-org" hidden'), PAGE.indexOf('<p class="fmsg" id="plus-org-msg"'));
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at)); };

test('#5791: the opener is an outlined button with an icon, and the entry pane has X Cancel, the new copy and Connect Account', () => {
  assert.match(org, /<button type="button" class="btn plus-org-open" id="plus-org-open"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Join Corporate Account<\/button>/);
  assert.match(org, /id="plus-org-cancel"><span aria-hidden="true">&#x2715;<\/span> Cancel<\/button>/);
  assert.match(org, /Enter your company's code to connect your Kosmos to your corporate enterprise account\./);
  assert.match(org, /id="plus-org-check">Connect Account<\/button>/);
  assert.doesNotMatch(PAGE, /Joining a company\? Enter its join code|Check code<\/button>|Join with this Kosmos|id="plus-org-consent"|id="plus-org-review"/, 'the old opener, check step, consent box or Review button is back');
});

test('#5791: Connect Account asks for the terms and joins at once, with the ticket, showing nothing in between', () => {
  const c = fn('async function plusOrgConnect()');
  assert.ok(c.length > 100, 'plusOrgConnect is gone');
  const pv = c.indexOf("plusOrgPost('preview'");
  const en = c.indexOf("plusOrgPost('enroll'");
  assert.ok(pv > 0 && en > pv, 'it does not preview and then enroll');
  assert.match(c.slice(pv, en), /if \(!p\.ok\) \{ msg\.textContent = /, 'a refused code is not said under the field');
  assert.doesNotMatch(c.slice(pv, en), /plusOrgList|plus-org-consent|\.hidden = false/, 'something is shown between the two calls');
  assert.match(c.slice(en), /accepted: true, ticket: p\.ticket/, 'the join does not carry the ticket');
  assert.match(PAGE, /getElementById\('plus-org-check'\)\.addEventListener\('click', plusOrgConnect\)/);
  assert.match(PAGE, /getElementById\('plus-org-cancel'\)\.addEventListener\('click', plusOrgCancel\)/);
});

test('#5791: Cancel closes the pane and clears the code; the "Your company" title shows only over the joined view', () => {
  const x = fn('function plusOrgCancel()');
  assert.match(x, /PLUS_ORG\.open = false/);
  assert.match(x, /getElementById\('plus-org-code'\)\.value = ''/);
  assert.match(fn('function plusOrgPaint()'), /getElementById\('plus-org-title'\)\.hidden = !here/);
});
