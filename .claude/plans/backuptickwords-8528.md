# backuptickwords-8528: the mayBackUp comment says what the company words name now (kosmos#8528)

Board-side follow-up to kosmos-relay #867 (#8528, merged f6a0aa3db) and kosmos-relay #869 (#7404, merged 7aa684a3c).
Comment only: engine/backuptick.js, the block above mayBackUp(). No code, no behaviour change.

## What
The comment said "A company's words list nothing under backsUp today, so a company computer backs up nothing until new
words that do are accepted here." Since relay #867 that is false: the company words name what a company backup sends.
It now says:
- a company's words listed nothing under backsUp until relay #867;
- a computer still on words that list nothing backs up nothing until it takes the newer words (#5791 does that itself);
- the coordinator also needs KOSMOS_COMPANY_BACKUP=1 for any company upload (#7404).

## Decisions
- Name the relay PR and the switch, so a reader of the board code knows a company backup has two gates: these words on
  the board, and the coordinator's switch. Rejected: deleting the sentence (it would leave no trace of why an older
  computer still backs up nothing).
- Landed only after both relay PRs merged, so every name in it exists on relay main.

## Weakest premise
"#5791 does that itself": that a company's board accepts changed words on its own. It was measured for #8528's
review (round 1 corrected my premise that a member reads them). If it is wrong, the sentence overstates.

## Validation
Comment only. Full kosmos validation on Mortals (mortals-validate.sh) before the PR, as for any kosmos change.
