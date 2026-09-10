# Plan - #2649: Settings AI-Models not-signed-in status collides with the email line

**Card:** joshualeestone/kosmos#2649 (design/frontend, claimed via Splinter). Josh product-review.

## The bug
In Settings > AI Models, a Claude account in the "not signed in" state renders its long
status ("Anthropic says this account is not signed in", the `.acct-none` badge) overlapping
the account email. The account row `.acct-box-top` is a nowrap flex row where `.acct-who`
grows (`flex: 1`) to fill the line and the badges carry `white-space: nowrap`, so a long
`.acct-none` sentence overruns the (non-truncating) email. OpenAI's short "Signed in"
(`.acct-connected`) sits cleanly right-aligned, which is why only the long state looked broken.

## The fix (CSS only, web/index.html ~536)
- `.acct-box-top`: add `flex-wrap: wrap` and a row-gap so a badge that does not fit drops to
  its own line instead of overlapping.
- `.acct-who`: `flex: 1` -> `flex: 0 1 auto` so it no longer forces the badge off the line; the
  badge's right-alignment now comes from `margin-left: auto`.
- The three status badges as direct children of `.acct-box-top` (`.acct-connected`,
  `.acct-none`, `.acct-unknown`): `margin-left: auto; max-width: 100%; white-space: normal` so
  a SHORT badge stays inline at the right and a LONG status wraps onto its own line below.

Net: short "Signed in" is unchanged (inline right); the long not-signed-in status reads cleanly
on its own line. Scoped to `.acct-box-top >` so it does not touch `.acct-prov-head` or other rows.

## Weakest premise
The exact not-signed-in class is `.acct-none` (the genuine negative, warn tokens), confirmed
from the CSS; `.acct-unknown` (muted "could not check") is included for the same-shape long text.
If a future `because` sentence is shorter it simply stays inline. Reversible CSS.

## Verification
Rendered old-vs-new side by side via headless Chrome at card width: the old CSS reproduces the
overlap, the new CSS drops the status to its own line with no overlap and leaves the signed-in
row unchanged. Plus the node suite. Not this card: the AUTH failure (why it reads not-signed-in)
is Angel's connect fix (engine/connect.js), confirmed auth-only, zero collision.

## Out of scope
The auth/credential capture (Angel). The onboarding-seed auto-import (#2651, Angel/seed lane).
