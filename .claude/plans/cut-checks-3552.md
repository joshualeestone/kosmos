# cut-checks-3552

Card: kosmos#3552 (0.6.91 staging cut blocked by 5 cut-time-only browser checks red on
origin/main). This branch fixes the ONE red that is my regression:
`render-prompter-label-1843`.

## Scope (deliberately narrow)

#3552 is a coordination card: five cut-time-only render-* checks (the #2518 class, not on
any PR gate) went red on origin, each staled by a different night's merge. The card's own
analysis concludes each needs its OWNING agent to decide fix-code vs update-check, because a
stale check "fixed" to match a guess of another PR's intent can enshrine a bug. So this
branch fixes only the check I own and routes the rest.

## What this fixes

`render-prompter-label-1843`: it asserted the Settings > Automation section headings are
exactly `[Auto-save, Prompter, Agent Communication, Daily report]`. My #2619 (merged as
#3549) added the Recommender and Assigner automations (shipped as disabled "not active yet"
controls), making six headings, so the check went red and blocked the cut. #3549 updated the
node sibling (web.settings-nav.test.js) but not this cut-time-only browser check.

Fix: update the expected headings to include `Recommender, Assigner` (the automations ARE
meant to appear there - they are Settings controls, just disabled until the behaviour lands).
This mirrors what #3543 did for render-fields.

## Verification

Ran the check headless via pw-runtime against a sandboxed board: every assertion PASSES in
both light and dark themes, and the headings assertion reads the six expected headings.

## Explicitly NOT in this branch (routed to owners on the card)

- `render-talk-fill-2622` (snav height ballooned) - #3547 agent-nav redesign author's intent.
- `render-thread` (focus does not move to composer) - #3493/#3536 area; possibly a real
  behaviour regression, needs the thread-column author.
- `render-push-718` (empty mapped notification) - webpush-718 (#3510 still OPEN); incomplete
  work, not a stale check.
- `contrast` (agent-panel "remove" control unreachable) - whoever moved/renamed that control.
- The two contention-only flakes (render-create-form, render-type-to-focus-3283) clear on a
  quiet re-cut; no fix needed.

## Weakest premise

That Recommender/Assigner are meant to render in the Automation section. They are - I built
them there in #2619 as disabled Settings controls, and Josh's routing (via Splinter) approved
that scope; the section is the correct home. If that were reversed, the automations (not this
check) would change.
