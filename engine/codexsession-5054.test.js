'use strict';

/*
 * #5054: codexsession.read() must not re-parse a whole 30-100 MB rollout on every status refresh. It now
 * keeps a per-file incremental cache (the #562 READ_CACHE shape) and caches each rollout's immutable head
 * (metaOf). read() stays ALWAYS-fresh (no result memo): these tests assert the OBSERVABLE CONTRACT -- an
 * incrementally-cached read equals a fresh full parse, including a valid-but-unterminated last line, and
 * the cache invalidates on replace/truncate/in-place-rewrite. The before/after load numbers live on the card.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codex = require('./codexsession');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx5054-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx5054-cwd-'));
  const day = path.join(home, 'sessions', '2026', '10', '02');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'rollout-2026-10-02T09-00-00-aaaaaaaa.jsonl');
  const meta = { type: 'session_meta', payload: { cwd, session_id: 's1', model_provider: 'openai', cli_version: '1.2.3' } };
  fs.writeFileSync(file, JSON.stringify(meta) + '\n');
  return { home, cwd, file };
}
const resp = (t) => JSON.stringify({ type: 'response_item', timestamp: t, payload: {} }) + '\n';
const turnModel = (m, t) => JSON.stringify({ type: 'turn_context', timestamp: t, payload: { model: m } }) + '\n';
const tokenCount = (n, t) => JSON.stringify({ type: 'event_msg', timestamp: t, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n } } } }) + '\n';
const taskStarted = (w, t) => JSON.stringify({ type: 'event_msg', timestamp: t, payload: { type: 'task_started', model_context_window: w } }) + '\n';

// A fresh full parse: clear all caches so read() reads the whole file from zero.
function freshParse(cwd, home) { codex._resetForTests(); return codex.read(cwd, home); }
function strip(r) { const { file, ...rest } = r; return rest; }   // path differs by tmp dir; compare the fields

test.beforeEach(() => { codex._resetForTests(); });   // each test starts from an empty cache
test.after(() => { codex._resetForTests(); });

test('incremental read after appends equals a fresh full parse (the #562 pin)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, taskStarted(258400, '2026-10-02T09:00:01Z') + turnModel('gpt-5.6-sol', '2026-10-02T09:00:02Z') + resp('2026-10-02T09:00:03Z'));
  const warm1 = codex.read(cwd, home);            // first read: full parse into the cache
  assert.deepEqual(strip(warm1), strip(freshParse(cwd, home)), 'first read != fresh parse');

  // append more, read again with the cache WARM (do not reset): must equal a fresh full parse
  fs.appendFileSync(file, tokenCount(11700, '2026-10-02T09:00:04Z') + resp('2026-10-02T09:00:05Z') + turnModel('gpt-5.6-pro', '2026-10-02T09:00:06Z'));
  const warm2 = codex.read(cwd, home);
  assert.deepEqual(strip(warm2), strip(freshParse(cwd, home)), 'incremental read after append != fresh parse');
  assert.equal(warm2.model, 'gpt-5.6-pro', 'last turn_context model not picked up incrementally');
  assert.equal(warm2.contextUsed, 11700);
  assert.equal(warm2.messages, 2);
});

test('a valid but unterminated last line is included, matching the old full-parse reader', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, resp('2026-10-02T09:00:01Z'));
  codex.read(cwd, home);   // warm
  // append a WHOLE json object with NO trailing newline (a half-written-but-valid last line)
  fs.appendFileSync(file, turnModel('gpt-5.6-mid', '2026-10-02T09:00:02Z').trimEnd());
  const warm = codex.read(cwd, home);
  assert.deepEqual(strip(warm), strip(freshParse(cwd, home)), 'unterminated-but-valid last line not handled like a full parse');
  assert.equal(warm.model, 'gpt-5.6-mid', 'the unterminated last line was dropped');
});

test('a genuinely partial (mid-JSON) last line is skipped until it completes', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('first', '2026-10-02T09:00:01Z'));
  codex.read(cwd, home);
  // a truncated last line that does NOT parse
  fs.appendFileSync(file, '{"type":"turn_context","payload":{"model":"sec');
  const mid = codex.read(cwd, home);
  assert.equal(mid.model, 'first', 'an unparseable partial last line was wrongly folded');
  assert.deepEqual(strip(mid), strip(freshParse(cwd, home)), 'partial-line read != fresh parse');
  // now complete that line + terminate it
  fs.appendFileSync(file, 'ond"}}\n');
  const done = codex.read(cwd, home);
  assert.equal(done.model, 'second', 'the completed line was not folded from its first byte');
  assert.deepEqual(strip(done), strip(freshParse(cwd, home)), 'completed-line read != fresh parse');
});

test('invalidates on in-place rewrite (same size, new mtime)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('aaaaa', '2026-10-02T09:00:01Z'));
  assert.equal(codex.read(cwd, home).model, 'aaaaa');
  // rewrite the whole file in place to the SAME byte length, different content + bumped mtime
  const meta = fs.readFileSync(file, 'utf8').split('\n')[0] + '\n';
  fs.writeFileSync(file, meta + turnModel('bbbbb', '2026-10-02T09:00:01Z'));
  const later = Date.now() / 1000 + 5;
  fs.utimesSync(file, later, later);
  const after = codex.read(cwd, home);
  assert.equal(after.model, 'bbbbb', 'an in-place rewrite at the same size was not re-parsed');
  assert.deepEqual(strip(after), strip(freshParse(cwd, home)));
});

test('invalidates on truncation (size goes backwards)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('m', '2026-10-02T09:00:01Z') + resp('2026-10-02T09:00:02Z') + resp('2026-10-02T09:00:03Z'));
  assert.equal(codex.read(cwd, home).messages, 2);
  const meta = fs.readFileSync(file, 'utf8').split('\n')[0] + '\n';
  fs.writeFileSync(file, meta);   // truncate back to just the meta line
  const after = codex.read(cwd, home);
  assert.equal(after.messages, 0, 'a truncated file kept stale counts');
  assert.deepEqual(strip(after), strip(freshParse(cwd, home)));
});

test('invalidates on inode replacement (file swapped)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('old', '2026-10-02T09:00:01Z'));
  assert.equal(codex.read(cwd, home).model, 'old');
  const meta = fs.readFileSync(file, 'utf8').split('\n')[0] + '\n';
  const tmp = file + '.new';
  fs.writeFileSync(tmp, meta + turnModel('new', '2026-10-02T09:00:01Z'));
  fs.renameSync(tmp, file);   // same path, new inode
  const after = codex.read(cwd, home);
  assert.equal(after.model, 'new', 'a replaced inode was not re-parsed');
  assert.deepEqual(strip(after), strip(freshParse(cwd, home)));
});

test('read stays fresh: a change is reflected on the very next read (no result memo)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('v1', '2026-10-02T09:00:01Z'));
  assert.equal(codex.read(cwd, home).model, 'v1');
  fs.appendFileSync(file, turnModel('v2', '2026-10-02T09:00:02Z'));
  assert.equal(codex.read(cwd, home).model, 'v2', 'a change was not reflected on the next read');
});

test('a rollout appearing after the first walk is matched (new path, metaOf once)', () => {
  const { home, cwd, file } = setup();
  fs.appendFileSync(file, turnModel('m', '2026-10-02T09:00:01Z'));
  assert.equal(codex.read(cwd, home).found, true, 'control: the session is found');
  const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cx5054-cwd2-'));
  const day = path.dirname(file);
  const f2 = path.join(day, 'rollout-2026-10-02T10-00-00-bbbbbbbb.jsonl');
  fs.writeFileSync(f2, JSON.stringify({ type: 'session_meta', payload: { cwd: cwd2, session_id: 's2' } }) + '\n' + turnModel('m2', '2026-10-02T10:00:01Z'));
  assert.equal(codex.read(cwd2, home).model, 'm2', 'a rollout that appeared after the first walk was not matched');
});

test('a multibyte UTF-8 character split across two appends folds correctly (byte-exact offset)', () => {
  const { home, cwd, file } = setup();
  // a response_item whose text ends in a 3-byte char (U+2603 SNOWMAN), then a turn_context, written in
  // two appends so the cache is warm between them and the tail boundary can land mid-sequence.
  const row1 = JSON.stringify({ type: 'response_item', timestamp: '2026-10-02T09:00:01Z', payload: { text: 'hi☃' } }) + '\n';
  const buf1 = Buffer.from(row1, 'utf8');
  // first append: everything but the final byte of the line's last char region + newline is still one
  // whole line (row1 is complete with its \n), so warm the cache on it
  fs.appendFileSync(file, buf1);
  const a = codex.read(cwd, home);
  assert.equal(a.messages, 1, 'the first multibyte line was not counted');
  // append a turn_context in two raw halves, cutting INSIDE the 3-byte U+2603 so the first read's
  // fragment ends mid-character. The read must not advance its offset into the partial char nor corrupt
  // the fold; the completed line must fold correctly on the next read.
  const row2 = Buffer.from(JSON.stringify({ type: 'turn_context', timestamp: '2026-10-02T09:00:02Z', payload: { model: 'sn☃w' } }) + '\n', 'utf8');
  const snowAt = row2.indexOf(Buffer.from('☃', 'utf8'));
  const cut = snowAt + 1;   // 1 byte into the 3-byte snowman: a genuinely mid-character boundary
  fs.appendFileSync(file, row2.slice(0, cut));
  const mid = codex.read(cwd, home);   // fragment ends mid-character; must not corrupt the offset
  assert.equal(mid.model, null, 'a mid-character fragment was wrongly folded as a model');
  fs.appendFileSync(file, row2.slice(cut));
  const done = codex.read(cwd, home);
  assert.equal(done.model, 'sn☃w', 'the split multibyte line did not fold to the right value');
  assert.deepEqual(strip(done), strip(freshParse(cwd, home)), 'split-multibyte read != fresh parse');
  assert.equal(done.messages, 1);
});

test('a missing session returns found:false (and the real one is found, as a control)', () => {
  const { home, cwd } = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cx5054-none-'));
  assert.equal(codex.read(other, home).found, false, 'a workdir with no rollout should be found:false');
  assert.equal(codex.read(cwd, home).found, true);
});

test('no em dash in the source', () => {
  const src = fs.readFileSync(path.join(__dirname, 'codexsession.js'), 'utf8');
  assert.ok(!src.includes('\u2014'), 'an em dash is in codexsession.js');
});
