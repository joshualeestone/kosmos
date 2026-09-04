# #1605 - dist/ retention tool (dry-run by default, invariant-safe)

## The card, narrowed

`chaoskosmos-site/dist` accumulates one versioned tarball triple per release and
nothing prunes them. PigeonPete's 2026-08-31 measurement narrowed the open question
from "what should the policy be" to: **"is keep-the-last-twelve the de facto policy,
and should it be enforced by a tool rather than by whoever notices?"** The retained
set already sitting in the directory is the last ~12 contiguous versions plus the
served pointer.

## What is mine vs Josh's (reversibility test)

- **Actually deleting a published release tarball is IRREVERSIBLE** ("data that cannot
  be un-published") - there is no off-disk copy (PigeonPete confirmed: 0 GH releases,
  untracked-but-not-ignored in the site repo). By the reversibility test the *decision
  to prune* is Josh's.
- **A safe retention TOOL is reversible code and mine to build**: report what is there,
  identify prune candidates, enforce protected invariants, and delete ONLY behind an
  explicit flag + confirmation. The `--keep N` default (12) is a default value →
  reversible in a commit → mine to pick and document, Josh overrides by flag.

So this card ships a tool that is **safe to merge and safe to run**, and leaves the
act of pruning as an explicit, guarded, operator-initiated step. It does not prune
anything as part of the card.

## Design - `tools/dist-retention.sh`

```
tools/dist-retention.sh --dist <DIR> [--keep N] [--prune] [--yes] [--json]
```

- `--dist <DIR>` REQUIRED (no default that could point at the wrong tree; the tool
  refuses without it). Must be a directory containing a `latest.json`.
- `--keep N` default **12**. Number of most-recent versioned tarball triples to retain.
- Default (no `--prune`): **DRY RUN** - print retained set, prune candidates, reclaim
  bytes; delete nothing; exit 0.
- `--prune` without `--yes`: **REFUSE** (exit 2) and print the irreversibility warning
  + "this is Josh's call per #1605". Deletes nothing.
- `--prune --yes`: delete ONLY the computed prune candidates, then run a post-prune
  BACKSTOP (latest.json still present, no kept version orphaned) and print reclaim.
  Safety is primarily structural (the whitelist never constructs a delete path for a
  protected name); the backstop catches a logic bug in that model rather than being a
  full re-list of every protected name. Refuse (non-zero) if the backstop trips.

### Protected invariants - NEVER pruned, whatever --keep is

1. `latest.json`, `latest-win.json` (the served pointers).
2. Aliases + sidecars: `kosmos-arm64.tar.gz`(+`.sha256`), `tmux-arm64.tar.gz`(+`.sha256`),
   `kosmos-win-x64.zip`(+`.sha256`).
3. macOS installer: `Kosmos.pkg`(+`.sha256`, +`.inputs`).
4. **The SERVED version** parsed from `latest.json`'s `"version"` field - its
   `.tar.gz` + `.tar.gz.sha256` + `.manifest.json` - even if it falls OUTSIDE the
   keep window.
5. Every `.sha256` and `.manifest.json` belonging to a KEPT version (never orphan a
   kept artifact - the #930 shape).

### Prune candidates - the ONLY things that can be deleted

Versioned triples `kosmos-<V>-arm64.{tar.gz,tar.gz.sha256,manifest.json}` whose version
`V` is:
  - older than the keep window (sorted by version, keep the newest N), AND
  - not the served version.

**Fail-safe:** the tool only ever deletes files it positively recognises as a member
of a prunable versioned triple. Any file it does not recognise (a win zip, a stray, a
future artifact shape) is LEFT ALONE and reported under "unrecognised - not touched".
Deletion is a whitelist of prunable versions, never a blacklist of protected ones.

### Version sort

Versions are `0.6.NN` (dot-separated numeric). Sort numerically by component (not
lexically - `0.6.9` < `0.6.10`). Reuse the repo's existing version compare if one
exists; otherwise a `sort -V`-based helper, verified against a `0.6.9`/`0.6.10` case.

## Tests - `tools/test-dist-retention.sh` (red-capable, fixture-based)

Build a temp fixture dist dir (never the real one) with: 15 versioned triples
(0.6.08..0.6.22), the served version named by a fixture `latest.json` set to a MIDDLE
version so the "served outside keep window" arm is exercised, plus all the alias/pkg/
win invariants and one unrecognised stray file.

Arms:
1. Dry run: prints candidates, **deletes nothing** (assert dir file count unchanged).
2. `--prune` without `--yes`: refuses (exit 2), deletes nothing.
3. `--prune --yes`, keep=12: deletes exactly the 3 oldest versions' triples; keeps
   newest 12; served version (middle) retained even though outside window; all
   invariants present; no kept version orphaned.
4. Served-version protection: set served = the OLDEST version → it is NOT pruned even
   though outside keep=12.
5. keep ≥ number of versions: deletes nothing.
6. Unrecognised stray + all invariants: never deleted; reported as untouched.
7. Version sort control: 0.6.9 vs 0.6.10 ordered numerically.
8. Missing `--dist`: refuses. Non-dir / no latest.json: refuses.

Each arm asserts the POSTCONDITION (file present/absent), not just exit code. Prove the
suite is red-capable by breaking one arm before finalising.

## Wiring

- Add `tools/test-dist-retention.sh` to `package.json` `test:shell` (and `bash -n
  tools/dist-retention.sh`), so the guard runs in CI.
- No release.sh change in this card - the tool is operator-run. A follow-up could wire
  a dry-run REPORT (never a prune) into the disk-guard, but that is not this card.

## Out of scope / deferred

- Actually pruning the live dist/ (Josh's irreversible call).
- Auto-prune wired into the cut (would delete on every release; needs Josh's ruling on
  cadence + count first).

## Droppability

This is agent-workforce tooling in its own worktree, fully separate from the Windows
publish (site checkout + `tools/publish-kosmos-windows.sh`). If Splinter relays the
Windows zip transfer path, DROP here (leave the worktree as-is) and publish; resume
after.
