---
method: challenge-loop
branch: remotestepup-6595
diff_hash: c6928e4dd5065d9d70e7849025756f9a481604300fd779e06afc47e98a39f050
timestamp: 2026-10-20T01:05:47Z
subdir_audit: passed
iterations: 22
converged: true
---

# Challenge-loop proof: remotestepup-6595 (kosmos#6595, R01 step-up half)

From a remote session (a request that came through Kosmos+), the board refuses keys, installs, updates, new agents
and the other routes that let something new in, unless the session carries a fresh second-factor sign-in.
Twenty-two blind iterations with the reviewer model varied (Opus and Sonnet). Iteration 22 (Sonnet) returned
only findings already in the ledger as decided (the forwarder boundary, the binary-versus-process residual, the
stacked base), so it converged. Each iteration's fixes are their own commit on the branch; the lines below are
the ledger, one per iteration. The severities below are reconstructed from those commits after a context
compaction, so read them as the finding's class, not a verbatim copy of the reviewer's label.

After convergence the branch was rebased onto main (after #6615 and #6640), got one commit (the reachability
guard's excuse for the connector-capabilities test seam), and passed a full validation at e8d34b5be7 (21949 pass,
0 fail, build passed, validation-log hash 09e9a9616326). Main then moved 46 commits; it was MERGED in (clean),
and the branch's suites plus the overlapping ones (engine.reachable, engine/remote, both 6595 server files)
pass on the merged tree, 281 of 281. The full suite on the merged tree is left to hosted CI on the PR.

#### Iteration 1
- [BLOCKER] installs, sign-in starts, autoupdate and world creation were reachable remotely: FIXED, gated.
- [WARNING] no guard that a new route is considered: FIXED, a route guard test.
- [WARNING] the fresh sign-in loop not named: FIXED in the plan.
#### Iteration 2
- [WARNING] runner installs and agent restore ungated: FIXED. [WARNING] the guard missed regex routes: FIXED.
- [WARNING] skills undecided: FIXED as decided (no more than chatting), in the EXEMPT list.
#### Iteration 3
- [WARNING] second-factor reset and register ungated: FIXED. [WARNING] merge order unnamed: FIXED in the plan.
#### Iteration 4
- [WARNING] share and engine restart undecided: FIXED as decided. [CONVENTION] the gate's list nature: FIXED, stated.
#### Iteration 5
- [WARNING] webhook creation ungated: FIXED. [WARNING] scan blind to webhooks: FIXED. [CONVENTION] mutant hazard: FIXED, plan.
#### Iteration 6
- [BLOCKER] a test could send a request a broken gate would let act: FIXED (tests send only unreadable bodies to key routes).
- [WARNING] PUT and PATCH ungated: FIXED. [WARNING] setup-start undecided: FIXED as decided.
#### Iteration 7
- [WARNING] company enrolment ungated: FIXED. [WARNING] existence check read prose: FIXED, reads route lines.
#### Iteration 8
- [WARNING] a board with a clock behind said nothing: FIXED (remote_step_up_clock). [WARNING] scan blind to PATCH: FIXED.
#### Iteration 9
- [WARNING] federation join, invite and own-code ungated: FIXED. [WARNING] scan blind to join/enroll/register: FIXED.
#### Iteration 10
- [WARNING] the board's window equal to the coordinator's ten minutes: FIXED, twelve.
#### Iteration 11
- [BLOCKER] session headers trusted from any connector: FIXED, only when the bundled connector lists session-headers.
#### Iteration 12
- [WARNING] asking the connector could block start-up: FIXED, warmed in the background; the sync fallback is short.
#### Iteration 13
- [WARNING] a later failed ask downgraded a yes: FIXED. [WARNING] update/check ungated: FIXED (a check can install).
#### Iteration 14
- [WARNING] the connector asked while a request waits: FIXED, only ever in the background.
#### Iteration 15
- [WARNING] a late answer from an old ask applied: FIXED, generations. [WARNING] a tunnel start did not ask anew: FIXED.
#### Iteration 16
- [WARNING] a tunnel restart on the same binary lost the yes: FIXED, kept.
#### Iteration 17
- [WARNING] re-enrolling this computer ungated: FIXED. [WARNING] the start-up ask could be lost: FIXED.
#### Iteration 18
- [WARNING] the binary identified by path, mtime and size: DEFERRED with reason, named as a residual in the plan.
#### Iteration 19
- [WARNING] a vouch before this board started its own tunnel: FIXED. [WARNING] the update page hid the sentence: FIXED.
#### Iteration 20
- [WARNING] the refusal did not say what to do without Kosmos+: FIXED. [CONVENTION] plan history trimmed: FIXED.
#### Iteration 21
- [WARNING] the test connector recorded the capabilities ask: FIXED.
- [CONVENTION] the ask's comment and the plan's page line did not match the code: FIXED.
#### Iteration 22 (Sonnet)
- No new BLOCKER, WARNING or CONVENTION after deduplication. Converged.

## Residuals (owner and date in the plan and the private note)
- The binary-identity residual (iteration 18).
- A request made by a local agent on a remote person's behalf is outside a forwarder-header check (the boundary).
- End to end with Renet's tunnel (sessioniat-6595) not run here.
