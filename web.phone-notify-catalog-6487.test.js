'use strict';

/**
 * kosmos#6487, its third "done means": the code sends exactly the words docs/phone-notifications.md documents, and a
 * test fails when the two drift. This reads the page's tables and checks them against what this repo's code shows:
 *
 *   - the Wording table (kind, title, body) against web/sw.js notificationFor, the words a browser or Android phone
 *     shows when the coordinator sends no title, and against engine/phonenotify.js KINDS, the kinds a computer sends;
 *   - the "On an iPhone" table against ios/KosmosNotice (which notices the iPhone asks about, and where the agent's
 *     name, the original line and the message go) and engine/phonenotice.js (which events the computer answers).
 *
 * What it cannot reach: the coordinator's own wording (kosmos-relay coordinator/src/push.rs notice_text) lives in
 * another repo, so a change there is not seen here. The Swift is read as text (no Swift runs on this suite's runner),
 * so the iPhone rows are pinned to the exact assignment lines, not run.
 *
 *   node --test web.phone-notify-catalog-6487.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const DOC = read('docs/phone-notifications.md');

/** The rows of the first markdown table under `heading`, as arrays of cell text (backticks kept). */
function tableUnder(heading) {
  const at = DOC.indexOf('\n' + heading + '\n');
  assert.ok(at > -1, 'the page has no "' + heading + '" heading');
  const lines = DOC.slice(at).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  assert.ok(start > -1, 'no table under "' + heading + '"');
  const rows = [];
  for (let i = start; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()));
  }
  assert.ok(/^-+$/.test(rows[1][0]), 'the table under "' + heading + '" has no header rule');
  return { head: rows[0], body: rows.slice(2) };
}

const swSrc = read('web/sw.js');
// eslint-disable-next-line no-new-func
const worker = new Function('self', 'caches', swSrc + '\nreturn { notificationFor };')(
  { addEventListener() {}, location: { origin: 'https://hers.kosmosplus.com', hostname: 'hers.kosmosplus.com' } }, {});
/** What the worker shows for a push carrying `payload` and no title (the words then come from web/sw.js itself). */
const notificationFor = (payload) => worker.notificationFor({ data: { json: () => payload } });

/** `<Agent> needs you` with Agent = 'Ada' -> 'Ada needs you'. Backticks stripped. */
const fill = (template, agent, project) => template.replace(/`/g, '').replace('<Agent>', agent).replace('<Project>', project);

test('#6487: the Wording table names exactly the kinds a computer sends and web/sw.js words', () => {
  const { head, body } = tableUnder('## Wording');
  assert.deepEqual(head, ['Kind', 'Title', 'Body']);
  const docKinds = body.map((r) => r[0]).sort();
  const sent = [...read('engine/phonenotify.js').match(/const KINDS = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(docKinds, sent, 'the Wording table and engine/phonenotify.js KINDS list different kinds');
  const worded = [...swSrc.match(/const KIND_HEADLINE = \{([\s\S]*?)\};/)[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(docKinds, worded, 'the Wording table and web/sw.js KIND_HEADLINE list different kinds');
});

test('#6487: web/sw.js shows each kind with the title and body the Wording table documents', () => {
  for (const [kind, titleT, bodyT] of tableUnder('## Wording').body) {
    const withProject = notificationFor({ kind, agent: 'Ada', project: 'Spring catalogue' });
    assert.equal(withProject.title, fill(titleT, 'Ada', ''), kind + ': title');
    // "`in <Project>`, or no body" (with any trailing note in brackets): the first backticked template is the body.
    const bodyTemplate = (bodyT.match(/`[^`]*`/) || [''])[0];
    assert.ok(bodyTemplate, kind + ': the Body cell has no template');
    assert.equal(withProject.options.body, fill(bodyTemplate, 'Ada', 'Spring catalogue'), kind + ': body with a project');
    assert.match(bodyT, /or no body/, kind + ': the page no longer says there is no body without a project');
    const without = notificationFor({ kind, agent: 'Ada' });
    assert.equal(without.options.body, undefined, kind + ': a notice with no project has no body');
  }
});

test('#6487: an agent with no name is "An agent", as the Wording section says', () => {
  assert.match(DOC, /An agent with no name is called "An agent"\./);
  assert.equal(notificationFor({ kind: 'needs_you', agent: '' }).title, 'An agent needs you');
});

test('#6487: the iPhone rows ask about exactly the two events the computer answers', () => {
  const { head, body } = tableUnder('## On an iPhone: the message itself');
  assert.deepEqual(head, ['Event', 'Title', 'Subtitle', 'Text', 'Picture']);
  assert.deepEqual(body.map((r) => r[0]), ['An agent needs you (its report)', 'An agent answered you']);
  // The iPhone asks only about report:/reply: ids, and the computer answers only those two kinds.
  const logic = read('ios/KosmosNotice/NoticeLogic.swift');
  assert.match(logic, /id\.hasPrefix\("report:"\) \|\| id\.hasPrefix\("reply:"\)/, 'the iPhone asks about other notices now; update the page');
  assert.match(read('engine/phonenotice.js'), /if \(kind !== 'report' && kind !== 'reply'\) return null;/, 'the computer answers other events now; update the page');
});

test('#6487: the iPhone shows the agent as the title, the original line as the subtitle and the message as the text', () => {
  const rows = tableUnder('## On an iPhone: the message itself').body;
  for (const r of rows) assert.equal(r[1], '`<Agent>`', r[0] + ': title');
  assert.equal(rows[0][2], '`<Agent> needs you, in <Project>`, or `<Agent> needs you`');
  assert.equal(rows[1][2], '`<Agent> replied`');
  const svc = read('ios/KosmosNotice/NotificationService.swift');
  assert.ok(svc.includes('content.subtitle = original.body.isEmpty ? original.title : "\\(original.title), \\(original.body)"'),
    'the iPhone subtitle is no longer "<title>, <body>"; update the page');
  assert.ok(svc.includes('content.title = words.agent'), 'the iPhone title is no longer the agent; update the page');
  assert.ok(svc.includes('content.body = words.text'), 'the iPhone text is no longer the message; update the page');
  // "shortened to about 400 characters": the computer's lock-screen cap.
  for (const r of rows) assert.match(r[3], /shortened to about 400 characters/, r[0] + ': text');
  assert.match(read('engine/phonenotice.js'), /const TEXT_MAX = 400;/);
  // "within 15 seconds": how long the iPhone waits for the words.
  assert.match(DOC, /within 15 seconds, the notification shows them/);
  assert.match(svc, /await fetch\(ask, within: 15,/);
});
