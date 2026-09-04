# Plan: extend the staging gate to the agent-spawn class (#2036 / #2129)

## Why
Splinter's ruling (2026-09-04): I own the cut+deploy of the #2129-cluster fix through the
staging channel, and must EXTEND the fresh-state verify to the class that actually broke.
The #2063 board-experience gate (`staging-experience-check.sh`) covers only board reachability
(#2023, the no-token 403). It does NOT exercise agent spawn. #2129 was exactly that gap:
Kosmos-spawned agents wedged at the Claude Code trust-folder prompt while the board served
fine, so the board gate alone would PASS a #2129 build. This closes that gap so staging would
catch #2129 before prod.

## What
1. **`tools/staging-agent-online-check.sh`** (new): on a running board, discover a connected
   Claude + OpenAI account (`GET /api/accounts`), create one agent per provider
   (`POST /api/agents`), and poll `GET /api/status` until each reaches state idle/working
   (ONLINE) or a `needs_you` trust wedge (the #2129 signal). Exit 0 both online / 1 wedge or
   auth or never-online (do-not-promote) / 2 cannot-tell (no enforcing board, a provider not
   signed in, or a populated fleet). Board token off argv (header file), per-uid port,
   store.ROOT via bundled node - all mirrored from `staging-experience-check.sh`.
   - SAFETY: it CREATES real agents, so it refuses on a populated fleet board (> N existing)
     unless `KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1`. Intended target is a fresh staging machine.
   - Transport seam `KOSMOS_AOC_CURL` (defaults to real curl) so the test can inject a
     file-backed fixture (no network).
2. **`tools/promote-channel.sh`**: run this as a SECOND required gate after the experience
   gate. Same exit contract (0 promote / 1 refuse-never-force / 2 HOLD-forceable). Command
   overridable via `KOSMOS_PROMOTE_AGENT_GATE_CMD`.
3. **`tools/test-staging-agent-online-check.sh`** (new): red-capable, hermetic (no network) via
   the `KOSMOS_AOC_CURL` seam - proves online->0, trust-wedge/auth/timeout->1, create-400->1,
   populated-fleet->refuse-2, override->0, no-provider->2, no-token->2.
4. **`tools/test-staging-channel-2036.sh`**: add the promote's second-gate arms (agent gate
   1/2/2+force/both-pass).
5. Wire the check + test into `test:shell`; document both gates in `docs/staging-channel.md`.

## Decisions / rejected
- Required gate (not opt-in): the coverage gap must be closed going forward, per Splinter.
- No agent DELETE (none exists; agents are launchd/tmux sessions) -> cleanup is best-effort +
  a breadcrumb; the intended runner is a throwaway fresh machine.
- Default stays PROD; this changes only the PROMOTE path, not any default cut/consume behavior.

## Weakest premise
The gate is validated against a fixture, not a live staging cut end-to-end; the true proof is
Part 2 (Josh's clean-machine pass). The check's real create+online path is exercised only when
the cut runs on the fresh staging machine.
