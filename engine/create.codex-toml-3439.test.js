'use strict';

/**
 * #3439: on Windows, codex never replied because config.toml would not load at
 * all. `trustCodexFolder` wrote the trust heading as a DOUBLE-quoted TOML basic
 * string: `[projects."C:\Users\joshu\work\workers\marcus"]`. Inside a basic
 * string `\U` and `\u` are unicode escapes, the backslashes here are not valid
 * ones, so codex failed to parse the WHOLE file and every turn died at load,
 * before auth or network. macOS paths use forward slashes and never trip it,
 * which is why it was Windows-only.
 *
 * The verified fix (real codex on Windows logged in and returned PONG once the
 * key was a single-quoted TOML LITERAL) is to render a backslash path as
 * `[projects.'C:\Users\...\marcus']`, verbatim, no escaping. A POSIX path keeps
 * its existing double-quoted form so macOS output is byte-identical.
 *
 * These tests exercise the real rendering and the real removal logic. They do
 * NOT go through `canonicalOnDisk` for the rendering assertions -- that resolves
 * against the live filesystem and would not preserve a hard-coded Windows path
 * on POSIX CI -- they test `tomlProjectKeyString` directly and drive
 * `trustCodexFolder`/`forgetCodexFolder` against a temp CODEX_HOME.
 *
 *   node --test engine/create.codex-toml-3439.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, because create.js resolves its roots at load.
// This suite does not create agents, but it still must not read or write the
// operator's real worker tree / home while requiring the module.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toml-3439-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');

const test = require('node:test');
const assert = require('node:assert/strict');

const create = require('./create');
const trust = require('./trust');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

// A path that cannot exist on this box, so `canonicalOnDisk` falls back to
// `path.resolve` deterministically and never resolves to some real folder.
const WIN = 'C:\\Users\\joshu\\work\\workers\\zz-marcus-3439';
const POSIX = '/Users/joshu/work/workers/zz-marcus-3439';

// A minimal, correct decoder for a `[projects.<key>]` heading: it reverses the
// exact TOML string forms this code emits (a single-quoted literal, verbatim;
// a double-quoted basic string with `\` and `"` escaped) back to the path. This
// is the round-trip check the brief asks for in place of a TOML dependency
// (the repo has none), and it proves the PARSED key equals the original path.
function decodeProjectKey(tomlText) {
  const m = /^\[projects\.(.*)\]$/m.exec(tomlText);
  assert.ok(m, 'no [projects.<key>] heading found in:\n' + tomlText);
  const raw = m[1];
  if (raw[0] === "'") {
    assert.equal(raw[raw.length - 1], "'", 'literal-string key not closed');
    return raw.slice(1, -1); // TOML literal string: content is verbatim
  }
  if (raw[0] === '"') {
    assert.equal(raw[raw.length - 1], '"', 'basic-string key not closed');
    return raw.slice(1, -1).replace(/\\(["\\])/g, '$1'); // reverse \\ and \"
  }
  throw new Error('key is neither a literal nor a basic string: ' + raw);
}

function mkCodexHome(configText) {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'codex-home-'));
  fs.writeFileSync(path.join(home, 'config.toml'), configText);
  return home;
}
const ENTRY = (key) => `[projects.${key}]\ntrust_level = "trusted"\n`;

// ---------------------------------------------------------------------------
// (a) a Windows backslash path renders as VALID TOML that round-trips
// ---------------------------------------------------------------------------

test('#3439 (a): a Windows path is a single-quoted TOML literal that round-trips', () => {
  const key = create.tomlProjectKeyString(WIN);

  // The verified form: a single-quoted literal, path verbatim, no escaping.
  assert.equal(key, `'${WIN}'`, 'a backslash path must be a single-quoted TOML literal');

  const text = ENTRY(key);
  // The exact byte sequence that broke codex must be absent.
  assert.ok(!text.includes('"C:\\U'),
    'the produced config.toml still contains the invalid `"C:\\U` basic-string sequence');
  assert.ok(!text.includes(`"${WIN}"`),
    'a backslash path must not be written as a double-quoted basic string');

  // Round-trip: the PARSED key equals the original path, so codex looks up the
  // same folder its canonicalize() produces.
  assert.equal(decodeProjectKey(text), WIN,
    'the parsed [projects.<key>] must equal the original backslash path');
});

// ---------------------------------------------------------------------------
// (b) a POSIX path is UNCHANGED, so macOS output is byte-identical
// ---------------------------------------------------------------------------

test('#3439 (b): a POSIX path keeps the double-quoted form, byte-identical to before', () => {
  const key = create.tomlProjectKeyString(POSIX);
  assert.equal(key, `"${POSIX}"`, 'a POSIX path must stay a double-quoted basic string');

  // The pre-fix code wrote `[projects."<path>"]` with no escaping. For a normal
  // POSIX path (no backslash, no quote) the new rendering is that same string,
  // byte for byte -- proving zero behaviour change on Mac and no migration.
  const legacy = `[projects."${POSIX}"]\ntrust_level = "trusted"\n`;
  assert.equal(ENTRY(key), legacy, 'macOS output is not byte-identical to the pre-fix rendering');
  assert.equal(decodeProjectKey(ENTRY(key)), POSIX, 'the POSIX key round-trips too');
});

// ---------------------------------------------------------------------------
// The real writer: trustCodexFolder emits valid TOML for a backslash path
// ---------------------------------------------------------------------------

test('#3439: trustCodexFolder writes a loadable literal key and is idempotent', () => {
  const home = mkCodexHome('');
  create.trustCodexFolder(WIN, home);

  const cfg = path.join(home, 'config.toml');
  const text = fs.readFileSync(cfg, 'utf8');
  // On any OS canonicalOnDisk(WIN) falls back to path.resolve and keeps the
  // backslashes, so trustCodexFolder must have chosen the literal form.
  const canon = trust.canonicalOnDisk(WIN);
  assert.ok(text.includes(`[projects.'${canon}']`), 'trustCodexFolder did not write a single-quoted literal key');
  assert.ok(!text.includes(`[projects."${canon}"]`), 'trustCodexFolder wrote the broken double-quoted key');
  assert.equal(decodeProjectKey(text), canon, 'the written key does not round-trip to the path codex looks up');

  // The guard reuses the SAME rendered key, so a second trust does not append a
  // duplicate heading (which would itself be a second, this time redundant, entry).
  create.trustCodexFolder(WIN, home);
  assert.equal(fs.readFileSync(cfg, 'utf8'), text, 'trust must be written exactly once');
});

// ---------------------------------------------------------------------------
// (c) forgetCodexFolder removes all three renderings
// ---------------------------------------------------------------------------

test('#3439 (c1): forget removes the NEW single-quoted literal entry', () => {
  const canon = trust.canonicalOnDisk(WIN);
  const home = mkCodexHome(ENTRY(`'${canon}'`) + '\n' + ENTRY('"/other/agent"'));
  const got = create.forgetCodexFolder(WIN, home);
  assert.equal(got.removed, true, 'the new single-quoted entry must be removed');
  const after = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.ok(!after.includes('zz-marcus-3439'), 'our entry is gone');
  assert.ok(after.includes('/other/agent'), 'an unrelated entry must survive');
});

test('#3439 (c2): forget migrates the OLD raw double-quoted Windows entry', () => {
  // What a buggy build already wrote into a person's config.toml: the raw,
  // unescaped, double-quoted backslash key. Removal must clean it up.
  const canon = trust.canonicalOnDisk(WIN);
  const home = mkCodexHome(ENTRY(`"${canon}"`));
  const got = create.forgetCodexFolder(WIN, home);
  assert.equal(got.removed, true, 'the old raw-backslash entry must be migrated away');
  const after = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.ok(!after.includes('zz-marcus-3439'), 'the corrupt entry is gone');
});

test('#3439 (c3): forget still removes the existing double-quoted POSIX entry (Mac unchanged)', () => {
  const canon = trust.canonicalOnDisk(POSIX);
  const home = mkCodexHome(ENTRY(`"${canon}"`));
  const got = create.forgetCodexFolder(POSIX, home);
  assert.equal(got.removed, true, 'the Mac double-quoted entry must still be removed');
  const after = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.ok(!after.includes('zz-marcus-3439'), 'the Mac entry is gone');
});
