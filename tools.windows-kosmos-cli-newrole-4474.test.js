'use strict';
/**
 * #4474 on Windows, at parity with install/kosmos: `kosmos agent role-draft` prints the default text a new role
 * starts from, and `kosmos agent create "<name>" --new-role "<label>" --from <file> ["<why>"]` sends the `own`
 * role with that label and the file's text, verbatim. Driven through main() with its seams; nothing leaves the
 * process. readFile is injected, except in the one test that reads a real UTF-16 file through the default reader.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const OWN = 'You are **{{NAME}}**, an assistant.\n\n## Who you are\nThe default text.\n';

function harness({ token = 'abc123', answer, files = {} } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readFile: (f) => { if (!Object.prototype.hasOwnProperty.call(files, f)) throw new Error('ENOENT'); return files[f]; },
    hook: { agentToken: () => token, readBoardToken: () => null, resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      const [status, json] = answer(u);
      return { status, ok: status < 400, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(json), json: async () => json };
    },
  };
  return { io, sent, lines };
}

const MADE = () => [200, { outcome: 'created', created: [{ name: 'ann', shownAs: 'Ann' }], refused: [] }];

test('#4474 Windows role-draft prints the default text, {{NAME}} left for Kosmos to fill', async () => {
  const h = harness({ answer: () => [200, { roles: [], own: { key: 'own', instructions: OWN } }] });
  const code = await cli.main(['agent', 'role-draft'], h.io);
  assert.equal(code, 0, h.lines.err.join('\n'));
  assert.match(h.sent[0].url, /\/api\/roles$/);
  assert.equal(h.lines.out.join('\n') + '\n', OWN);
});

test('#4474 Windows create --new-role sends the own role, the label and the file\'s text verbatim, with the token', async () => {
  const text = 'You are **{{NAME}}**, a grant writer.\n\n- Quote "exactly", keep C:\\paths as written.\n';
  const h = harness({ answer: MADE, files: { 'C:\\role.md': text } });
  const code = await cli.main(['agent', 'create', 'Ann', '--new-role', 'Grant writer', '--from', 'C:\\role.md', 'grants'], h.io);
  assert.equal(code, 0, h.lines.err.join('\n'));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], 'abc123');
  assert.deepEqual(h.sent[0].body, { purpose: 'grants', members: [{ name: 'Ann', role: 'own', label: 'Grant writer', instructions: text }] });
  assert.match(h.lines.out.join('\n'), /Made "Ann"\./);
});

test('#4474 Windows create --new-role with no readable file, or no --from, sends nothing and says how', async () => {
  const h = harness({ answer: MADE });
  assert.equal(await cli.main(['agent', 'create', 'Ann', '--new-role', 'Writer', '--from', 'C:\\missing.md'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /could not read C:\\missing\.md.*role-draft/);
  assert.equal(await cli.main(['agent', 'create', 'Ann', '--new-role', 'Writer'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /--new-role "<label>" --from <file>/);
  assert.equal(h.sent.length, 0, 'a create went out without a role text');
});

test('#4474 Windows CONTROL: the existing form still sends only a name and a role', async () => {
  const h = harness({ answer: MADE });
  assert.equal(await cli.main(['agent', 'create', 'Ann', 'pm', 'why'], h.io), 0);
  assert.deepEqual(h.sent[0].body, { purpose: 'why', members: [{ name: 'Ann', role: 'pm' }] });
});

test('#4474 Windows reads a role file PowerShell 5.1 wrote (UTF-16LE with a BOM) as the text, through the real reader', async () => {
  const text = 'You are **{{NAME}}**, a grant writer.\n\n- Writes grants, ünïcödé included.\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-role-'));
  const file = path.join(dir, 'role-grants.md');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]));
  const h = harness({ answer: MADE });
  delete h.io.readFile;   // the default reader, not the seam
  assert.equal(await cli.main(['agent', 'create', 'Ann', '--new-role', 'Grant writer', '--from', file], h.io), 0, h.lines.err.join('\n'));
  assert.equal(h.sent[0].body.members[0].instructions, text, 'the UTF-16 file was not read as its text');
});

test('#4474 textFileDecoded: UTF-16LE, UTF-16BE and UTF-8 with or without a BOM all give the text', () => {
  const t = 'Grant writer ü\n';
  assert.equal(cli.textFileDecoded(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(t, 'utf16le')])), t);
  assert.equal(cli.textFileDecoded(Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(t, 'utf16le').swap16()])), t);
  assert.equal(cli.textFileDecoded(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(t, 'utf8')])), t);
  assert.equal(cli.textFileDecoded(Buffer.from(t, 'utf8')), t, 'CONTROL: plain UTF-8 changed');
});

test('#4474 Windows role-draft --to writes the file itself (UTF-8, the text\'s own line endings), never through PowerShell', async () => {
  const written = {};
  const h = harness({ answer: () => [200, { roles: [], own: { key: 'own', instructions: OWN } }] });
  h.io.writeFile = (f, text) => { written[f] = text; };
  h.io.fileExists = (f) => Object.prototype.hasOwnProperty.call(written, f);
  assert.equal(await cli.main(['agent', 'role-draft', '--to', 'C:\\role-writer.md'], h.io), 0, h.lines.err.join('\n'));
  assert.equal(written['C:\\role-writer.md'], OWN);
  assert.match(h.lines.out.join('\n'), /Wrote the default role text to C:\\role-writer\.md/);
  assert.equal(await cli.main(['agent', 'role-draft', '--to'], h.io), 2, 'role-draft --to with no file did not say how');
});

test('#4474 Windows role-draft --to never replaces an existing file', async () => {
  let wrote = false;
  const h = harness({ answer: () => [200, { roles: [], own: { key: 'own', instructions: OWN } }] });
  h.io.writeFile = () => { wrote = true; };
  h.io.fileExists = () => true;
  assert.equal(await cli.main(['agent', 'role-draft', '--to', 'C:\\role-taken.md'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /already exists, and it may hold another role/);
  assert.equal(wrote, false, 'an existing role file was replaced');
});
