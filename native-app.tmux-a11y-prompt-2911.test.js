'use strict';
/*
 * kosmos#2911: secure the TMUX accessibility grant UP FRONT. The up-front `axprompt` hatch
 * registers the KOSMOS APP (AXIsProcessTrusted reads the CALLING binary, #2451), not tmux --
 * but at runtime macOS prompts for TMUX, because engine/terminal.js drives Terminal.app via
 * osascript under an agent's tmux and macOS attributes the AppleEvents/accessibility op to the
 * RESPONSIBLE process (the tmux server). So onboarding secured Kosmos and left tmux to ambush
 * the user mid-work. This adds a `tmux-a11y` prompt that runs an osascript automation op
 * DIRECTLY under the bundled tmux so the prompt is attributed to tmux.
 *
 * The AppKit binary cannot be booted by a unit test (sibling of native-app.perm-prompts-2189),
 * so this pins the SOURCE WIRING -- the request seam, the route, the native hatch + its
 * consumption, and the web dual-trigger -- so a source edit that breaks the seam fails the
 * fast suite. It deliberately does NOT assert the exact osascript PROBE string: that (and which
 * TCC service fires, and the exact binary macOS names) is pinned by a real fresh-install verify,
 * and the probe is a one-line swap in spawnTmuxAutomationPrompt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const PR = fs.readFileSync(path.join(__dirname, 'engine', 'promptrequest.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const WEB = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('the instruments read something', () => {
  assert.ok(SRC.length > 40000 && PR.length > 1000 && SERVER.length > 100000 && WEB.length > 100000,
    'a source read came back short; assertions would pass for the wrong reason');
});

test('#2911: the engine records a `tmux-a11y` request, distinct from the app `a11y` one', () => {
  // The REQUEST_FILE map is the cross-language contract with the Swift consumeRequest calls.
  assert.match(PR, /'tmux-a11y':\s*'tmux-a11y-prompt-request'/,
    'promptrequest.REQUEST_FILE has no tmux-a11y kind -> the native watcher would never fire the tmux prompt');
  // It must stay SEPARATE from the app-a11y kind: the app one registers Kosmos (AXIsProcessTrusted
  // = calling binary, #2451); collapsing them would re-lose the tmux grant.
  assert.match(PR, /a11y:\s*'a11y-prompt-request'/, 'the app-a11y kind must still exist and be distinct');
});

test('#2911: POST /api/tmux-a11y-prompt records the tmux-a11y request (fire-and-forget)', () => {
  const i = SERVER.indexOf("pathname === '/api/tmux-a11y-prompt'");
  assert.ok(i >= 0, 'there is no /api/tmux-a11y-prompt route');
  const seg = SERVER.slice(i, i + 400);
  assert.match(seg, /req\.method === 'POST'/, 'the route is not POST');
  assert.match(seg, /promptrequest\.request\('tmux-a11y'\)/, 'the route does not record the tmux-a11y request');
  // Same fire-and-forget shape as its sibling: always 200 with a body the caller reads.
  assert.match(seg, /sendJson\(res, 200,/, 'the route must answer 200 with a body (fire-and-forget contract)');
});

test('#2911: the native watcher consumes tmux-a11y-prompt-request and fires spawnTmuxAutomationPrompt', () => {
  const check = SRC.slice(SRC.indexOf('func checkPromptRequests()'), SRC.indexOf('private func consumeRequest('));
  assert.ok(check.length > 0, 'checkPromptRequests moved or was renamed');
  assert.match(check, /consumeRequest\(named:\s*"tmux-a11y-prompt-request"\)/,
    'the tmux-a11y request is not consumed -> a POST would never fire the prompt');
  assert.match(check, /spawnTmuxAutomationPrompt\(kosmosHome:/,
    'the tmux-a11y request does not fire spawnTmuxAutomationPrompt');
  // Drift guard (mirrors perm-prompts-2189): the pending-check `names` array and the
  // consumeRequest calls must list the SAME requests, or a request is checked-but-never-consumed
  // (or vice versa). tmux-a11y-prompt-request must be in BOTH.
  const namesMatch = check.match(/let names = \[([^\]]*)\]/);
  assert.ok(namesMatch, 'checkPromptRequests lost its `names` array');
  assert.match(namesMatch[1], /"tmux-a11y-prompt-request"/, 'the names array does not include tmux-a11y-prompt-request');
  const consumed = [...check.matchAll(/consumeRequest\(named:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  const listed = [...namesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(consumed, listed,
    'the pending-check names array and the consumeRequest calls list different requests (drift would skip detection or consumption)');
});

test('#2911: spawnTmuxAutomationPrompt runs osascript UNDER the bundled tmux (attributes the prompt to tmux)', () => {
  const i = SRC.indexOf('private func spawnTmuxAutomationPrompt(');
  assert.ok(i >= 0, 'spawnTmuxAutomationPrompt is missing');
  const fn = SRC.slice(i, i + 1400);
  // It must resolve the BUNDLED tmux (per-binary TCC; the same resolver the ax hatch uses),
  // never a hardcoded path (the #2189/#2371 static-path bug that made every under-tmux hatch skip).
  assert.match(fn, /resolveBundledTmux\(kosmosHome:/, 'it does not resolve tmux via resolveBundledTmux');
  // It runs the op UNDER tmux via a new-session, and the payload is osascript (NOT the app
  // executable + AXIsProcessTrusted, which would register the app, not tmux).
  assert.match(fn, /"new-session"/, 'it does not spawn under a tmux new-session');
  assert.match(fn, /osascript/, 'it does not run osascript (so the prompt would not be an AppleEvents/accessibility op)');
  assert.doesNotMatch(fn, /AXIsProcessTrusted/, 'it must NOT call AXIsProcessTrusted (that registers the app, not tmux)');
});

test('#2911: the S3 tmux Turn On fires BOTH the Kosmos and the tmux triggers (secure both up front)', () => {
  // The map gates the tmux row on an extra trigger; the handler fires it best-effort.
  assert.match(WEB, /extraTriggers:\s*gate === 'tmux' \? \['\/api\/tmux-a11y-prompt'\] : \[\]/,
    'the tmux gate does not carry the /api/tmux-a11y-prompt extra trigger');
  assert.match(WEB, /const frFireExtra = async \(urls\)/, 'the best-effort extra-trigger helper is missing');
  // Both the "Turn On" button and the #2620 mock-switch overlay must fire the extras, or one
  // path secures only Kosmos.
  const extraCalls = (WEB.match(/await frFireExtra\(/g) || []).length;
  assert.ok(extraCalls >= 2, `frFireExtra is called ${extraCalls} time(s); both the .s3-on and .s3-sw-open paths must fire it`);
});
