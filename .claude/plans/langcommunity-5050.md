# langcommunity-5050: community posts stay in English (follow-up to #5050 / PR #5118)

Card: joshualeestone/kosmos#5050. My own follow-up, from the 2026-10-03 joint review of the day-one merges (comment on
#5050, 04:3x). Splinter 07:51: build now; 0.7.22 if small and clean.

## Problem
#5118's language block tells an agent on a non-English Mac to write to the person, and in project rooms, in the
person's language. It said nothing about the Kosmos+ community. The community is one shared channel, and #5108's bug
triage (tools/kosmos-bugs-triage.js) groups --kosmos-bug reports by the words in their titles and searches cards with
them, so a Spanish report and an English report of the same bug would neither group nor match a card.

## Change
One sentence appended to `personlanguage.blockBody` (review 1 wording): "If you write on the Kosmos+ community, write in
English: posts, comments, replies and Kosmos bug reports alike, even when what you answer is in another language, so
every agent and the people who read it can follow." The existing block words (April's variant A and
her variant-B sentence) are unchanged. The boot sweep (`syncEveryone`) rewrites every agent's block in place, so the
sentence reaches existing agents at the next board start. An English Mac still gets no block.

## Measured (claude -p --model sonnet --tools "", --append-system-prompt-file = a real agent's instructions
(zz-test-4491) + the real community block (with the introduction line) + the es-MX language block; prompt = the
community turn's own INTRO_TEXT, asking for the post text only; run from an empty dir)
- CONTROL, the block WITHOUT the sentence: 1 of 4 posts in Spanish ("Cómo trabajo cuando el día se desordena ...").
- WITH the sentence: 4 of 4 in English.
The defect was real (the earlier comment called it unmeasured), and the sentence removes it at this sample size.

Rejected: letting community posts follow the person's language. It splits the shared channel and blinds the triage.
Weakest premise: 4+4 runs on Claude Sonnet only, Spanish only. A larger or different model could still drift.

## Tests
engine/personlanguage.test.js: the block's wording pin now also requires the community sentence as the block's last
sentence (and April's variant-B sentence still present). 26/26.

## Review 1 (blind, opus, 07:5x)
- [WARNING] The first wording said "Posts", but most community writing is comments and replies, and a reply to a
  Spanish comment was unmeasured. TAKEN: the sentence names posts, comments, replies and bug reports, "even when what
  you answer is in another language". MEASURED, a reply to a Spanish comment on the agent's own post:
  - CONTROL (the block without the sentence): 3 of 3 replies in SPANISH. So replies drift far more than posts.
  - NEW wording: 3 of 3 replies in English; the intro post re-checked: 2 of 2 English.
  Disclosure: my first control round for replies was VOID. The builder stripped the old sentence by its first words,
  the new wording starts differently, so the "control" file still carried the new sentence (grep count 1 in both).
  Caught by checking the file, fixed to strip by content, verified (control: Spanish block present, sentence absent),
  re-run. The void outputs are kept as VOID-out-1x in the scratchpad.
- [NIT] An agent outside the community got a sentence about community instructions it does not have. TAKEN: "If you
  write on the Kosmos+ community".
- [NIT] The first board start rewrites every non-English agent's file once (the .previous undo backup is replaced and
  each agent reads as on older instructions until restarted). Expected; for the 0.7.22 notes.
Totals measured: posts, control 1/4 Spanish vs new 6/6 English; replies, control 3/3 Spanish vs new 3/3 English.
