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
 * another repo, so a change there is not seen here; the iPhone subtitle is built from this page's Wording table, which
 * is what that code is documented to send. The Swift is read as text (no Swift runs on this suite's runner), so the
 * iPhone side is pinned to its whole isAskable body and to the exact, ordered assignments in messageContent. Those are
 * text matches on purpose: a reformat that splits one of those lines fails here, and the fix is to update the
 * pattern, which is cheaper than a guard that a real change slips past. Who a reply counts as (phonenotice replyText) is
 * left to engine/phonenotice's own tests; this one guards the page's words, not that lookup.
 *
 *   node --test web.phone-notify-catalog-6487.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const DOC = read('docs/phone-notifications.md');
// The page's prose, with every run of whitespace one space, so a sentence is found however the paragraph is wrapped
// (tables are read from DOC itself, line by line).
const PROSE = DOC.replace(/\s+/g, ' ');

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
  assert.match(PROSE, /An agent with no name is called "An agent"\./);
  assert.equal(notificationFor({ kind: 'needs_you', agent: '' }).title, 'An agent needs you');
});

test('#6487: the iPhone rows ask about exactly the two events the computer answers', () => {
  const { head, body } = tableUnder('## On an iPhone: the message itself');
  assert.deepEqual(head, ['Event', 'Title', 'Subtitle', 'Text', 'Picture']);
  assert.deepEqual(body.map((r) => r[0]), ['An agent needs you (its report)', 'An agent answered you']);
  // The iPhone asks only about report:/reply: ids: the WHOLE isAskable body, so a third prefix or a dropped one fails.
  const logic = read('ios/KosmosNotice/NoticeLogic.swift');
  const askable = logic.match(/static func isAskable\(id: String\) -> Bool \{([\s\S]*?)\n    \}/);
  assert.ok(askable, 'NoticeLogic.isAskable is gone; update the page');
  assert.equal(askable[1].trim(), 'id.count <= 300 && (id.hasPrefix("report:") || id.hasPrefix("reply:"))',
    'the iPhone asks about other notices now; update the page');
  // The computer answers only those two, by behaviour: every other kind the board sends an id for is refused.
  const { parseId } = require('./engine/phonenotice');
  const at = '2026-10-23T12:00:00.000Z';
  assert.ok(parseId('report:' + at + ':ada'), 'report: is answered');
  assert.ok(parseId('reply:' + at + ':ada'), 'reply: is answered');
  for (const kind of ['posted', 'ready', 'built', 'crashloop', 'stuckterminal', 'ownbounds', 'post']) {
    assert.equal(parseId(kind + ':' + at + ':ada'), null, kind + ': answered now; update the page');
  }
});

test('#6487: the iPhone shows the agent as the title, the original line as the subtitle and the message as the text', () => {
  const rows = tableUnder('## On an iPhone: the message itself').body;
  for (const r of rows) assert.equal(r[1], '`<Agent>`', r[0] + ': title');
  // The subtitle is the plain notice's own title and body joined by ", " (NotificationService.swift), so it is built
  // from the Wording table here rather than written out twice.
  const wording = Object.fromEntries(tableUnder('## Wording').body.map(([k, t, b]) => [k, { t, b: (b.match(/`[^`]*`/) || [''])[0] }]));
  const joined = (k) => '`' + wording[k].t.replace(/`/g, '') + ', ' + wording[k].b.replace(/`/g, '') + '`';
  assert.equal(rows[0][2], joined('needs_you') + ', or ' + wording.needs_you.t, 'needs-you subtitle');
  assert.equal(rows[1][2], wording.replied.t, 'a reply carries no project, so its subtitle is the title alone');
  // Each of the three is set exactly once in messageContent, in that order, before the words are handed back.
  const svc = read('ios/KosmosNotice/NotificationService.swift');
  const mc = svc.slice(svc.indexOf('static func messageContent('), svc.indexOf('wordsReady(ready)'));
  assert.ok(mc.length > 0, 'NotificationService.messageContent is gone; update the page');
  const sets = [...mc.matchAll(/content\.(title|subtitle|body) = ([^\n]*)/g)].map((m) => m[1] + ' = ' + m[2].trim());
  assert.deepEqual(sets, [
    'subtitle = original.body.isEmpty ? original.title : "\\(original.title), \\(original.body)"',
    'title = words.agent',
    'body = words.text',
  ], 'the iPhone words are set differently now; update the page');
  // "shortened to about 400 characters", by behaviour: the words the computer answers with.
  for (const r of rows) assert.match(r[3], /shortened to about 400 characters/, r[0] + ': text');
  const { shorten } = require('./engine/phonenotice');
  const long = shorten('word '.repeat(400));
  assert.ok(long.length <= 400 && long.length > 300 && long.endsWith('…'), 'the lock-screen cap moved: ' + long.length);
  assert.match(read('engine/phonenotice.js'), /text: shorten\(raw\) \}/, 'wordsFor no longer uses the default cap');
  // "the agent's picture, when it has one": the board names a picture only when the agent has one.
  for (const r of rows) assert.equal(r[4], 'the agent\'s picture, when it has one', r[0] + ': picture');
  assert.match(read('server.js'), /picture = store\.avatarPath\(got\.session\) \? '\/api\/agent\/' \+ encodeURIComponent\(got\.session\) \+ '\/avatar' : null;/,
    'the board names a picture differently now; update the page');
  // The board answers at the route the page names, and its answer carries the picture it computed.
  const server = read('server.js');
  assert.match(server, /if \(pathname === '\/api\/phone\/notice' && req\.method === 'GET'\)/, 'the route moved; update the page');
  assert.match(server, /sendJson\(res, 200, \{ kind: got\.kind, session: got\.session, agent: [^}]*text: got\.text, picture \}\);/,
    'the answer no longer carries the picture; update the page');
  // "within 15 seconds" for the words, "its own 8 seconds" for the picture.
  assert.match(PROSE, /within 15 seconds, the notification shows them/);
  assert.match(svc, /await fetch\(ask, within: 15,/);
  assert.match(PROSE, /picture is fetched after the words with its own 8 seconds/);
  assert.match(svc, /await fetch\(r, within: 8,/);
});

test('#6487: a permission request puts the tool and up to 200 characters of the command on the lock screen, as the page warns', () => {
  assert.match(PROSE, /`asking permission to use <tool>`, with `: <command>` when there is one/);
  assert.match(PROSE, /names the tool and the command \(up to 200 characters of it\)/);
  const hook = read('engine/kosmos-report-hook.js');
  assert.match(hook, /const cmd = field\(evt, 'tool_input\.command'\)\.slice\(0, 200\);/, 'the command cap moved; update the page');
  assert.match(hook, /text: 'asking permission to use ' \+ tool \+ \(cmd \? ': ' \+ cmd : ''\)/, 'the permission text changed; update the page');
});
