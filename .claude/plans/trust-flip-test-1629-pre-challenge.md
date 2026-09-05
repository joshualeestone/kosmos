---
method: challenge-loop
branch: trust-flip-test-1629
diff_hash: 95f7584e94bd855c077b92903f970773f6c0716eb8f4fc8170fd0debe2568a3f
subdir_audit: passed
---

# Challenge-loop ledger — #1629 (regression guard for the delete-the-agent trust bug)

Two rounds of fresh, blind review, each independently perturbing the product code.

#### Iteration 1

[BLOCKER] Test 3 (#2129 default-account carve-out) was VACUOUS: it set
CLAUDE_CONFIG_DIR but left AGENT_WORKFORCE_CLAUDE_CONFIG set, and that override is
the FIRST branch of both CONFIG and defaultAgentConfig -- so the carve-out's target
and the bug's target resolved to the same file, and deleting the carve-out left the
test green. The "perturbation-verified" claim had covered tests 1 and 2 but never
actually perturbed test 3's branch. Fixed: unset AGENT_WORKFORCE_CLAUDE_CONFIG so
defaultAgentConfig() and CONFIG(null) genuinely diverge; assert the flag lands in
the default-account home, not the engine dir.

[WARNING] The vacuity fix is itself an unsandboxed-write trap: unsetting the
override makes both defaultAgentConfig and CONFIG fall back to the operator's real
~/.claude.json. Fixed together: pin HOME=SANDBOX and AGENT_WORKFORCE_HOME to sandbox
dirs so a broken fix refuses against a sandbox file. (This mirrors a real incident
found during authoring: a perturbation of test 2 wrote a junk entry into the real
~/.claude.json before the HOME=SANDBOX net was added; cleaned + guarded.)

[STRENGTH] Tests 1 and 2 independently confirmed non-vacuous (each reds when its
CONFIG branch is removed) and safe.

#### Iteration 2

[STRENGTH] All three tests independently perturbation-verified by the reviewer:
removing the configDir branch reds test 1; removing the CLAUDE_CONFIG_DIR branch
reds test 2; dropping the defaultAgentConfig carve-out reds test 3. Real config
(grep -c trust-test ~/.claude.json) stayed 0 through every perturbation. Env
save/restore complete and in finally for all four vars; all writes stay in SANDBOX.

### Final Ledger

Converged at iteration 2: no blockers, no warnings. The round-1 vacuity is resolved
and independently re-verified. trust.js unchanged; 39 tests, 39 pass. The fix a
future refactor could silently break (a data-loss delete-the-agent bug) now reds
its guard on every relevant branch.
