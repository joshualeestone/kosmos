'use strict';

/**
 * #3679: the stored text keeps indentation and fenced code. `storeText` used to
 * turn every run of spaces or tabs into one space, including at the start of a
 * line and inside a ``` fence, so an agent's code sample or nested list arrived
 * flat in the room and in the direct thread. The pane is a different path
 * (`cleanMessage`, one line) and must not change.
 *
 * Sandbox and dry-run are set BEFORE requiring chat, as msg-newlines-1927 does.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-indent-3679-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const FENCE = '```';
const ESC = String.fromCharCode(27);

test('#3679: the card\'s example keeps its code indentation and its nested list', () => {
  const raw = FENCE + '\nif (x) {\n    return 1;\n}\n' + FENCE + '\n- a\n  - nested';
  assert.equal(chat.storeText(raw), raw);
});

test('#3679: inside a fence every leading and inner space and every blank line is kept', () => {
  const code = 'def f():\n\n\n    x  =  1\n        return   x';
  assert.equal(chat.storeText(FENCE + 'py\n' + code + '\n' + FENCE), FENCE + 'py\n' + code + '\n' + FENCE);
});

test('#3679: outside a fence, runs inside a line and blank-line runs still collapse', () => {
  assert.equal(chat.storeText('a   b  c'), 'a b c');
  assert.equal(chat.storeText('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(chat.storeText('a   \nb'), 'a\nb', 'trailing spaces go');
  assert.equal(chat.storeText('a\n   \nb'), 'a\n\nb', 'a spaces-only line is a blank line');
  assert.equal(chat.storeText('  - item   with   gaps'), '- item with gaps', 'the ends are still trimmed');
  assert.equal(chat.storeText('x\n    - deep   item'), 'x\n    - deep item', 'indentation kept, the inner run collapsed');
});

test('#3679: a tab becomes four spaces, so indentation survives and CONTROL has nothing to refuse', () => {
  const stored = chat.storeText('x\n\t- nested\n' + FENCE + '\n\treturn 1;\n' + FENCE);
  assert.equal(stored, 'x\n    - nested\n' + FENCE + '\n    return 1;\n' + FENCE);
  assert.equal(stored.includes('\t'), false);
  assert.equal(chat.messageProblem('x\n\t- nested'), null, 'an indented message is sendable');
});

test('#3679: the length limit reads the one-line form, so indentation cannot push a DM over it', () => {
  const body = 'x\n' + '\ty\n'.repeat(2100);   // ~4200 one-line characters, ~12600 stored
  assert.ok(chat.storeText(body).length > chat.MAX_TEXT, 'CONTROL: the stored form must exceed the limit, or this proves nothing');
  assert.equal(chat.messageProblem(body), null, 'an indented message under the limit was refused');
  assert.notEqual(chat.messageProblem('y '.repeat(chat.MAX_TEXT)), null, 'a message really over the limit is still refused');
});

test('#3679: an unclosed fence keeps its code as written to the end', () => {
  assert.equal(chat.storeText('see:\n' + FENCE + '\n  a\n\n\n  b'), 'see:\n' + FENCE + '\n  a\n\n\n  b');
});

test('#3679: ESC is still refused, and the pane copy is still one line', () => {
  assert.notEqual(chat.messageProblem(FENCE + '\n  a' + ESC + 'b\n' + FENCE), null, 'ESC inside a fence must still be refused');
  assert.equal(chat.cleanMessage('x\n    - nested\n' + FENCE + '\n    y\n' + FENCE), 'x - nested ' + FENCE + ' y ' + FENCE);
});

test('#3679: the direct thread record keeps the indentation', () => {
  const raw = 'try:\n' + FENCE + '\nfor x in y:\n    print(x)\n' + FENCE;
  const kept = chat.appendMessage(chat.DIRECT, 'indent3679', { text: raw, from: 'indent3679' });
  assert.ok(kept && kept.recorded !== false, JSON.stringify(kept));
  const back = chat.readThread(chat.DIRECT, 'indent3679').messages.slice(-1)[0];
  assert.equal(back.text, raw);
});
