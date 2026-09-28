# retention-1605: dist retention keep rule + second-copy gate (#1605)

## Goal
Make tools/dist-retention.sh safe to run with --prune: keep what anyone can still need, and delete a
version only when a byte-identical copy of every file in its triple is proven somewhere else.

## Decisions
- Keep rule is a UNION (it only ever adds protection): served, staged, the N most recent PRIOR served
  versions (git history of the pointer, default 3), any other top-level pointer json (rollback), any
  --referenced-by file (default ../versions.html), and the old rolling --keep window (default 12,
  unchanged so existing callers keep their behaviour; --keep 0 gives exactly the #1605 rule).
- Unreadable pointer history fails CLOSED (family not pruned); --prod-history 0 opts out explicitly.
- Second-copy gate: --copy-base is REQUIRED for --prune --yes; full GET + sha256 per file; one
  missing/different file keeps the whole triple. installkosmos.com / chaoskosmos.com and the dist dir
  itself are refused as a base: the site serves the arm64 tarballs from a deploy of this same
  directory (measured 2026-09-26), so it is not a second copy. No default base is hard-coded.
- --check-copies runs the gate in a dry run.

## Measured
- R2 holds Windows zips from 0.6.84 on and NO arm64 tarballs (404, 9.9.9 control 404). So today the
  gate refuses every arm64 candidate: the tool deletes nothing arm64 until a real copy exists.
- Real-R2 control: a scratch dist holding R2's own 0.6.89 zip was proven and pruned; a one-byte-changed
  0.6.88 was refused (DIFFERS) and kept.

## Tests
tools/test-dist-retention.sh: 80 pre-existing checks unchanged in meaning (LEGACY args: fixture mirror
as copy base, --prod-history 0), plus gate and history arms. 10 perturbations of the new guards each
turn the suite red.

## Review round 1 (opus, blind): 2 BLOCKER, 3 WARNING, 5 NIT; all fixed
- BLOCKER shallow clone: a depth-1 checkout returned one commit, so "no prior versions" read as
  success. Now fails closed on `--is-shallow-repository`.
- BLOCKER file:// self-copy: curl URL-decodes `%XX`, so `file:///.../%64ist` named the dist and every
  file matched itself. Now any base containing `%` or `@` is refused, and a file:// source with the
  same device:inode as the local file (symlink, hardlink, same path) is refused per file.
- WARNING host blacklist: userinfo and trailing-dot spellings passed. Refused now (`@`, `%`, trailing
  dots stripped before the match). Redirects are no longer followed (`-L` dropped, `--max-redirs 0`),
  so an allowed base cannot bounce to the site. NOT done: an allowlist of the R2 host, because no base
  is hard-coded (decision above); other aliases of the site (a vercel.app name) are not refused.
  The no-redirect change has no test: it needs an https server returning a 3xx.
- WARNING prior served by version string only: old pointers' `artifact`/`versioned` names are now
  protected too (format skew).
- WARNING history read from a stale HEAD: when the checkout has an upstream and is behind it, fail
  closed. Weakest premise: a detached or upstream-less checkout cannot be checked this way.
- NITs: `--referenced-by ""` refused; `"pruned"` in --json is true only when a version was proven
  (and so deleted); the no-`--yes` message no longer says there is no copy; refusal arms assert the
  message, not just exit 1.
- Tests 115 -> 135. Each fix mutated back turns at least one arm red (9 mutants, 8 killed; the
  surviving one is the untested redirect change above).

## Status
- [x] implementation
- [x] tests + perturbations
## Review round 2 (sonnet, blind): 0 BLOCKER, 2 WARNING, 2 NIT
- WARNING redirect change untested (reproduced: `-L` back, 135/135 green). Now Gate 10 runs a real
  local https server (self-signed cert via CURL_CA_BUNDLE) whose /redir 302s to a matching copy:
  refused. Control: the same copy served directly is proven and pruned. `-L` back turns it red.
- WARNING vercel.app alias of the site not refused. `*.vercel.app` is refused now (the site is a
  Vercel deploy of this dir; R2 is never on vercel.app). Mutant killed.
- NIT win-x64 gate refusal untested: Gate 11 added, with control.
- NIT copy_proven/copy_refused keys absent when the gate did not run: DEFERRED. `copies_checked`
  already says whether the gate ran, so absence is unambiguous for a consumer that reads it.
- Tests 135 -> 141.

- [ ] challenge loop (round 2 fixed; round 3 next)
- [ ] PR, merge, card comment
