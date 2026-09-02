# projtitle-1703 -- show an agent's title beside their name in the project dialog

Card: kosmos#1703. Josh, 2026-08-31, #admin: in the project conversation dialog,
on each message show **agent name, then their title in very small text, then the
timestamp**, so a person with ~19 agents can tell the manager from the worker at
a glance. The role data already exists on the agent record; this is a render
change, not a new field.

## Approach

1. `web/index.html` -- render the title between the name and the timestamp in
   `pjRoomRow`. Reuse the roster's exact vocabulary: `roleLine({ role: card.role
   }, ROLE_TITLES)` inside `<small class="msg-role">`, `esc()`'d. This is the
   same shape the member roster uses (`pj-member-role`), so the two surfaces name
   a role identically and there is no parallel vocabulary to drift.
2. New CSS `.msg-role`: `.75rem` (the row's metadata size, matching `.msg-t`),
   `color: var(--label-3)` (theme-aware, the same token the roster uses, so no
   separate dark rule), `font-weight: 400` so it reads as metadata beside the
   bold name.
3. Guard on `card && card.role`: the operator's own "You" post has `card ===
   false` and renders no title; an agent whose server-resolved role is null
   renders no empty span.

## Why the guard is meaningful (not always-false)

The server populates `role` on each per-message agent record at
`engine/projects.js:862`: `role: (card && card.isNamedOurs) ? (profileRole(card)
|| card.role || null) : null`. So `card.role` is genuinely delivered to the
frontend; the render guard reads a real value. The role string passes through
`esc()` before innerHTML, so a parsed-from-instructions role cannot inject
markup.

## Verification

`docs/browser-checks/render-projects.js` -- the `3b-room` shot asserts the agent
post shows its title AND its position (title's `previousElementSibling` is the
`<b>` name, `nextElementSibling` carries `.msg-t`), so Josh's actual ask (order:
name, title, timestamp) is measured, not just presence. Absence control: the
operator's own "You" post renders no title. Control measured: disabling the
render makes the assertion red (agentRole null, exit 1), so it is not vacuous.
This top-level browser-check update also satisfies the #1720 web/-gate for the
index.html render change.

Verified headless in a bot session against a sandboxed board (pw-runtime, no
MCP), the way `tools/browser-checks.sh` runs each check.

## Decisions / deferred

- Seed uses a **profile** role (`{ role: 'Project manager' }`), which exercises
  the `profileRole(card)` arm. The more common board case is the **parsed**
  `a.role` fallback, but the render path (this diff) is identical downstream of
  `card.role`; the profile-vs-parsed distinction lives entirely in existing
  server code (`projects.js:862`), outside this change. Adequate for the diff.
- `.msg-role` is `.75rem`, the same as the timestamp. Defensible: it is the
  row's metadata scale and reads very small beside the `.9375rem` bold name. A
  smaller size is a live-render tweak Josh can request.
