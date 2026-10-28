'use strict';
/* kosmos#7508: the Tasks row says which change a code fix was saved as (Mona Lisa's words), on open and closed rows,
   in the row's quiet text, and "only on this computer so far" while no remote has it. From the page's real tskRow. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
  page.liftAll(SCRIPT, ['pjChainText', 'pjChainSpoken', 'tskChainOf', 'tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [],
  (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), () => 'just now', (x) => x.projectId + '#' + x.number, () => '', (s) => s, () => '', () => false, [])(t, { depth: 0, crumb: false, kids: 0 });
const SHA = '0123456789abcdef0123456789abcdef01234567';
const base = { number: 7, sentence: 'Fix the export', projectId: 'p1', projectName: 'Alpha', createdAt: new Date().toISOString(), state: 'assigned', who: 'ada' };

test('#7508: a row with a commit says the change it was saved as, open or closed', () => {
  assert.match(row({ ...base, landedCommit: SHA, landedOnRemote: true }), /<div class="why tsk-landed">Saved as change 0123456<\/div>/);
  assert.match(row({ ...base, state: 'closed', landedCommit: SHA, landedOnRemote: true }), /<div class="why tsk-landed">Saved as change 0123456<\/div>/,
    'a closed task did not say what its fix was saved as');
});

test('#7508: a commit no remote has says it is only on this computer so far', () => {
  assert.match(row({ ...base, landedCommit: SHA, landedOnRemote: false }), /Saved as change 0123456, only on this computer so far<\/div>/);
});

test('#7508: no commit, or one of the wrong shape, draws no line (controls)', () => {
  assert.doesNotMatch(row(base), /tsk-landed/);
  assert.doesNotMatch(row({ ...base, landedCommit: '<b>x</b>', landedOnRemote: true }), /tsk-landed/, 'a value that is no sha was drawn');
  assert.doesNotMatch(row({ ...base, landedCommit: 12345, landedOnRemote: true }), /tsk-landed/);
});

test('#7508 slice 2: a closed row whose change cannot be found says so plainly; one not checked says that instead', () => {
  const closed = { ...base, state: 'closed', landedCommit: SHA, landedOnRemote: true };
  const missing = row({ ...closed, landedCheck: 'missing' });
  assert.match(missing, /<div class="why tsk-landed tsk-landed-missing">Kosmos cannot find the change this task was finished with \(0123456\)\. It may not have been saved\. Ask the agent that did it to check\.<\/div>/);
  assert.doesNotMatch(missing, /Saved as change/, 'a missing change was also said to be saved');
  const unknown = row({ ...closed, landedCheck: 'unknown' });
  assert.match(unknown, /Kosmos could not check whether this task’s change was saved\./);
  assert.doesNotMatch(unknown, /cannot find/, 'a check that could not run read as a missing change');
  assert.match(row({ ...closed, landedCheck: 'kept' }), /Saved as change 0123456<\/div>/);
  assert.match(row(closed), /Saved as change 0123456<\/div>/, 'a row not checked this read lost its saved line');
  // An open task is never flagged, even if a check were sent for it (control).
  assert.match(row({ ...base, landedCommit: SHA, landedOnRemote: true, landedCheck: 'missing' }), /Saved as change 0123456<\/div>/);
});

test('#7508 review 5: a closed row still only on this computer says it as a warning; an open one does not (control)', () => {
  const local = { ...base, landedCommit: SHA, landedOnRemote: false };
  assert.match(row({ ...local, state: 'closed' }), /<div class="why tsk-landed tsk-landed-missing">Saved as change 0123456, only on this computer so far<\/div>/);
  assert.match(row(local), /<div class="why tsk-landed">Saved as change 0123456, only on this computer so far<\/div>/);
  assert.doesNotMatch(row({ ...base, landedCommit: SHA.slice(0, 41) + 'a'.repeat(9), landedOnRemote: true }), /tsk-landed/, 'a 50-character value read as a sha');
});
