# Plan: dist-retention-win-2112 — extend dist-retention.sh to the Windows kosmos-<V>-win-x64 family

Card: joshualeestone/kosmos#2112 (follow-up to #1605, which merged as PR #2113 / squash 075f161c). Coordinated with Baron (owner of #1605) BEFORE editing the shared file; he handed me the 4 arch touchpoints + the 44-arm test template.

## Goal
`tools/dist-retention.sh` (a dry-run-by-default, --yes-gated, whitelist-only keep-last-N pruner) currently handles ONLY the arm64 versioned triples (`kosmos-<V>-arm64.{tar.gz,.sha256,.manifest.json}`, protected by `latest.json`). Extend it to ALSO prune the Windows versioned family (`kosmos-<V>-win-x64.{zip,.sha256,.manifest.json}`, protected by `latest-win.json`), with the SAME guarantees.

## Design: a shared helper parameterized by arch (NOT a copy — the card's explicit ask)
Extract the per-family processing (served-version parse -> enumerate -> keep-window -> served protection -> prune set -> report -> prune + post-check) into ONE function `process_family` keyed on `(arch_label, artifact_ext, sha_ext, pointer_file)`:
- arm64:   (`arm64`,   `tar.gz`, `tar.gz.sha256`, `latest.json`)
- win-x64: (`win-x64`, `zip`,    `zip.sha256`,    `latest-win.json`)

Baron's 4 touchpoints, confirmed by read, all fall inside this helper: the enumeration glob (`kosmos-[0-9]*-<arch>.<ext>`), triple_files (`kosmos-<v>-<arch>.{<ext>,<sha_ext>,manifest.json}`), the version strip (`${v%-<arch>.<ext>}`), and the pointer file. The `[0-9]` anchor after `kosmos-` excludes BOTH aliases (`kosmos-arm64.tar.gz`, `kosmos-win-x64.zip`) unchanged.

## The invariant that makes this low-risk: arm64 output is byte-identical, and win is additive-only-when-present
- **arm64 is processed exactly as today** (latest.json still REQUIRED — a dist is defined by it). The refactor must produce byte-identical arm64 output, so Baron's 44 arms pass UNCHANGED (no test edits).
- **win is processed ONLY when versioned win triples exist.** Baron's fixtures have `latest-win.json` (empty) + the win ALIAS but ZERO versioned win triples, so the win glob matches nothing -> win is skipped -> output is arm64-only -> byte-identical -> all 44 arms green.
- ⇒ I do NOT touch Baron's test arms. I ADD win mirror arms in a new fixture that HAS versioned win triples.

## Fail-safe rule for win (the deletion-safety core)
If versioned win triples exist but `latest-win.json` is absent or names no version, the tool CANNOT identify the served win release to protect, so it REFUSES to prune the win family (reports them, leaves them). Never prune a family whose served release is unidentifiable. (arm64 already errors hard on a missing latest.json; win is softer because it is the optional second family — a dist may legitimately have arm64 but no win pointer.)

## Output
- Human report: one block per PROCESSED family (arm64 always; win when it has triples). The arm64 block is unchanged.
- JSON: arm64 fields stay at the top level (backward-compatible; Arm 10's fixture has 0 win triples so win is absent there); when win is processed its data is added under a `win_x64` object. Nothing consumes the JSON today (verified: no invoker outside test:shell), so this is safe.
- Exit code: non-zero if ANY processed family's prune fails its post-check.

## Tests (tools/test-dist-retention.sh — ADD, do not edit the arm64 arms)
Mirror the load-bearing arm64 arms for win-x64 in fixtures that carry versioned win triples + a real `latest-win.json`:
- dry-run deletes nothing; --prune needs --yes; --prune --yes prunes old win triples + sidecars, keeps newest N + served;
- served win release protected even outside the keep window; the win alias + arm64 files + pkg + latest*.json never touched;
- BOTH families pruned in one run (a mixed fixture) with each family's keep window independent;
- fail-safe: win triples present but latest-win.json absent/version-less -> win NOT pruned;
- the arm64 arms still all pass (byte-identical arm64 path).

## Verify
- `bash tools/test-dist-retention.sh` — all existing 44 arm64 arms PASS + the new win arms PASS.
- `bash -n` clean; full `yarn test` (test:shell includes this) green.
- Dry-run by default throughout; I never run --prune on the real dist (that stays Josh's call).

## Weakest premise
That arm64 output is truly byte-identical after the refactor. Mitigation: Baron's 44 arms assert the exact report strings / JSON fields / exit codes / postconditions, so any drift reds them; I run them first and treat any arm64 regression as a blocker, not a test to update.
