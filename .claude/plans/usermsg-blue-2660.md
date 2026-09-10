# usermsg-blue-2660, colour the person's own messages royal blue

## What Josh asked (his channel, 2026-09-10, #chaoskosmos-design)

Put a light colour behind the messages the person posts, in the dialog boxes on
projects and to agents, using the Kosmos+ royal-blue primary `#4171E3`. Refined
live over several messages:

- Light mode: `#4171E3` at **10%**.
- Dark mode: **15%** (a touch more presence on the dark ground). Josh compared
  10%/10%, 10%/20%, and 10%/15% in preview and picked 15% for dark (2026-09-10).
- **No strokes** on any message box, either theme, "just the color."
- **Only the person's own messages are coloured.** Agents get **no background at
  all** (plain), so Josh can slide back to where he last plugged something in.

## Done-condition

The person's own message bubble (to an agent) and their own project-room message
card carry a `#4171E3` wash, 10% light and 15% dark, with no border; agent rows
carry no fill; both themes correct (system light, system dark, and the manual
`data-theme` toggle in both directions); the full suite stays green.

## The surfaces (verified in web/index.html, first-hand)

- **To an agent / operator DM view + project room bubble**: `.dm-b`, one class
  for both surfaces (`dmRow` and the project room). The person's own row is
  `.dm.mine .dm-b`. The agent's side IS stored and rendered now, as `.dm.theirs`
  (dmRow, since #175, keyed on `m.from`), so NOT every bubble is `.mine`. That is
  exactly why the fix works: `.dm.theirs .dm-b` takes the `.dm-b` default, which
  this change sets to `transparent`, so the agent side has no fill while only
  `.mine` is tinted.
- **Project room message card**: `.pj-msg`; every one is a message the person
  posted (the stored side; an agent reply is read live off the pane, not kept).
  Had a `0.5px` separator border; now fill-only.

## Changes (all in web/index.html, CSS only)

1. `.dm-b` base background `var(--k-sunk,...)` becomes `transparent`, so the agent
   side (`.dm.theirs`, and the `.dm-b` default generally) loses its tint; only
   `.mine` carries a fill.
2. New token **`--usermsg-tint`**, the royal-blue wash (`#4171E3` = rgb
   65,113,227), defined once per theme beside `--k-sunk`: `.10` in light `:root`,
   `.15` in the system-dark and forced-dark blocks, `.15` in the navy theme. This
   replaces the raw literal and matches how `--k-sunk` (the token this design
   replaces) is themed, so a future opacity change is one edit per theme rather
   than four scattered rules plus generated twins (challenge-loop iteration 2
   CONVENTION, the codebase's "two derivations of one fact" defect).
3. `.dm.mine .dm-b` and `.pj-msg` both set `background: var(--usermsg-tint)`.
   Because the token flips per theme, there are no per-selector dark overrides and
   no forced-dark twins for these two rules; the token carries the light/dark
   difference on its own.
4. `.pj-msg` drops its `0.5px` border (the no-stroke rule).
5. `.pj-msg.failed` re-declares its own `0.5px dashed` border (the base border it
   used to inherit is gone, so a bare `border-style` would draw nothing and the
   failed-delivery cue would vanish silently). `.pj-msg.unsure` is NOT untouched:
   it kept its own `border-left` (the warn-ink rule that was always its real cue)
   but, like the normal box, lost the surrounding `0.5px` hairline it used to
   inherit. Deliberate and verified: dropping unsure's incidental frame matches
   the no-stroke intent, and its left rule still marks it as needing a look.
   Confirmed by rendering the failed/unsure states on the blue fill in both
   themes (challenge-loop iteration 1 WARNING).

## What I rejected / weakest premise

- Rejected keeping the agent's `--k-sunk` tint: Josh's "only the user-part
  coloured, agents no background" is explicit and overrides the historical
  `.dm-b` default. The `.dm.theirs` branch makes this clean: it takes the
  transparent default, no `.theirs` rule needed (adding a visible `.theirs`
  bubble is the wrong move per the file's own dissolve note ~400 lines up).
- Weakest premise: that every `.pj-msg` is a user message. Verified against the
  render (`pj-msg` carries a delivery verdict; the agent side is read live, not
  stored), but if an agent-authored `.pj-msg` is ever added it would inherit the
  tint; revisit then.

## Verification

- Canonical suite via `yarn test` (`tools/run-tests.sh`, which also runs the
  shell-syntax and browser-check gates and the every-test-considered self-check):
  5800 node tests pass, 0 fail. Run through the challenge-loop's validation helper
  (`validation_log_run_or_skip`) each iteration.
- `web.theme.test.js` (13 tests) confirms the forced-dark section is in step with
  the system-dark one after `tools/sync-forced-theme.js`.
- Faithful headed-Chrome previews of both themes at the target opacities, shared
  with Josh in-channel; he picked 10% light / 15% dark. Failed/unsure state cues
  rendered on the blue fill and confirmed to read in both themes.

## Not this change

Angel owns integrating any behaviour; this is a pure presentation change to the
existing bubble classes. No structural or logic change.
