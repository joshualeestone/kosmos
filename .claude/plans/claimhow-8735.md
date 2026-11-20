# claimhow-8735: #8735, the claim protocol's cases print on demand with `kosmos claim --how`

## Call
Ranked #2 on #8735. "Answering where you were asked" kept a 1,242-character claim paragraph. It now keeps the rule
(claim before you say you are taking it; post only if the claim is yours; do not post if someone else holds it; give it
back with --release if you stop, keep it when done; a raised hand from the person agrees with a claim, round 1: decided
at the moment of claiming) and a pointer naming the cases. The cases print from engine/claimguide.js through
`kosmos claim --how` in both CLIs, most lines word for word: Kosmos not answering, someone else holding it, how
`kosmos room` shows a claim, how long it lasts, a raised hand, a stale claim, a room shared with another computer; plus
`--status`. Doctrine 56. Same pattern as slice 2's `kosmos task --how`.

## Stacked, deliberately
Branched from PR #8814's final head (42c0c34694, all CI green, waiting only on the 0.8.12 merge hold) so the work did
not wait. After #8814 squash-merges: `git rebase --onto origin/main 42c0c34694`, then regenerate doctrine-past (the v55
rows are merged in by hand from #8814's table until then, because tools/doctrine-past.js reads origin/main) and re-pin.

## Rejected
- Moving "post only if the claim is yours" or "do not post if someone else holds it" too: those are the rule at the
  moment of claiming, and a wrong post is what the protocol exists to stop.

## Measured
- pm brief 46,305 -> 45,835 (darwin), 470 characters. Ratchet 46,400 -> 45,900.
- engine/claimguide.test.js: both CLIs print the guide byte for byte, refuse extra words, and name --how in the usage; the
  working rules keep the four rules and the pointer on every platform; the moved lines are in the guide and not the brief.
- Re-read: the moved lines are left out as moved ("Left out: N lines ... that kosmos claim --how prints"); a file whose
  heading is gone hides nothing (control). Fixture equals the base's paragraph (1,242 characters). Perturbed red.
- 1,768 related tests (defaults, doctrine, dmfiles, messages, instructionreread, claim CLI, Windows parity), 0 failed.

## Weakest premise
That an agent runs `kosmos claim --how` when one of those cases comes up. The pointer names the common ones.
