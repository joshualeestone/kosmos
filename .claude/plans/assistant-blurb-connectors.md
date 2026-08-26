# Plan: assistant-blurb-connectors

Vivienne, REPLY on 2026-08-25, following up on #933 (the Email Assistant
firstAction/blurb fix she originally flagged). Her point: #933 fixed
both the blurb and firstAction for Email Assistant, not just the
firstAction she'd first drafted a rewrite for. That raises the bar for
what counts as "the same defect" elsewhere in the catalogue -- when she
first said to leave Executive Assistant alone, the standard was
firstAction-only, and its firstAction is genuinely conversational and
survives a clean install. Once the blurb also got fixed for Email
Assistant, leaving Executive Assistant's blurb making the same
live-connector claim became inconsistent.

She swept the rest of the catalogue for the same shape and reports
exactly two more: Executive Assistant and Personal Assistant. Verified
both independently before touching anything:

- `ea` (Executive Assistant), blurb: "Manages email, calendars, meeting
  preparation, and follow-ups" -- claims live email/calendar management.
  Neither Gmail nor Google Calendar exists in `SVC_BUILT`
  (web/index.html); `web.svc-doors.test.js` pins both as coming-soon.
  firstAction ("Tell me what is coming up this week...") is
  conversational and stays as-is.
- `personal` (Personal Assistant), blurb: "Handles your personal email,
  calendar, and bookings, kept separate from work" -- same claim.
  firstAction ("Tell me what is coming up in your personal life this
  week...") is also conversational and stays as-is.

Checked the two candidates she ruled out and confirmed her reasoning:
Household Manager's "family calendar" reads as the household's own
schedule, not a connected Google Calendar, and its firstAction ("Tell
me what is falling through the cracks at home...") names no mechanism.
Family Coordinator is the same -- no mechanism named, firstAction is
"Tell me who is in the family and what is on this week...". Both are
satisfiable by someone telling the agent what's going on, so neither
needed a change.

Also re-read both roles' full `instructions` blocks (the actual system
prompt, where #933's challenge-loop caught a deeper instance of this
same defect on the Email Assistant role) -- neither Executive Assistant
nor Personal Assistant makes a live-account claim there. Both already
describe the job as handling "traffic" and things "arriving," not
reading an inbox directly. No instructions change needed.

## Change

`engine/roles.js`, two blurbs only:
- `ea`: "Manages email, calendars, meeting preparation, and follow-ups"
  -> "Sorts what is forwarded to it, preps you for meetings, and
  chases follow-ups"
- `personal`: "Handles your personal email, calendar, and bookings,
  kept separate from work" -> "Sorts what is forwarded to it, drafts
  personal bookings, kept separate from work"

Copy only, no code paths touched.

## Verification

- [x] `node --test web.role-picker.test.js engine/create.test.js`:
      107/107 pass.
- [x] Grepped for the old copy across `.js`/`.html`: none found.
