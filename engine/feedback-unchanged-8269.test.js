'use strict';
/*
 * kosmos#8269: unchanged()'s refusal names `newest`, the newest earlier day holding ANOTHER writer's report, so the
 * CLIs can say why --unchanged has nothing of yours to point back to. On a throwaway store with named writers.
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fb8269-engine-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');

function fresh() { fs.rmSync(fb.dir(), { recursive: true, force: true }); }
function put(date, body) {
  fs.mkdirSync(fb.dir(), { recursive: true });
  fs.writeFileSync(path.join(fb.dir(), date + '.md'), '---\ndate: ' + date + '\n---\n\n' + body);
}
const TODAY = '2026-11-09';

test('CONTROL: the store is the throwaway folder', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('kosmos#8269 review 1: a day whose only report is empty is not named; the newest real one is', () => {
  fresh();
  fb.write('mara saw a bug', { from: 'mara', date: '2026-11-01' });
  put('2026-11-05', '<!-- kosmos-feedback-from: kip -->\n## From kip\n\n   \n');   // a section with nothing in it
  assert.deepEqual(fb.unchanged('leo', '', TODAY), { ok: false, why: 'none', newest: '2026-11-01' });
});

test('kosmos#8269 review 1: for a named writer, the unnamed section is never called another agent\'s', () => {
  fresh();
  put('2026-11-02', 'a report from before named sections, maybe leo\'s own\n');
  const named = fb.unchanged('leo', '', TODAY);
  assert.deepEqual(named, { ok: false, why: 'none', newest: null }, 'the unnamed report was called another agent\'s');
  // CONTROL: the unnamed writer finds that same day as its own, so the day is real and readable.
  assert.equal(fb.unchanged(null, '', TODAY).since, '2026-11-02');
  // And a named report by someone else on an older day is still named.
  fb.write('kip report', { from: 'kip', date: '2026-10-30' });
  assert.equal(fb.unchanged('leo', '', TODAY).newest, '2026-10-30');
});
