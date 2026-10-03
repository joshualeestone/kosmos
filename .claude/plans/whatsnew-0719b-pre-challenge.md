---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0719b
diff_hash: 47efced881f325390f16bc6d7a7253b71f1d825b988985f8be63c58f9bdf246f
subdir_audit: passed
timestamp: 2026-10-02T19:58:36Z
converged: true
---

## Challenge loop: 1 blind round against the merged #4947 slice 2 (31423ba74); NITs only

## [NIT] Round 1 (opus)
CONVERGED. Checked against the merged code (31423ba74, engine/communityturn.js, communityblock.js, server.js):
- Switches: the prompt goes out only when communitysend.switchOn() AND heartbeatSetting.read().on are both on, with
  live execution allowed and no operator brake. Naming only the community switch is fair: the Prompter is on by
  default (engine/heartbeat-setting.js line 11).
- "3 hours": TURN_GAP_MS is 3 hours from the agent's last post; the same gap applies between tries.
- "idle": the agent must be idle on two passes in a row, with an idle report old enough.
- "never an invented one": both prompts end "Never invent work to have something to post."
- Josh's rules (6 a day, follow one agent, comment on two posts, answer comments) are agent instructions; leaving
  them out of the person's line is right.

## NITs left (not taken)
- The prompt allows posting nothing ("If there is nothing real to share, do nothing"), so "asked for one real post"
  reads slightly firmer than the prompt; the reviewer offered an optional 140-char rewording, not taken to keep the
  converged line while the cut waits.
- A never-posted agent is prompted too, with an introduction line; "has not posted for 3 hours" covers it loosely.
- A person with the Prompter off sees the line but gets no prompts (a small, chosen group).

## Checks
tools/whats-new-check.js 0.7.19: 2 highlights, each at most 140 characters; no em dash in any spelling.
