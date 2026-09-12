# #2919: project input placeholder copy

**Branch:** `project-placeholder-2919` · **Card:** kosmos#2919 (Josh 6.59 QA, 2026-09-12) ·
**Repo:** joshualeestone/kosmos (agent-workforce)

## The change

Josh's exact instruction: change the project composer input placeholder from
`Write to the project.` to `Write something or @name to message someone...` ("keep it as small as
possible"). One attribute in `web/index.html` (`#pj-post` textarea placeholder). Kept the existing
`&hellip;` ellipsis entity for rendering consistency (renders as `…`, verified).

## The comment reconciliation (why this is not a bare one-liner)

The comment block above the placeholder documented an EARLIER ruling (Mona Lisa): the placeholder
names the OUTCOME only, the `@name` MECHANISM is stated once elsewhere (a composer hint), and the
aria-label deliberately does not match the placeholder. But that hint was REMOVED in #2711 item 9, so
the `@name` affordance was left stated NOWHERE. Josh's 6.59 QA now puts the mechanism into the
placeholder itself. That supersedes the earlier ruling (there is no longer an "elsewhere" to carry
the mechanism). Josh is the operator and this is his newer, explicit instruction, so it wins - but I
must not leave the old comment standing, because it argues against the very change I am making
(CLAUDE.md convention #5: a comment asserting behavior the code no longer has). Rewrote the comment to
record Josh's #2919 decision and to preserve the still-valid part: the aria-label stays the plain
outcome ("Post to everyone on this project") for the screen-reader-context reason.

## What I did NOT change

The aria-label. Josh asked about the visible placeholder ("default text"); the aria-label is a
separate accessibility label whose outcome-focused wording is still correct and whose rationale
survives. Not touching it.

## Browser-check gate (#1720)

Copy-only change (a placeholder attribute + a comment), no logic or layout change, so the gate is
satisfied with a `Browser-check:` commit trailer stating the copy-only reason (the gate's sanctioned
path for exactly this). Additionally verified headless (pw-runtime): the rendered `#pj-post`
placeholder attribute is "Write something or @name to message someone…". `web.post-click.test.js`
(the composer post flow) stays green.

## Verification for Josh (josh-review)

The placeholder is a static attribute; it renders as typed. Josh sees the new text in the running
app's project composer.
