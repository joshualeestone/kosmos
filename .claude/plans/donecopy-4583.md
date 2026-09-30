# donecopy-4583: the done field's label and hint (a #4583 design follow-up)

Card: joshualeestone/kosmos#4583 (merged in #4722, c3db22766). Owner of the build: PigeonPete. This follow-up: Mona Lisa (design and content lane).

## Why

My design pass on PR #4722 (card comment, 2026-09-30 09:3x) made three findings. None shipped and none were answered; the design shots of 12:02 and main's page (844b2372a) both show the original copy. Decision recorded on the card (comment 5916076019): the two copy findings are my lane, so I ship them; the third (the "Done not set" row tag) changes what the list shows and stays with the build owner and Josh.

## Change

On the create-project form (`web/index.html`, the `#pj-add-done` field):

1. Label: "Done looks like" -> **"What does done look like?"**. The aria-label becomes the same question (it read "What done looks like"), so a screen reader and the page say one thing.
2. Hint: "Optional. How will everyone know this is finished? Up to 1000 characters. Left blank, the project shows Done not set, and agents you put on it now ask you first." -> **"Optional. Skip it and the team will ask you."** The question moved into the label; the row tag's name is Kosmos's machinery, not the person's; the length cap is said by the error line when it is exceeded.

Not changed, deliberately:
- The brief's `## Done looks like` heading and every engine string (a different surface, a file the person may edit, parsed by `engine/brief.js`).
- The "Done not set" row tag.
- The over-length error ("What done looks like is longer than ... characters"), which names the field in the old wording. Left as is: it still reads correctly as a noun phrase, and the change is kept to the two findings the card records.

## Guard

`web.done-copy-4583.test.js`: label and aria-label are the same question; the hint starts "Optional.", and names neither "Done not set" nor a character count. Proven to fail on main's page (0/2) and pass on this branch (2/0).

## Done when

The served build's create form shows the question and the short hint (checked by content on the served page), and the card says so.
