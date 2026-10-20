'use strict';
/* kosmos#6727: Claude Code's permission prompt read into a short card (chat.permissionCard), from the captured screens. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chat = require('./chat');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const EDIT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-edit-2.1.296.txt'), 'utf8');
/* The dangerous-rm prompt Josh saw (#6727), not captured: the bash capture with its command and Claude Code's reason
   line replaced by the words on his screenshot. Auto mode denies such a command instead of asking (seen on 2.1.304), so
   it reaches a person only where auto mode is off. */
const RM = BASH.replace(' /usr/bin/uuidgen\n', ' rm -rf "$TARGET/build"\n')
  .replace('Generate a UUID with uuidgen', 'Remove the old build folder')
  .replace('This command requires approval', 'Dangerous rm operation on possibly-empty variable path');
/* The folder-trust dialog, captured on 2.1.304 (2026-10-20), the folder path replaced. Kosmos answers it itself
   (class1-autohandle); it must never read as a permission card. */
const TRUST = [
  '────────────────────────────────────────',
  ' Accessing workspace:',
  ' /Users/someone/project',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
].join('\n');

const CHROME = /─{4}|╌{4}|Esc to cancel|Tab to amend|❯|\d\.\s+Yes|Do you want to/;

test('#6727 a command: what it does in Claude\'s words, the command, Allow and Deny by the prompt\'s own numbers', () => {
  const c = chat.permissionCard(BASH);
  assert.deepEqual(c, { kind: 'command', title: 'Bash command', says: 'Generate a UUID with uuidgen', target: '',
    detail: '/usr/bin/uuidgen', reason: 'This command requires approval', allow: 1, deny: 4 });
});

test('#6727 a new file: the file\'s name and its text', () => {
  const c = chat.permissionCard(EDIT);
  assert.equal(c.kind, 'create');
  assert.equal(c.target, 'edit-probe.txt');
  assert.equal(c.says, '');
  assert.equal(c.detail, 'hello', 'the gutter number is not part of the file');
  assert.equal(c.allow, 1);
  assert.equal(c.deny, 3);
});

test('#6727 the dangerous rm prompt reads as a command that deletes files', () => {
  const c = chat.permissionCard(RM);
  assert.equal(c.kind, 'delete');
  assert.equal(c.detail, 'rm -rf "$TARGET/build"');
  assert.equal(c.reason, 'Dangerous rm operation on possibly-empty variable path');
  // CONTROL: the same screen with Claude Code's ordinary reason is a plain command, so the warning is what decides.
  assert.equal(chat.permissionCard(RM.replace('Dangerous rm operation on possibly-empty variable path', 'This command requires approval')).kind, 'command');
});

test('#6727 no field carries terminal chrome (rules, options, key hints, the question)', () => {
  for (const [name, t] of [['bash', BASH], ['edit', EDIT], ['rm', RM]]) {
    const c = chat.permissionCard(t);
    for (const k of ['title', 'says', 'target', 'detail', 'reason']) assert.doesNotMatch(c[k], CHROME, name + '.' + k + ': ' + c[k]);
  }
});

test('#6727 not a permission card: the trust dialog, a question menu, an idle screen, a box whose top scrolled away', () => {
  assert.equal(chat.permissionCard(TRUST), null);
  assert.equal(chat.permissionCard(fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8')), null);
  assert.equal(chat.permissionCard('❯ \n  ? for shortcuts'), null);
  // The box's opening rule cut off: the buttons are not offered there (permissionAnswerable), so neither is a card.
  const cut = BASH.split('\n').filter((l) => !/^─{8,}/.test(l)).join('\n');
  assert.equal(chat.permissionAnswerable(cut), false, 'premise: the cut box is not answerable');
  assert.equal(chat.permissionCard(cut), null);
});

test('#6727 review 2 and 4: a box with no dashed rules is no card at all (its request could be shown nowhere)', () => {
  const unruled = BASH.replace(/^╌+\n/mg, '');
  assert.equal(chat.permissionAnswerable(unruled), true, 'premise: still answerable, so the buttons would be offered');
  assert.equal(chat.permissionCard(unruled), null, 'a card with nothing under Show details');
  const MCP = unruled.replace(/^ Bash command$/m, ' Tool use')
    .replace(' Generate a UUID with uuidgen\n', ' slack - post_message(channel: "#general", text: "token sk-abc123 here") (MCP)\n');
  assert.equal(chat.permissionCard(MCP), null, 'an unruled tool box was made a card');
});

test('#6727 review 4: a tip wrapped onto a second line never reaches the visible line', () => {
  const wrapped = BASH.replace(/^ Tip: (.*)$/m, (m, t) => ' Tip: ' + t.slice(0, 40) + '\n ' + t.slice(40));
  assert.notEqual(wrapped, BASH, 'premise: the tip was wrapped');
  const c = chat.permissionCard(wrapped);
  assert.ok(c, 'premise: still a card');
  assert.equal(c.says, '', 'an ambiguous head reached the visible line: ' + c.says);
  assert.match(c.detail, /Generate a UUID with uuidgen/, 'the head is not under Show details');
  // CONTROL: the unwrapped capture still shows its description.
  assert.equal(chat.permissionCard(BASH).says, 'Generate a UUID with uuidgen');
});
