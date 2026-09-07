# scan-tcc-hatch-2125b -- route the import-scan TCC-root walk through the granted app identity (#3 / #2125 follow-up)

## The problem (#3, Josh 0.6.42 fresh-account)
On the find-agents screen (S9), a user-triggered import scan (`GET /api/scan-import` ->
`discover.scan({importScan:true})`) walks the TCC-protected roots (`~/Documents` deep,
`~/Downloads` + `~/Desktop` shallow). That walk runs in the ENGINE (node) process. But the
S2 file-access grant was taken for the APP-EXE hatch identity (`--kosmos-app-fileaccessprompt`,
the app binary spawned under tmux). Those are DIFFERENT TCC subjects, so the engine's
Documents walk fires a fresh "Installer would like to access your Documents folder" prompt --
the late re-prompt Josh reported ("approved three, then it asked for even more").

## Measurement that steers the design (2026-09-07, see kosmos-tcc-identity-root doc)
- tmux is the responsible process for NOTHING (disclaims descendants) -- so "route under tmux
  -> attributed to tmux" is the wrong REASON. The right reason is same-SUBJECT reuse.
- The app-exe hatch that took the S2 grant and the app's other executions share ONE TCC
  subject (the app bundle's signature/id). So a walk performed BY the app-exe reuses the S2
  grant; a walk performed by the engine's node (a different subject / self-root) does not.

## Design decision: DESIGN A -- the app-exe hatch does the enumeration, the engine keeps detection
The privileged filesystem work (readdir + head-byte reads of the TCC roots) is done by a new
`--kosmos-app-scan` hatch (the app-exe, spawned under tmux via the SAME `spawnAxHatchUnderTmux`
path the working `--kosmos-app-fileaccessprompt` uses -- the proven S2 grant mechanism). The
hatch emits RAW MATERIAL only (paths + head bytes); the engine's existing detection + dedup
runs on that material with NO disk access, so it fires no prompt.

### Rejected alternatives
- **DESIGN B (reimplement the whole scan in Swift):** rejected -- duplicates the engine's
  "introduces somebody" name detection, the importable heuristic, and the dedup, which is the
  exact silent-divergence trap the codebase warns about repeatedly. Keep detection single-sourced
  in the engine.
- **DESIGN C (app spawns a non-disclaimed node child so node inherits the app's folder grant):**
  cleaner (reuses engine code) and PLAUSIBLE (my `sleep -> bash` measurement shows a
  non-disclaimed child inherits its parent's responsible root). REJECTED FOR NOW because it
  rests on "folder-TCC honors responsible-process inheritance for a node child," which I have
  NOT verified on a fresh account -- and building on an unverified TCC-attribution premise is
  exactly the lap Josh is frustrated by. Design A reuses the IDENTICAL mechanism as the already
  -working fileaccessprompt hatch, so it inherits that path's proof. Revisit C only if a fresh
  -account datapoint confirms the inheritance (it would delete the Swift walk entirely).

## The contract (what Renet wires half (b) to; endpoint UNCHANGED)
`/api/scan-import` stays the endpoint. Behind it, when `discover.scan({importScan:true})` needs
the TCC roots, it requests the hatch instead of walking them itself.

### Engine -> hatch: request file (same store dir + watcher pattern as a11y-prompt-request)
`scan-request.json` in the store dir:
```
{ "roots": [ {"dir": "/Users/x/Documents", "maxDepth": 5},          // SCAN.DEEP_DEPTH
             {"dir": "/Users/x/Downloads", "maxDepth": 1, "importOnly": true},  // SCAN.DROP_DEPTH
             {"dir": "/Users/x/Desktop",   "maxDepth": 1, "importOnly": true} ],
  "budgets": { "maxDirs": N, "maxMdPerDir": 40, "maxMdReads": 3000, "readCap": 4000 },
  "req": "<nonce>" }
```

### Hatch -> engine: result file
`scan-result.json` in the store dir:
```
{ "ok": true, "req": "<nonce matches request>",
  "dirs":  [ {"dir": "/Users/x/Documents/foo", "instr": {"file": ".../CLAUDE.md", "head": "<first readCap bytes utf8>"}} ... ],
  "loose": [ {"file": "/Users/x/Downloads/bar-agent.md", "head": "<first readCap bytes>"} ... ],
  "bounded": { "dirs": false, "count": false, "importable": false, "visited": 123 } }
```
The hatch walks with the SAME semantics the engine walk uses (SCAN_SKIP set, dotdir skip, per
-root maxDepth, MAX_DIRS/MAX_MD_PER_DIR/MAX_MD_READS budgets, realpath dedup, no-symlink-escape),
collects each dir's CLAUDE.md head (CLAUDE.md ONLY -- AGENTS.md/GEMINI.md folder-agents are owned
by found()/foundCodex/foundGemini, which do not walk here, matching the engine's byDir path) and
each root's loose `.md`/`.markdown` heads, and NEVER applies detection (that is the engine's job). `bounded.*` mirrors the engine's flags so
the screen can still say "there may be more."

The engine, on `importScan:true`: drop `scan-request.json`, poll for `scan-result.json` (nonce
match, timeout ~10s -> fall back to bounded-empty so the scan never hangs), then feed
`dirs`/`loose` heads into the EXISTING candidate/importable builders (pure string detection, no
disk). Non-TCC roots (work/projects/home) keep walking in-engine as today (they never prompt).

## Verify
- Unit: hatch walk parity against a fixture tree (same candidates the engine walk finds), the
  budget walls fire, nonce mismatch is ignored, timeout -> bounded-empty (never hangs).
- The engine consume path: given a canned `scan-result.json`, produces the same rows the direct
  walk would. Reds on the old (engine-walks-TCC-directly) behavior.
- Fresh-install (rides Josh's run): the import scan on S9 finds Documents agents with NO new
  Documents prompt.

## Weakest premise
That the app-exe hatch (under tmux) and the app's S2 fileaccessprompt grant are the same TCC
subject so the grant is reused. This is the SAME premise the working fileaccessprompt hatch
already rests on (slice-1 "PROVEN S2 model"); Design A adds no NEW attribution assumption. The
fresh-account confirm is the same gate the existing hatch carries.

---

## BUILD STATE (2026-09-07 ~02:10, Ice Cream Kitty) -- hatch DONE, engine wiring NEXT

### DONE + committed (typechecks: swiftc -typecheck passes)
- native-app/main.swift: `scanUnderGrant()` walk + `--kosmos-app-scan` hatch dispatch +
  `checkScanRequest()` watcher (atomic rename claim scan-request.json -> scan-request.inflight,
  60s staleness drop, fires the hatch under tmux via spawnAxHatchUnderTmux). Walk matches engine
  parity: CLAUDE.md folder head on non-importOnly roots; loose .md/.markdown heads on ALL roots
  excluding claude.md/agents.md; SCAN_SKIP + dotdir skip + per-root maxDepth + maxDirs/maxMdPerDir/
  maxMdReads budgets + realpath dedup. Emits scan-result.json via JSONSerialization (heads safely
  escaped), atomic write, nonce echoed.

### NEXT: engine wiring in engine/discover.js (do after the box frees; full suite ~263s)
Integration points found:
- `readClaudeHead(path)` is the disk read to replace with hatch-supplied heads.
- Folder byDir path ~L977: `if (!cur.importOnly && !byDir.has(cur.dir) && !known.has(cur.dir))`
  -> `const text = readClaudeHead(path.join(cur.dir, 'CLAUDE.md'))` -> introducesSomebody ->
  `byDir.set(cur.dir, {...})`.
- Loose importable path ~L1008: runs on ALL roots; `.md`/`.markdown`, excl claude.md/agents.md;
  `readClaudeHead(file)` -> `status.identityFromText` / `INTRODUCES.test` -> `byFile.set(...)`.

Plan for the wiring (keep endpoint /api/scan-import unchanged, keep detection single-sourced):
1. Split `scan()` roots into TCC roots (Documents/Downloads/Desktop -- only added under
   importScan) and non-TCC roots. Non-TCC walk UNCHANGED (in-engine, never prompts).
2. For TCC roots, call a new `tccScanViaHatch(roots, budgets)`:
   - write `scan-request.json` (roots+budgets+nonce) to store.ROOT,
   - poll for `scan-result.json` with matching `req` nonce, ~10s timeout, ~150ms interval,
   - on timeout: return `{dirs:[], loose:[], bounded:{...timedOut}}` so the scan never hangs and
     the screen can say "couldn't finish" (fail-open, not fail-closed).
   - Requires nativePresent (the app writes the result); if no native app, fall back to the
     current in-engine walk (a browser-on-localhost has no hatch, but also no TCC prompt).
3. Feed hatch `dirs[]` heads through the SAME byDir builder (introducesSomebody -> candidate) and
   `loose[]` heads through the SAME byFile builder (identityFromText/INTRODUCES -> importable),
   merging into the existing byDir/byFile maps BEFORE the dedup/known-exclusion so nothing
   duplicates found()/alreadyIn/declined.
4. Merge `bounded` flags (OR the hatch's dirs/importable into the engine's).

### Tests to add
- discover.tccscan-2125b.test.js: given a canned scan-result.json (fixture heads), scan({importScan:true})
  produces the same candidate/importable rows the direct walk would; nonce mismatch -> ignored ->
  timeout path; timeout -> bounded-timedOut, never hangs; no-native -> falls back to in-engine walk.
- native-app.scan-hatch-2125b.test.js: assert main.swift has the --kosmos-app-scan dispatch, the
  checkScanRequest rename-claim, the atomic result write, and the SCAN_SKIP/CLAUDE.md/loose parity
  (source-asserts, same style as native-app.a11y-writer-2125.test.js).
- Reds on the old behavior (engine walks TCC roots directly).

### Then: challenge-loop (regenerate the -pre-challenge.md proof AFTER this plan file exists so the
### pre-challenge-gate hash matches), full validation suite (once, box free), self-merge on green.

### Renet's half (b), after this merges: /api/scan-import already routes through the hatch, so his
### S9 re-scan-on-grant-flip (half a) inherits it; he re-runs frScanAgents on the grant edge.

## HATCH BEHAVIORAL SMOKE (2026-09-07 ~02:15) -- PASS, walk validated directly
Built native-app/main.swift into a binary and ran `--kosmos-app-scan` against a fixture tree
(AGENT_WORKFORCE_DATA override -> store/AgentWorkforce/). Result:
- dirs[] = myagent/CLAUDE.md ("You are Bob") + sub/CLAUDE.md ("You are Deep", nested descent works);
  node_modules/junk/CLAUDE.md EXCLUDED (SCAN_SKIP), .hidden/CLAUDE.md EXCLUDED (dotdir skip). ✓
- loose[] = README.md + loose-agent.md ("You are Sue"); agents.md EXCLUDED, CLAUDE.md markers
  EXCLUDED from loose. ✓
- req echoed ("testnonce123"), bounded.visited=3 (root+myagent+sub, skipped dirs not entered),
  scan-request.inflight consumed, scan-result.json valid JSON with safely-escaped heads, exit 0. ✓
So the novel walk (SCAN_SKIP / dotdir / nested descent / CLAUDE.md folder + loose-.md exclusions /
nonce / atomic write / consume) is behaviorally correct. The committed test for the suite will be
a source-assert (native-app.a11y-writer-2125.test.js style) + the engine consume-path unit test.

## BUILD STATE UPDATE (2026-09-07 ~02:52) -- engine wiring DONE + tested
- engine/discover.js: DONE. scan() partitions tcc:true roots out of the walk; merges them via an
  injectable `tccScan` seam (default `defaultTccScan` = non-blocking file bridge: reads a fresh
  scan-result.json or drops scan-request.json + returns null). Detection single-sourced via
  folderRow/looseRow (extracted, no behavior change). `scanning:true` when the hatch result isn't
  ready. Existing discover tests 18/18 + import-1652 + fixtures-2003 GREEN (no regression).
- server.js getImportScan(): DONE. Does not cache a scanning:true (partial) result; the route
  already spreads `...out` so `scanning` flows through with no route change.
- Tests: engine/discover.tccscan-2125b.test.js (4/4, stub tccScan -> merge/scanning/gate/no-tcc);
  native-app.scan-hatch-2125b.test.js (7/7, wiring + cross-language seam). Hatch behavioral smoke
  PASS (earlier).
- Renet told the (b) contract: on `scanning:true`, retry /api/scan-import shortly (the hatch
  answers within ~1s); show non-TCC rows immediately. Additive boolean, endpoint unchanged.
- REMAINING: full node suite (running) green; then /challenge-loop (regenerate the -pre-challenge
  proof AFTER this plan file exists so the gate hash matches); then PR (non-closing Addresses #3 /
  the #2125 seam); self-merge on green. Fresh-install visual (no Documents re-prompt) rides Josh's run.
- WEAKEST PREMISE of the engine half: defaultTccScan matches result->request by FRESHNESS (30s),
  not a per-call nonce, relying on one scan session at a time. True for the find-agents screen (one
  user, one screen). If two scans ever overlap, the freshness window could hand one session the
  other's result; acceptable for a user-visible scan (re-scan fixes it), and the nonce is still
  echoed end-to-end for a future tightening.

## ITERATION 2 HARDENING (2026-09-07 ~03:10)
- **never hangs**: defaultTccScan now gates on promptrequest.nativePresent() -- no native app ->
  return a resolved-empty TCC result (scanning:false), never scanning-forever and never an in-engine
  TCC walk (which would re-prompt). And a TCC_GIVE_UP_MS (12s) bound: if the app is present but the
  request goes unanswered too long (crashed hatch), give up to a resolved-empty result. getImportScan
  caches that complete result so the front-end retry stops.
- **confused-deputy**: the hatch clamps the walk to exactly ~/Documents,~/Downloads,~/Desktop
  (canonicalised); a forged scan-request.json naming arbitrary roots is refused. Test seam
  AGENT_WORKFORCE_SCAN_ALLOW_ROOTS (mirrors the engine's SCAN_ROOTS override) for fixtures.
- **TOCTOU**: headBytes now opens O_RDONLY|O_NOFOLLOW|O_NONBLOCK -- a symlink swapped in after the
  lstatType check is refused atomically at open (parity with the engine's import-file read).
- **atomic request**: scan-request.json written tmp+rename.
- ScanBudgets default maxDirs aligned to the engine's 6000.
- Deferred: the loose-file budget COUNT can diverge by a symlink/unreadable file between hatch and
  engine -- bounded.importable is a "there may be more" hint, not an exact count; cosmetic.
