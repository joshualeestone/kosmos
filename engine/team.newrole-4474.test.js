'use strict';
/**
 * #4474: what createTeam hands to create when an AGENT asks for a role it wrote (team.vetAgentMember), read off a
 * stub createAgent so the exact text create receives is the observable. create itself then appends the shared
 * working rules to any text (defaults.appendTo, engine/defaults.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const team = require('./team');

function build(members, fromAgent = true, fromGuide = false) {
  const got = [];
  const out = team.createTeam({ creator: 'pm1', purpose: 'the work needs it', members, fromAgent, fromGuide }, {
    createAgent: (o) => { got.push(o); return { outcome: 'created', name: String(o.name).toLowerCase(), shownAs: o.name }; },
    readAgentId: () => null,
    env: {},
  });
  return { out, got };
}

test('#4474: {{NAME}} becomes the member\'s name, and text with no identity line gets one from the label', () => {
  const { out, got } = build([{ name: 'Ann', role: 'own', label: 'Grant writer', instructions: 'Write grants.\n{{NAME}} signs every draft.\n' }]);
  assert.equal(out.outcome, 'created');
  assert.equal(got[0].instructions, 'You are **Ann**, Grant writer.\n\nWrite grants.\nAnn signs every draft.\n');
  assert.equal(got[0].role, 'own');
  assert.equal(got[0].label, 'Grant writer');
  assert.equal(got[0].createdBy, 'pm1', 'the creator was not stamped on the member');
});

test('#4474: text that opens with the identity line (as role-draft gives it) is kept, with one identity line', () => {
  const { got } = build([{ name: 'Bo', role: 'own', label: 'Editor', instructions: 'You are **{{NAME}}**, the team\'s editor.\n\nEdit twice.\n' }]);
  assert.equal(got[0].instructions, 'You are **Bo**, the team\'s editor.\n\nEdit twice.\n');
});

test('#4474: an own role with a label and no text is passed through (create uses the default text)', () => {
  const { got: messy } = build([{ name: 'Di', role: 'own', label: 'Field\n**scout**' }]);
  assert.equal(messy[0].label, 'Field scout', 'a label sent without text was not flattened');
  assert.equal(messy[0].instructions, undefined);
  const { got } = build([{ name: 'Cy', role: 'own', label: 'Scout' }]);
  assert.deepEqual({ name: got[0].name, role: got[0].role, label: got[0].label, instructions: got[0].instructions }, { name: 'Cy', role: 'own', label: 'Scout', instructions: undefined });
});

test('#4474: an agent is refused the setup guide, and its own label or text under a built-in role; nothing is created', () => {
  const { out, got } = build([
    { name: 'Gus', role: 'setup' },
    { name: 'Pam', role: 'pm', label: 'Project Manager' },
    { name: 'Pia', role: 'pm', instructions: 'You are **{{NAME}}**, something else.' },
    { name: 'Ok', role: 'pm' },
  ]);
  assert.deepEqual(got.map((o) => o.name), ['Ok'], 'a refused member reached create');
  assert.equal(out.outcome, 'partial');
  assert.deepEqual(out.refused.map((r) => r.name), ['Gus', 'Pam', 'Pia']);
  assert.match(out.refused[0].because, /setup guide is Kosmos's own/);
  assert.match(out.refused[1].because, /role's own label and text are not replaced/);
  assert.match(out.refused[2].because, /role's own label and text are not replaced/);
});

test('#4474 CONTROL: without fromAgent (the operator) members reach create exactly as given', () => {
  const asked = { name: 'Dee', role: 'own', label: 'Writer', instructions: 'Keep {{NAME}} literal here.\n' };
  const { got } = build([asked, { name: 'Guide', role: 'setup' }], false);
  assert.equal(got.length, 2, 'the operator path was vetted');
  assert.equal(got[0].instructions, asked.instructions);
});

test('#4474: blank or too-short text gets no identity line, so create refuses it in its own words', () => {
  const { got } = build([
    { name: 'Em', role: 'own', label: 'Writer', instructions: '  \n' },
    { name: 'Hy', role: 'own', label: 'Writer', instructions: 'hi' },
  ]);
  assert.equal(got[0].instructions, '  \n', 'blank text was padded past create\'s minimum');
  assert.equal(got[1].instructions, 'hi', 'a two-character text was padded past create\'s minimum');
});

test('#4474: a label cannot break the identity line or the card (newlines and ** are flattened in both)', () => {
  const { got } = build([{ name: 'Lu', role: 'own', label: 'Grant\n**writer**', instructions: 'Write grants and sign them all.' }]);
  assert.equal(got[0].instructions, 'You are **Lu**, Grant writer.\n\nWrite grants and sign them all.');
  assert.equal(got[0].label, 'Grant writer', 'the label create stores for the card was not flattened');
  const { got: one } = build([{ name: 'Cee', role: 'own', label: 'C* specialist', instructions: 'Write C code that compiles.' }]);
  assert.equal(one[0].label, 'C* specialist', 'a single * the person meant was dropped');
});

test('#4474: an identity line written for another name is given the member\'s name; its own name is kept', () => {
  const { got } = build([
    { name: 'Ann', role: 'own', label: 'Editor', instructions: 'You are **Bob**, the editor.\n\nEdit everything twice.' },
    { name: 'Cal', role: 'own', label: 'Editor', instructions: 'You are **Cal**, the editor.\n\nEdit everything twice.' },
  ]);
  assert.equal(got[0].instructions, 'You are **Ann**, the editor.\n\nEdit everything twice.');
  assert.equal(got[1].instructions, 'You are **Cal**, the editor.\n\nEdit everything twice.', 'CONTROL: the right name was changed');
});

test('#4474: a role sent as a list is read as create reads it, so ["setup"] is refused too', () => {
  const { out, got } = build([{ name: 'Gus', role: ['setup'] }, { name: 'Pat', role: ['pm'], label: 'x' }]);
  assert.equal(got.length, 0, 'a non-string role reached create past the vetting');
  assert.match(out.refused[0].because, /setup guide is Kosmos's own/);
  assert.match(out.refused[1].because, /role's own label and text are not replaced/);
});

test('#4474: a name carrying $ patterns is written as typed in the identity line, never expanded', () => {
  const tail = 'Edit everything twice. TAIL';
  const { got } = build([{ name: "X$'", role: 'own', label: 'Editor', instructions: 'You are **Bob**, the editor.\n\n' + tail }]);
  assert.equal(got[0].instructions, "You are **X$'**, the editor.\n\n" + tail);
});

test('#4474: text with NUL in it (a UTF-16 file read as UTF-8) is refused before create', () => {
  const { out, got } = build([{ name: 'Wu', role: 'own', label: 'Writer', instructions: 'Y\u0000o\u0000u\u0000 are a writer who writes.' }]);
  assert.equal(got.length, 0, 'text that is not text reached create');
  assert.match(out.refused[0].because, /not text, as a file saved in UTF-16 does/);
});

test('#4474: the setup guide makes no made-up role (no label, no text); it can still make one from the list', () => {
  const { out, got } = build([
    { name: 'Gia', role: 'own', label: 'Writer', instructions: 'You are **{{NAME}}**, a writer who writes.' },
    { name: 'Gio', role: 'own', label: 'Writer' },
    { name: 'Ok', role: 'pm' },
  ], true, true);
  assert.deepEqual(got.map((o) => o.name), ['Ok'], 'a role the guide wrote reached create');
  assert.match(out.refused[0].because, /setup guide makes agents from the roles on the list/);
  assert.match(out.refused[1].because, /setup guide makes agents from the roles on the list/);
});

test('#4474: an agent\'s member reaches create with only the fields it may send: no runner binary, folder or flag', () => {
  const { got } = build([{ name: 'Rex', role: 'pm', provider: 'anthropic', model: 'x', projects: ['p1'], kind: 'agent',
    claudeBin: '/tmp/evil', codexBin: '/tmp/evil', tmuxBin: '/tmp/evil', configDir: '/tmp/x', accountDir: '/tmp/x', runner: 'r', pickedByPerson: true, platform: 'win32' }]);
  const keys = Object.keys(got[0]).sort();
  assert.deepEqual(keys, ['createdBy', 'kind', 'model', 'name', 'projects', 'provider', 'purpose', 'role'], 'a launch-level field reached create: ' + keys.join(','));
});

test('#4474: the shared working rules stay as Kosmos wrote them; served whole, or deleted whole, is fine', () => {
  const defaults = require('./defaults');
  const block = defaults.block().trim();
  const base = 'You are **{{NAME}}**, a writer.\n\nWrite the grant applications.\n\n';
  const { out, got } = build([
    { name: 'Ed', role: 'own', label: 'Writer', instructions: base + block.replace(/\n### [^\n]*\n[\s\S]*$/, '\n(edited away)\n') },
    { name: 'Wh', role: 'own', label: 'Writer', instructions: base + block + '\n' },
    { name: 'No', role: 'own', label: 'Writer', instructions: base },
  ]);
  assert.deepEqual(got.map((o) => o.name), ['Wh', 'No'], 'edited shared rules reached create');
  assert.match(out.refused[0].because, /shared working rules .* are edited/);
});

test('#4474: an identity line ending in a period or a dash is recognised, and its name corrected', () => {
  const { got } = build([
    { name: 'Ann', role: 'own', label: 'Editor', instructions: 'You are **Bob**. You edit everything twice.' },
    { name: 'Cy', role: 'own', label: 'Editor', instructions: 'You are **Bob** - the editor, who edits twice.' },
  ]);
  assert.equal(got[0].instructions, 'You are **Ann**. You edit everything twice.');
  assert.equal(got[1].instructions, 'You are **Cy** - the editor, who edits twice.');
});

test('#4474: every field create reads is either one an agent may send or one it may not; a new one must be sorted', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  const read = new Set([...src.matchAll(/\bopts(?:\s*&&\s*opts)?\.([a-zA-Z]+)/g)].map((m) => m[1]));
  const NOT_FROM_AN_AGENT = ['platform', 'configDir', 'accountDir', 'pickedByPerson', 'runner', 'createdBy', 'purpose',
    'claudeBin', 'codexBin', 'tmuxBin', 'museBin', 'grokBin', 'geminiBin', 'antigravityBin'];
  assert.ok(read.has('claudeBin') && read.has('reportsTo'), 'CONTROL: the scan of create.js found nothing');
  const unsorted = [...read].filter((k) => !team.AGENT_MEMBER_KEYS.includes(k) && !NOT_FROM_AN_AGENT.includes(k));
  assert.deepEqual(unsorted, [], 'create reads a field nobody decided whether an agent may send: ' + unsorted.join(', '));
  for (const k of NOT_FROM_AN_AGENT) assert.ok(!team.AGENT_MEMBER_KEYS.includes(k), k + ' is both allowed and not');
});

test('#4474: the vetting and create read the role through one function', () => {
  const create = require('./create');
  for (const role of ['setup', ' setup ', ['setup'], null, undefined, 0, { toString: () => 'setup' }]) {
    const vetRefused = !!team.vetAgentMember({ name: 'Z', role }).because;
    assert.equal(vetRefused, create.roleKeyOf({ role }) === 'setup', 'the vetting and create disagree on ' + JSON.stringify(role));
  }
});

test('#4474: the real served draft passes the vetting with Windows line endings (CRLF), as a PowerShell file has', () => {
  const roles = require('./roles');
  const own = roles.byKey('own').instructions;
  const defaults = require('./defaults');
  assert.ok(own.includes(defaults.block().trim()), 'CONTROL: the served draft does not carry the shared rules, so this proves nothing');
  const { out, got } = build([{ name: 'Win', role: 'own', label: 'Writer', instructions: own.replace(/\n/g, '\r\n') }]);
  assert.equal(out.outcome, 'created', 'the served draft with CRLF was refused: ' + JSON.stringify(out.refused));
  assert.ok(!got[0].instructions.includes('\r'), 'CRLF reached create');
});

test('#4474: the member create receives carries the role as vetted (a string), not the shape it was sent in', () => {
  const { got } = build([{ name: 'Lis', role: ['pm'] }, { name: 'Pad', role: '  pm  ' }]);
  assert.equal(got[0].role, 'pm', 'a role sent as a list reached create as a list');
  assert.equal(got[1].role, 'pm');
});
