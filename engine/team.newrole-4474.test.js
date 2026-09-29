'use strict';
/**
 * #4474: what createTeam hands to create when an AGENT asks for a role it wrote (team.vetAgentMember), read off a
 * stub createAgent so the exact text create receives is the observable. create itself then appends the shared
 * working rules to any text (defaults.appendTo, engine/defaults.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const team = require('./team');

function build(members, fromAgent = true) {
  const got = [];
  const out = team.createTeam({ creator: 'pm1', purpose: 'the work needs it', members, fromAgent }, {
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
  assert.equal(got[0].createdBy, 'pm1', 'the team no longer stamps the creator');
});

test('#4474: text that opens with the identity line (as role-draft gives it) is kept, with one identity line', () => {
  const { got } = build([{ name: 'Bo', role: 'own', label: 'Editor', instructions: 'You are **{{NAME}}**, the team\'s editor.\n\nEdit twice.\n' }]);
  assert.equal(got[0].instructions, 'You are **Bo**, the team\'s editor.\n\nEdit twice.\n');
});

test('#4474: an own role with a label and no text is passed through (create uses the default text)', () => {
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
});

test('#4474: an identity line written for another name is given the member\'s name; its own name is kept', () => {
  const { got } = build([
    { name: 'Ann', role: 'own', label: 'Editor', instructions: 'You are **Bob**, the editor.\n\nEdit everything twice.' },
    { name: 'Cal', role: 'own', label: 'Editor', instructions: 'You are **Cal**, the editor.\n\nEdit everything twice.' },
  ]);
  assert.equal(got[0].instructions, 'You are **Ann**, the editor.\n\nEdit everything twice.');
  assert.equal(got[1].instructions, 'You are **Cal**, the editor.\n\nEdit everything twice.', 'CONTROL: the right name was changed');
});
