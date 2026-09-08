# Plan: a capability one-liner on every Connections pill (kosmos#529)

## Goal
The Connections settings tab lists services as pills; clicking one opens a "door" with
connect instructions. The four core pills (GitHub, Vercel, Cloudflare, Gmail) each carry a
plain one-line description in `SVC_DOORS` ("what this is. Connect it and your agents can
&lt;capability&gt;."). The 18 token-service pills carried none, so a person met a bare service
name (e.g. "Tavily", "Neon") with no cue what it is or what connecting it does. This is the
copy residual Ice Cream Kitty flagged on #529 ("every sentence on these doors is placeholder
for Mona Lisa").

## What "done" looks like
- Each of the 18 token-service pills (Discord, Brave Search, Exa, Tavily, Serper, GitLab,
  Fly.io, DigitalOcean, Hetzner, Netlify, Render, Notion, Linear, Airtable, Neon, Postmark,
  SendGrid, Better Stack) has a one-liner in `SVC_DOORS`, same shape as the core four.
- Each line is honest about the service's actual token scope: a "the X you allow / share"
  framing ONLY where the connect flow has a real per-resource scoping step (its spec in
  engine/tokendoors.js carries a `hint`), e.g. Notion (pages), Airtable (bases). A broad or
  navigational-hint token gets a broad line with no invented per-resource restriction, and a
  line never claims a capability (read vs write) beyond the hint that renders below it.
- The three "placeholder until Mona Lisa says it" flags in the door render are discharged
  (the door copy was reviewed and is in Josh's voice, no em dashes, honest about who holds
  the key).
- No door flow or render logic changes: this is copy only.

## Implementation
- Add the 18 entries to `SVC_DOORS` (web/index.html), consumed by the existing unchanged door
  render (`svcDoorText` / `svcDoorLiveHtml` / `svcDoorTokenHtml`), which already wraps
  `SVC_DOORS[name]` in `esc()`.
- Replace the three "placeholder" render comments with a "reviewed by Mona Lisa" note.
- Pin the new sentences (present and non-empty, scoped to the SVC_DOORS object, not the
  SVC_BUILT route of the same name) in web.svc-doors.test.js.

## Out of scope (documented on #529)
- The email (Gmail) door flow itself, which is the separate open item on #529 and waits on
  Josh (Vivienne's lane).
- The category-shelf words (`CON_SHELF_WORDS`) "placeholder for Mona Lisa" flag, which belongs
  to #805, not this branch.

## Verification
- web.svc-doors.test.js pins all 18 (control-proven it fails on origin/main where they were
  absent). Full validation suite green. Copy-only web/ change carries a Browser-check trailer.
- Each one-liner was cross-checked against its tokendoors.js hint over the challenge loop
  (scope, capability, unit). Proof: .claude/plans/svc-door-copy-529-pre-challenge.md.
