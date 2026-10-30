---
pre_challenge: true
method: challenge-loop
branch: workcap-7406
diff_hash: e1fb48c028e6ecaa84cbfe1e275013e2fcf72814e346fb89151c42b36272d49a
validation: On the tree with main merged (10 commits): 509 page-reading files plus the static guards, 6046 pass / 0 fail; the Settings browser check render-prompter-label-1843 all passed (light and dark, with the per-account cap's save round-trip); the two surface-flagged checks (render-unread-edge-3743, render-agentdm-3414) pass headless and carry trailers. The 91 affected engine/server files: 1762 pass, 0 fail before two source pins were updated (then 65/65). Mutants of the opt-in at three sites, the back-off, the box rule and the queue rule each turned a test red.
subdir_audit: passed (no CLAUDE.md in the diff)
timestamp: 2026-10-28T04:59:53Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (blind reviewers alternating opus and sonnet, every round the whole branch with nothing settled)
**Converged:** Yes. Round 8 found no blocker and no real defect. Design approved by Mona Lisa (label, hint text).

#### Iteration 1 (opus)
[BLOCKER] A person's DM kept for a usage limit went through the automatic gate, so the cap could hold it and drop it a day later.
[WARNING] An Enter on a remembered line could be capped; cap notes lived in memory only; the retry could rewrite the held file every minute (#4797); the cap read a launch job even when off; log wording named only Gemini.
All fixed (see iteration 7 for how the first two were finally closed).

#### Iteration 2 (sonnet)
[BLOCKER] A person's task message kept for a usage limit could also be held, and one held entry stops the queue.
[WARNING] Two defensive strings named Gemini only.

#### Iteration 3 (opus)
[BLOCKER] The cap retry waited for an empty input box, which only a Claude box can report, so Codex/Grok/Gemini-key members were never retried. Fixed: the box rule is Claude-only.
[BLOCKER] The note of the person's own post from another computer could be held.
[WARNING] Exempting the whole usage-limit queue re-created the reset burst: an agent-only queue is capped again.
[WARNING] Account grouping: realpath of the folder, runner from the job.

#### Iteration 4 (sonnet)
[WARNING] A note for a digest room's quiet post skipped the member's other retry paths; a note could be dropped while posts were taken out; drop notices could be held with no retry. All fixed.

#### Iteration 5 (opus)
[WARNING] A non-Claude member on its own prompt was retried every minute: a ten-minute back-off after a retry that reached nothing.
[NIT] Hint, comments and the brake's scope corrected.

#### Iteration 6 (sonnet)
[WARNING] The nudge about the person's unanswered ask could be held.
[NIT] A misplaced docblock; an unpruned memo.

#### Iteration 7 (opus)
[BLOCKER] The first-reply nudge and the reply nudge (a person's community comment) could be held.
[WARNING] Every { cap: false } exemption also lifted the Gemini cap.
Root fix, not a sixth exemption: the cap is OPT-IN. It holds only a sender that passes workCap: true (other agents' room posts, posts kept for a member, the Assigner, an agent-only kept queue). Every exemption this branch added was reverted; the Gemini cap is as on main everywhere; the hint names what is held.

#### Iteration 8 (sonnet, final, whole branch)
No blocker, no warning.
[NIT] The Assigner can hold a task a person wrote: accepted, the hint says "the tasks it hands out".
[NIT] An explicitly named default folder groups apart from a null one: accepted (create writes null for the default; it only undercounts).
[NIT] A capped kept-queue entry is re-checked each minute: accepted (a gate check, no keystroke, write or log line).
