# #1652: contextual first-run affordance to find agents in Documents/Downloads/Desktop

## The gap (Josh, 2026-09-04 reopen)
A fresh install did not find 7 agent files Josh placed in Documents/Downloads.
Root cause (traced on main, posted on #1652): the AUTO first-run scan
(`/api/scan-agents` -> `discover.scan()` bare) is deliberately TCC-free (#2125),
so it never looks in Documents/Downloads/Desktop. The path that DOES scan them
is the create->import panel (`populateFoundImports` -> `/api/scan-import` ->
`scan({importScan:true})`), which a fresh user has no reason to open. So the
person lands on "Create your first agent" with their files invisible. Same cause
as #1938 ("went straight to Create").

## Decision (Splinter, reversible; NOT reversing #2125)
Add a CONTEXTUAL first-run one-click that fires the EXISTING importScan, keeping
the auto scan TCC-free. The irreversible option (auto-scan TCC folders outright,
bombarding every install with permission prompts) stays Josh's call; Splinter is
surfacing it to him separately as a possible override.

## What changed (web/index.html only)
- `openCreate(initialMode)` and `loadRoles(initialMode)` gained an optional
  starting mode, defaulting to 'pm' (every existing caller unchanged). Only a
  known mode string is honoured, so a stray click Event (or the no-arg
  `frFinish(openCreate)`) falls through to 'pm'. The two BARE click bindings of
  `openCreate` (#new-agent, #made-retry) are now wrapped `() => openCreate()` to
  satisfy the #752 click-bindings guard (a handler must not take a non-event
  first arg).
- The first-run CREATE ending copy gains one concise sentence with an inline
  quiet link "Look in my Documents and Downloads" (class `.fr-lookimport`),
  naming the folders and the macOS permission. NOT a second fork button: Josh's
  ruling (server.test.js "I want it to say 'Giddy Up'") keeps the create ending
  at ONE button, so `frForkActions` is unchanged and the affordance is inline in
  the copy instead.
- A delegated click handler on the stable `#fr-fleet` runs
  `frFinish(() => openCreate('import'))`, which opens the create form on the
  import mode -> `populateFoundImports()` fires `/api/scan-import` (the on-demand
  TCC scan). CSS: `.fr-lookimport` styled as an underlined inline link.

## Verification
- New browser-check `render-firstrun-import-1652.js` (self-boots a sandboxed
  server): forces the create empty state, asserts the inline link + folder/
  permission copy render alongside the single "Giddy Up", clicks it and confirms
  the import panel opens with the mode selected, the scan container present, and
  `/api/scan-import` fired. CONTROLS: the adopt ending (a real fleet) shows no
  link; bare `openCreate()` lands on 'pm', not import. 11/11.
- Full root suite 2173 green; all four browser-check wiring guards reconciled;
  the `pickMode('pm')` default-mode source guard updated to the new mechanism
  (`mode = initialMode || 'pm'` + `pickMode(mode)`), still catching a non-'pm'
  default or a loadRoles that stops arming a mode.

## Weakest premise
The browser-check is a hermetic render-verify: it proves the affordance opens the
import panel and fires the scan route. It does NOT exercise the real macOS TCC
permission prompt or a real agent file in Documents landing on the board -- that
end-to-end fresh-install verify rides Josh's #2243 test (needs-operator). What
would change my mind: a fresh install where the link opens the panel but
`/api/scan-import` returns nothing for a file genuinely in Documents (a TCC or
roots defect below the affordance).
