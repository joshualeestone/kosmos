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
{ "roots": [ {"dir": "/Users/x/Documents", "maxDepth": 4},
             {"dir": "/Users/x/Downloads", "maxDepth": 1, "importOnly": true},
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
-root maxDepth, MAX_DIRS/MAX_MD_PER_DIR/MAX_MD_READS budgets, realpath dedup), collects each
dir's CLAUDE.md|AGENTS.md|GEMINI.md head and each importOnly root's loose `.md` heads, and
NEVER applies detection (that is the engine's job). `bounded.*` mirrors the engine's flags so
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
