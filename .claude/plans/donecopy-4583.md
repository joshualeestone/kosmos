# donecopy-4583: the done field's label and hint (a #4583 design follow-up)

Card: joshualeestone/kosmos#4583 (merged in #4722, c3db22766). Owner of the build: PigeonPete. This follow-up: Mona Lisa (design and content lane).

## Why

My design pass on PR #4722 (card comment, 2026-09-30 09:3x) made three findings. None shipped and none were answered; the design shots of 12:02 and main's page (844b2372a) both show the original copy. Decision recorded on the card (comment 5916076019): the two copy findings are my lane, so I ship them; the third (the "Done not set" row tag) changes what the list shows and stays with the build owner and Josh.

## Change

On the create-project form (`web/index.html`, the `#pj-add-done` field):

1. Label: "Done looks like" -> **"What does done look like?"**. The aria-label becomes the same question (it read "What done looks like"), so a screen reader and the page say one thing.
2. Hint: "Optional. How will everyone know this is finished? Up to 1000 characters. Left blank, the project shows Done not set, and agents you put on it now ask you first." -> **"Optional. If you skip it, one of the agents you add here will ask you."** (reviews 1 and 3: the room note is posted only by the create handler, and only when the project is created with agents, and it asks for ONE question from one agent; a project staffed later gets no note, so the hint promises only what happens at creation) The question moved into the label; the row tag's name is Kosmos's machinery, not the person's; the length cap is said by the error line when it is exceeded.

Not changed, deliberately:
- The brief's `## Done looks like` heading and every engine string (a different surface, a file the person may edit, parsed by `engine/brief.js`).
- The "Done not set" row tag.
- The engine's refusals ("What done looks like has to be words.", "Keep what done looks like to 1000 characters"). The page routes them to the done box by matching that exact text (web/index.html, the /^(what done looks like has to be words|...)$/i test), so renaming them is a paired engine+page change in the build owner's code, not a copy edit. The page's own over-length check now says "That answer is longer than N characters", like its description sibling ("That description is longer than ...").

## Guard

`web.done-copy-4583.test.js` (source): label and aria-label are the same question; the hint starts "Optional.", and names neither "Done not set" nor a length; the too-long error is "That answer is longer than", the same shape as the description's. Fails on main's page (0/3), passes here (3/3).

`docs/browser-checks/render-project-done-4583.js` (rendered, review 4): on the real form, the label's words and the box's aria-label are both "What does done look like?", and the hint is shown and names neither the row tag nor a length. Control: the same check on main's page must fail.

## Done when

The served build's create form shows the question and the short hint (checked by content on the served page), and the card says so.
