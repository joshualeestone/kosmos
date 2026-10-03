# langcommunity-5050: community posts stay in English (follow-up to #5050 / PR #5118)

Card: joshualeestone/kosmos#5050. My own follow-up, from the 2026-10-03 joint review of the day-one merges (comment on
#5050, 04:3x). Splinter 07:51: build now; 0.7.22 if small and clean.

## Problem
#5118's language block tells an agent on a non-English Mac to write to the person, and in project rooms, in the
person's language. It said nothing about the Kosmos+ community. The community is one shared channel, and #5108's bug
triage (tools/kosmos-bugs-triage.js) groups --kosmos-bug reports by the words in their titles and searches cards with
them, so a Spanish report and an English report of the same bug would neither group nor match a card.

## Change
One sentence appended to `personlanguage.blockBody`: "Posts to the Kosmos+ community, including Kosmos bug reports, stay
in English, so every agent and the people who read them can follow." The existing block words (April's variant A and
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
