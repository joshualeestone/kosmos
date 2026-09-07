'use strict';
/*
 * kosmos#3 / #2125 follow-up: the native --kosmos-app-scan HATCH. The find-agents import scan
 * must read the TCC-protected roots (~/Documents, ~/Downloads, ~/Desktop) under the APP identity
 * that holds the S2 grant, not the engine (a different TCC subject that re-prompts). The engine
 * (discover.js defaultTccScan) drops scan-request.json; the app's watcher claims it (atomic rename
 * -> scan-request.inflight) and fires this hatch under tmux; the hatch reads the claimed request,
 * walks with engine-parity semantics, and writes scan-result.json.
 *
 * This pins the WIRING and the CROSS-LANGUAGE SEAM from SOURCE (main.swift is an AppKit binary no
 * unit test can boot). The walk itself is exercised behaviorally by building the binary and running
 * --kosmos-app-scan on a fixture tree (see .claude/plans/scan-tcc-hatch-2125b.md smoke); the ENGINE
 * merge half is exercised by discover.tccscan-2125b.test.js with a stub tccScan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SRC = fs.readFileSync('native-app/main.swift', 'utf8');
const ENGINE = fs.readFileSync('engine/discover.js', 'utf8');

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, `main.swift read back only ${SRC.length} bytes; assertions would pass for the wrong reason`);
});

test('the --kosmos-app-scan hatch dispatch exists and runs the walk', () => {
  assert.match(SRC, /CommandLine\.arguments\.contains\("--kosmos-app-scan"\)/, 'no --kosmos-app-scan dispatch');
  assert.match(SRC, /func scanUnderGrant\(\)\s*->\s*Bool/, 'no scanUnderGrant() walk');
});

test('the watcher claims the request atomically (rename json -> inflight), not a delete-before-read', () => {
  assert.match(SRC, /func checkScanRequest\(\)/, 'no checkScanRequest watcher');
  // moveItem is the atomic consume; the hatch needs the params, so a plain consumeRequest (which
  // deletes before firing) would leave the hatch nothing to read.
  assert.match(SRC, /moveItem\(at: req, to: inflight\)/, 'the request is not claimed by an atomic rename to .inflight');
});

test('CROSS-LANGUAGE SEAM: the two shared files match; inflight is swift-internal', () => {
  // The engine and the swift side share exactly TWO files: scan-request.json (engine WRITES it,
  // the swift watcher renames it) and scan-result.json (swift WRITES it, the engine READS it).
  for (const name of ['scan-request.json', 'scan-result.json']) {
    assert.ok(SRC.includes(name), `main.swift does not reference the shared ${name}`);
    assert.ok(ENGINE.includes(name), `engine/discover.js (defaultTccScan) does not reference the shared ${name}`);
  }
  // scan-request.inflight is the swift-internal claim (watcher rename -> hatch read); the engine
  // deliberately does NOT know about it -- it tracks a pending request via module state, not a file.
  assert.ok(SRC.includes('scan-request.inflight'), 'swift does not reference the inflight claim');
  assert.ok(!ENGINE.includes('scan-request.inflight'), 'engine should not reference the swift-internal inflight file');
  // The hatch READS the claimed inflight file and WRITES the result.
  assert.match(SRC, /storeFileURL\("scan-request\.inflight"\)/, 'hatch does not read the claimed inflight request');
  assert.match(SRC, /storeFileURL\("scan-result\.json"\)/, 'hatch does not write scan-result.json');
});

test('the walk matches engine parity: SCAN_SKIP, CLAUDE.md folder head, loose .md excluding the markers', () => {
  // SCAN_SKIP kept in sync with the engine (build/vendor output + macOS TCC homes).
  for (const skip of ['node_modules', 'Library', 'Documents', 'Downloads', 'Desktop']) {
    assert.ok(SRC.includes(`"${skip}"`), `kScanSkip missing ${skip}`);
  }
  assert.match(SRC, /appendingPathComponent\("CLAUDE\.md"\)/, 'folder path does not read CLAUDE.md (the engine byDir marker)');
  // loose files exclude the folder-agent markers, lowercased, like the engine.
  assert.match(SRC, /lower == "claude\.md" \|\| lower == "agents\.md"/, 'loose collection does not exclude the folder-agent markers');
  assert.match(SRC, /\.md"\)\s*\|\|\s*lower\.hasSuffix\("\.markdown"\)/, 'loose collection does not read .md/.markdown like the engine');
});

test('the no-symlink-escape guard is present: dirs and files are lstat-checked, not fileExists-followed', () => {
  // The TCC roots are user-writable, so a symlink there must not steer the walk out of the tree.
  // lstatType uses attributesOfItem (lstat semantics, does not follow a final symlink).
  assert.match(SRC, /func lstatType\(_ path: String\) -> FileAttributeType\?/, 'no lstatType helper');
  assert.match(SRC, /lstatType\(child\) == \.typeDirectory/, 'dir descent does not lstat-refuse a symlinked directory');
  assert.match(SRC, /lstatType\(file\) == \.typeRegular/, 'file reads do not lstat-refuse a symlinked file');
  // And the followed-symlink form must be GONE from the walk's descent/read sites.
  assert.doesNotMatch(SRC.slice(SRC.indexOf('func scanUnderGrant()')),
    /fileExists\(atPath: (child|file), isDirectory:/, 'the walk still uses fileExists (which follows symlinks) for a descent/read');
  // The behavioral proof lives in tools/test-scan-hatch-symlink-2125b.sh (compiles + runs the hatch
  // against a fixture with symlinks into /etc and asserts refusal).
});

test('the result is written atomically and echoes the request nonce', () => {
  assert.match(SRC, /options:\s*\.atomic/, 'scan-result.json is not written atomically (a torn read would break the engine)');
  assert.match(SRC, /"req":\s*nonce/, 'the result does not echo the request nonce');
});

test('the hatch is READ-ONLY instrumentation: no writes to the scanned trees', () => {
  // Sanity: the only writes in scanUnderGrant are to the result file and removing the claimed
  // request. It must never create/modify anything under the roots it walks.
  const fn = SRC.slice(SRC.indexOf('func scanUnderGrant()'), SRC.indexOf('func scanUnderGrant()') + 4000);
  assert.ok(!/createFile|createDirectory\(atPath|write\(to: URL\(fileURLWithPath: dir/.test(fn),
    'scanUnderGrant appears to write into a scanned tree; it must be read-only');
});
