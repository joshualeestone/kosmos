# Plan: retitle the "Agents talking to each other" automation to "Agent Communication" (#2619)

Branch: `agentcomm-retitle-2619`
Repo: `joshualeestone/kosmos` (worktree `agent-workforce-agentcomm-2619`)
Author: Mona Lisa (design/content), 2026-09-10
Card: #2619 (claimed:monalisa)

## Scope of this branch

#2619 (Josh's review of Settings > Automations) has three parts:
1. Verify the existing toggles work (Auto-save, Prompter, Agent Communication, Daily report).
2. Retitle "Agents talking to each other" to "Agent Communication".
3. Add two new automations: Recommender and Assigner.

This branch does ONLY part 2, the retitle, which is the copy change in my lane. Josh gave the
exact new string ("Agent Communication"), so it is used verbatim. Parts 1 (behavioural
verification) and 3 (two new feature automations with default-checked guards) are Angel's engine
lane, so `Addresses #2619` is non-closing and the card stays open for them.

## Decision

Retitle the section heading of the conversation-limit automation block:

- `web/index.html`: `<h3 class="dlab">Agents talking to each other</h3>` becomes
  `<h3 class="dlab">Agent Communication</h3>`. Nothing else in the block changes (the toggle,
  the hint, the tier select, the off-state sentence, and the toggle's own aria-label
  "Limit how often your agents message each other" all stay).
- Update the two adjacent history comments so they do not drift from the new heading: the block
  is now "Agent Communication" (Josh's retitle #2619, formerly "Agents talking to each other"),
  and the heading line is no longer part of the "Mona Lisa's verbatim copy" claim (Josh
  retitled it), while the hint and off-state sentence still are.
- `web.settings-nav.test.js`: re-anchor the two pins (the `<h3>Agent Communication</h3>` match
  and the ordered-headings array), strengthen the negative assertion to confirm the old heading
  no longer survives, and update the descriptive test name and positional comment.

## What was rejected and why

- **Rewording Josh's string to something plainer** (his usual voice is plain, and "Agent
  Communication" is more formal than "Agents talking to each other"): rejected. Josh gave the
  exact retitle; the standing rule is to use his copy verbatim and never vernacular-improve it.
- **Doing parts 1 and 3 here:** rejected. Verifying toggle behaviour needs the running app, and
  building the Recommender/Assigner automations is an engine/feature change in Angel's lane.

## Weakest premise

That the heading Josh means is this section's `<h3 class="dlab">`, not the toggle's own inline
label ("Limit how often your agents message each other"). The card lists "Agents talking to each
other" as one of the Automations toggles by its section heading, and that heading is the only
place that string appears, so this is the right target. If Josh meant the inline label too, that
is a one-line follow-up. Reversible.

## Scope / verification

Copy-only (one heading string), plus comment and test-pin updates. This is a `web/` change, so
it carries a `Browser-check:` trailer for the #1720 gate. Full node suite must stay green (the
re-anchored `web.settings-nav.test.js` pins). No behaviour change; the block's stored value and
toggle are untouched.
