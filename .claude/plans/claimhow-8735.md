# claimhow-8735: #8735, the claim protocol's cases print on demand with `kosmos claim --how`

## Call
Ranked #2 on #8735. "Answering where you were asked" kept a 1,242-character claim paragraph. It now keeps every rule an
agent needs at the moment of claiming: claim before you say you are taking it; post only if the claim is yours, and
what to do when Kosmos does not answer; do not post if someone else holds it or the post asks someone else; give it back
with --release if you stop, keep it when done; a raised hand from the person agrees with a claim. A pointer names the
rest, which prints from engine/claimguide.js through `kosmos claim --how` in both CLIs, most lines word for word: someone
else holding it, how `kosmos room` shows a claim, how long it lasts, a stale claim, a room shared with another computer;
plus `--status`. Doctrine 56. Same pattern as slice 2's `kosmos task --how`.

Review rounds 1 and 2 each put a moved rule back (the raised hand; Kosmos not answering): both are decided at the moment
of claiming, which is the test for what stays.

## Stacked, then rebased
Built on PR #8814's final head (42c0c34694) while the 0.8.12 merge hold was on, so the work did not wait. #8814 merged
(6fc078dfb3); this branch was then rebased with `git rebase --onto origin/main 42c0c34694` (clean). tools/doctrine-past.js
regenerated from main came out identical to the table on the branch (the v55 rows, merged in by hand while stacked,
match main's), and the v56 pins and the brief size were re-checked on the rebased tree.

## Rejected
- Keeping "if a claim looks stale, ask its holder or the person, not the room" in the brief: the pointer names a stale
  claim, and seeing a claim at all already means do not post that you are taking it. "And say so in the room" when it
  is done also moved; the CLI's own success message tells the agent to say in the room what it is doing.
- Moving "post only if the claim is yours" or "do not post if someone else holds it" too: those are the rule at the
  moment of claiming, and a wrong post is what the protocol exists to stop.

## Measured (on the rebased tree, unless marked)
- pm brief 46,305 -> 45,919 (darwin), 386 characters. Ratchet 46,400 -> 46,000. main's working rules are the same text
  as #8814's head, so the figure did not move with the rebase; the brief-size test passed on the rebased tree.
- engine/claimguide.test.js: both CLIs print the guide byte for byte, refuse extra words, and name --how in the usage; the
  working rules keep every at-the-moment rule and the pointer on every platform; the moved lines are in the guide and
  not the brief.
- Re-read: exactly 10 word-for-word lines are left out as moved ("Left out: 10 lines ... that kosmos claim --how
  prints"); re-wrapped lines stay marked and the conditional sentence covers them; a file whose heading is gone hides
  nothing (control); the note fires only for the v55 move (round 5: the section also holds posting and reacting rules,
  so a later change there gets no claim note; control). Fixture equals the base's paragraph (1,242 characters). Perturbed red.
- 1,768 related tests (defaults, doctrine, dmfiles, messages, instructionreread, claim CLI, Windows parity), 0 failed,
  on the rebased tree.

## Weakest premise
That an agent runs `kosmos claim --how` when one of those cases comes up. The pointer names the common ones.
