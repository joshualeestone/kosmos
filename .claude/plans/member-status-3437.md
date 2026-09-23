# member-status-3437, drop the agent-status line from the project members column (#3437)

## Ask (Josh, windows channel 2026-09-22, a "small side issue")
Projects -> [a project] -> the left MEMBERS panel: each member box prints an agent-status line under
the name/role, e.g. "We cannot tell whether it has this yet" (seen on Helen of Troy + Marcus). We are
NOT supposed to print agent status on the member boxes on this view. Fix: name + role only; status
belongs on the agent/view pages.

## Change (web/index.html, pjMember renderer)
- Gate `pjMemberHasIt(m)` on `hideState`: `+ (hideState ? '' : pjMemberHasIt(m))`. The project members
  column paints with hideState=true (paintOneProject), so the "has it" line drops there; the Settings
  members list paints with hideState=false (paintSettingsMembers), so it stays where a person managing
  membership can use the signal. Matches how the per-member STATE LABEL is already gated (#3131, where
  the project column is deliberately minimal, only the needs-you triangle speaks).

## Decisions
- Gate the whole pjMemberHasIt, not just the 'unknown' arm: the 'stale' remedy button was already
  pulled (#761), so pjMemberHasIt renders non-empty ONLY on the 'unknown' arm today. Gating the
  function therefore changes exactly the one line Josh reported, and nothing else, while staying robust
  if a future arm starts rendering again (the project column stays minimal by construction).

## Verification
render-project-members-3387.js gains a #3437 assertion pair: pjMember(hideState true) has no
pj-notyet / "We cannot tell whether it has this yet"; pjMember(hideState false) still does (control:
the gate is conditional, not a blanket removal); name + role still render. Negative control run: un-
gating the source reds the project-column assertion in both themes. Full suite green.
