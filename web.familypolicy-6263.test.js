'use strict';
/* kosmos#6263 (board half): the Policies tab says a family's policy is the family's. The board sends the kind with
   the policy entry (server.js), and the page words both sentences through plusOrgIn (kosmos#6251). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };

test('#6263: the policy card and the policies line run through plusOrgIn with the entry the board sent', () => {
  const plusOrgIn = new Function(fn('function plusOrgIn(org, text)') + '\nreturn plusOrgIn;')();
  const card = fn('function polCompanyCard(c)');
  assert.match(card, /textContent = plusOrgIn\(c, 'Set by your company in its Kosmos policy\. Only your company can change or remove it\.'\)/);
  assert.match(PAGE, /company \? plusOrgIn\(company, 'Every agent gets your company\\'s policy below;/);
  assert.equal(plusOrgIn({ kind: 'family' }, 'Set by your company in its Kosmos policy. Only your company can change or remove it.'),
    'Set by your family in its Kosmos policy. Only your family can change or remove it.');
  assert.equal(plusOrgIn({ kind: 'company' }, 'Only your company can change or remove it.'), 'Only your company can change or remove it.');
  assert.match(SERVER, /company = \{ name: c\.name, chars: c\.text\.length, opening: c\.text\.slice\(0, 240\), kind: require\('\.\/engine\/orgenroll'\)\.kindNow\(\) \}/,
    'the board does not send the kind with the policy entry');
});
