---
method: challenge-loop
branch: musequota-7615
diff_hash: 6d3bfc35df9ea05afe299f0884da6457e1cef75899b2d809bca4ca7555540aa8
timestamp: 2026-10-30T14:20:09Z
iterations: 8
converged: true
---

# Challenge-loop proof: musequota-7615 (kosmos#7615 item 4: a Muse Code quota refusal says it is a quota)

Eight blind code reviews, one at a time, each by a fresh agent, over engine/muserun.js and its tests. The usage rule
stops review at eight rounds unless a BLOCKER is open. Round 8 found no BLOCKER and no leak, and its five SHOULDs were
fixed after it. Those fixes were checked by a 59-mutation sweep of every guard (tests filtered to this card, with a
green unmutated control) rather than by a ninth review. Every mutation was killed. The principle changed twice: in
round 4 (when unsure, say what Kosmos said before) and in round 7 (quote only the refusal's words and a reset time).

#### Iteration 1 (blind code review)
Four WARNINGs, fixed: the event stream is read by allowlist (only a failure's own error/message/reason, never JSON or a
tool's output, after a probe quoted a path and a token); nested error.message read; the last matching line wins and a
retry is skipped; the quota and the refusal word must be close, and a negation is refused.

#### Iteration 2 (blind code review)
Three WARNINGs, fixed: only run.failed/run.error or an uncompleted terminal event count as a failure (never a tool's);
the retry filter is for stderr only; a failure's own words win over an earlier stderr warning. A share below 100% is a
notice.

#### Iteration 3 (blind code review)
BLOCKER, fixed: "context window exceeded. Quota for this session: 200k" read as a quota. The quota and its refusal word
must sit in one phrase. A code-only failure lets stderr be read. Two fixtures used a field that was never read.

#### Iteration 4 (blind code review)
Two BLOCKERs, fixed, and the principle changed (a wrong claim sends a person to billing; a miss keeps today's line): a
429 alone is never a quota; the line says "so Muse Code stopped", true for a turn that ran partway, and a completed
turn is never called a quota stop.

#### Iteration 5 (blind code review)
BLOCKER, fixed: a disk, file or storage quota on this computer read as Meta's. A line must say the quota is the
provider's. Secrets after more separators hidden; only the refusal's sentence quoted.

#### Iteration 6 (blind code review)
Two BLOCKERs: a rate limit with a 429 read as a quota, and keys after "client_" or "refresh_" quoted. Fixed in round 7
by a change of principle rather than more rules (see iteration 7).

#### Iteration 7 (principle change, then sweep)
A refusal names the subscription or usage quota with its refusal word, or is insufficient_quota. Any sign of a rate,
share, fallback, tool, local quota, negation or false flag refuses the line, as does a wait under an hour. Only the
matched words and a strictly matched reset time are quoted, so nothing else on the line can reach the person. A
43-mutation sweep killed every guard.

#### Iteration 8 (blind code review)
No BLOCKER, no leak under every probe. Five SHOULDs, all fixed: more forms of a short wait (and hours counted as
hours); joined rate-limit names and "/min"; "haven't", "never" and if-help-text; the reset time read only from the
refusal's own clause, and never with a zone it would drop; a cause-naming failure code beats stderr. NIT fixed: a
phrase followed by "_" is a field name. The 59-mutation sweep killed every guard.
