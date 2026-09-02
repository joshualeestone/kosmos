# kosmos#1843 -- Settings > Automation: rename Heartbeat to Prompter, make the section reachable

## Card

Josh, #admin 2026-09-02 07:12/07:13 CDT. An umbrella card for the Automation
section (Josh: "put further Automation-section work here"). It carries three
asks plus a modal:

1. Rename the visible "Heartbeat" to "Prompter".
2. Add the daily note (Notetaker) to the section, preselected.
3. Everything on by default (Prompter, Recommender, Notetaker, Auto-save) --
   Josh's 07:18 ruling reversing #1722's off-by-default principle on purpose.
4. A restart modal for toggling a setting that cannot take effect on running
   agents (Josh's 07:25 ruling: exact copy given).

## This slice (small cut, per release cadence)

Josh's item 1 only -- the surface rename -- plus a real bug found while verifying
it. Chosen because the rename is complete, self-contained, zero behaviour
change, and fully reversible; the other three asks are each larger and are
decomposed below.

### What changed

- **Rename, surface only.** `web/index.html`: the visible `<h3>` label, the save
  button's `aria-label`, and the two save-status strings now read "Prompter".
  Decided once: the internal ids (`hb-*`), the HTTP route
  (`/api/heartbeat-setting`), the paint function (`paintHeartbeat`) and the
  engine modules keep the heartbeat name -- they are wired and unit-tested, and
  renaming them is risk with no user benefit. A code comment states this.
- **Bug fix (pre-existing, found in flight).** The Automation section was
  unreachable: `SETTINGS_SECTIONS` (the JS whitelist `settingsGo` gates on)
  omitted `'automation'` while the nav pill and `#s-sec-automation` both shipped
  (from #1722/#1724). `settingsGo` falls any unlisted section back to `'you'`,
  so clicking Automation silently opened Your Profile and neither control could
  be reached. Added `'automation'` to the whitelist in nav order. Confirmed
  pre-existing on origin/main (not introduced by this diff).
- **New browser check** `docs/browser-checks/render-prompter-label-1843.js`:
  opens the section via its pill, asserts the two headings read Auto-save then
  Prompter, the save button's accessible name follows, and no visible text still
  reads Heartbeat -- both themes. Wired into `tools/browser-checks.sh` and listed
  in the README (the suite enforces both). This check is what caught the
  reachability bug (it read the section at height 0).
- **Test update** `web.file-pickers.test.js`: the aria-label assertion followed
  the rename (the node --test suite flagged it -- good).

### Verification

- Full `node --test` suite (`bash tools/run-tests.sh`): green, exit 0, zero
  failures.
- `render-prompter-label-1843.js` headless: 10/10 pass (5 per theme).
- Em-dash scan of the diff (literal + all four escape spellings): zero hits.
- Blast-radius sweep for the old visible strings across all test files: only
  `web.file-pickers.test.js` asserted one, now updated.

## Deferred to follow-up (documented on #1843), with recommendations

- **Everything-on-by-default (item 3).** A real behaviour reversal: the engine
  defaults in `engine/heartbeat-setting.js` (and the auto-handoff equivalent)
  return `on:false` on a fresh install; flipping to on-by-default changes what
  every install does, plus the "Off by default" copy and the initial `checked`
  state, plus the tests that assert off. Recommend a dedicated PR per engine so
  the behaviour change is reviewed on its own, not buried under a rename.
- **The Notetaker (item 2).** Measured: the daily note is not a product feature
  (0 hits in `web/index.html` and `engine/`); it is our fleet's launchd job.
  Shipping an on-by-default Notetaker toggle requires building the feature, not
  adding a checkbox. Its own card.
- **The restart modal (item 4).** Josh gave exact copy ("This requires a
  fleet-wide restart to enact this." + [Restart all agents now] + a defer path,
  restart via `restart-bot.sh`, no em dashes, never "it" for an agent). A
  self-contained UI build; its own PR.
- **Recommender wiring.** Referenced in item 3's "all on" list (#1723). Confirm
  it exists as a section control before flipping its default.
- **Test-coverage gap (noted, not fixed here):** `render-settings-nav.js`'s
  `SECTIONS` list omits both `automation` and `usage`, so its "click k → k
  visible, others zero" sweep never exercises them. Pre-existing; a follow-up
  could add them now that automation is reachable.
