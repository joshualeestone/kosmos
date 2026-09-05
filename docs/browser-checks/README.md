# Browser checks

`node --test` cannot see the page. These scripts can.

They are **not part of the test suite** and are not run by `npm test`. They need
a browser, and this repo has no dependencies and is not about to grow one for a
check that runs a few times a release. They live here so the next person can run
exactly what was run, rather than re-deriving it.

## Who can run these, and what a bot session actually cannot do

**A committed headless check runs in ANY session on this machine, including a
launchd Discord-bot session.** It needs no MCP and no `claude-fe`: it is a plain
node script that requires playwright from a runtime installed OUTSIDE the repo.

```
NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
  node docs/browser-checks/<check>.js    # + a local board on the port it expects
```

This is not a claim to take on faith. It is how `tools/browser-checks.sh` invokes
each check it gates (a selected load-bearing subset -- see the driver), and the
fleet's agents run individual checks the same way from their own bot sessions --
the first-run checks here were verified
exactly this way under #1801. `~/work/pw-runtime/node_modules` holds playwright,
and the chromium build lives in the shared `~/Library/Caches/ms-playwright/`
cache (`tools/provision-pw.sh` installs a pinned one). The command above is the
shape, not the whole line: most checks also take the board's URL as an argument
and some need sandbox env vars, so copy the exact invocation for the check you
are running from its own header or the recipes further down.

**The one thing a bot session cannot do is the INTERACTIVE Playwright MCP** --
the `/browser-test`-style `navigate` / `click` an agent drives live. MCP servers
bind at session start, a launchd bot session carries only the discord MCP, and it
cannot relaunch itself with `claude-fe` (only the launchd bot-launch script
carries `--dangerously-skip-permissions`; a hand-rolled relaunch drops it and
wedges on the first permission prompt). That, and only that, is the real
limitation -- the narrow gap #1769 was filed about. Its original headline, "no
agent can run a browser check", was over-broad and is corrected here: the miss
was reading a missing MCP as a missing browser.

⇒ **"I can check the endpoint but not the button" is only true if the button
check needs the interactive MCP.** A committed headless render check OF the button
-- is it reachable by `elementFromPoint`, does a click through the real handler do
the right thing against mocked routes (see `render-found-undo.js`), does the
computed state match -- runs fine from a bot session. (Fine paint, geometry and
compositor behaviour are the weaker half headless, through SwiftShader rather than
the real GPU compositor -- see the HEADED note below; event wiring, reachability
and computed state are not.) Write the check; do not ship a frontend change
unverified for want of a tool you already have.

⚠️ **The browser is contended.** Each check launches a real chromium, and a
concurrent run during a release cut's page layer can starve it and false-red the
cut. The measured detail and the rule are in `tools/browser-checks.sh`'s header
(do not run a browser check while a release cut is up), kept there so the two
cannot drift; the serving cut owns the browser until it says SERVED.

## Before you change rendered markup: sweep HERE, not the driver

The assertions live in THIS directory, one file per surface -- **not** in
`tools/browser-checks.sh`, which only names and runs them. Sweeping the driver for
an existing assertion returns hits and looks thorough while missing every assertion
that matters, and that gap killed a cut: a two-press-confirm change (#1702) was
swept against the driver, but the assertion it broke (`render-accounts-openai.js`,
which pressed Remove once and matched its label) was here, so the page gate red'd
from the moment it landed. (#1720 is this fix, not the incident.) Before you move an id, class or text, `grep` this
directory for it and read what each hit ASSERTS -- or run the browser gate, which
is the only check that sees the page.

## The composition check

`regress-a-night.js` is the odd one here and worth knowing about. Every other
script pins ONE surface. That one pins that a night's worth of releases still
COMPOSE: three board layouts, four Settings switches, the accounts list, Delete
history and a task page with parts, in both themes, on one build.

🔑 **Each of those was verified when it shipped and then had hours of other work
land on top of it, which is the moment nobody looks again.** Two of the defects
it now asserts against were found exactly that way: a third board layout that
left the grid switched on underneath it, and a separator rule that selected zero
elements once a row was appended after the list.

Run `node docs/browser-checks/regress-a-night.js --seed` for the four lines that
build the board it expects.

## Why they exist

Everything in this directory is here because of defects that `node --test`
passed over, and could not have caught. (The suite's size is deliberately not
quoted here: it was "389 tests" in this sentence while the bullets below said
316 and 931 and the suite itself was past 975, which is one moving fact written
down in four places.) Each bullet keeps the count it was MEASURED at, because
there the number is part of the finding:

- A modal that rendered **fully transparent**. 316 tests and two blind reviews
  went past it, because nothing had ever put the page on a screen.
- A CSS rule written `.fr-next` instead of `p.fr-next`, which lost to
  `.fr-body p` on specificity and **did nothing at all**. Every text assertion
  matched the file happily.
- The contrast failure hiding underneath that one: 3.04:1 on a 10px caption,
  invisible for as long as the rule was inert. This project's floor is WCAG AA.

- A variable read one line before it was declared, in the agent page's own
  thread paint. It threw a `ReferenceError` on **every** paint, so the box never
  rendered at all — and **the entire suite passed**, because the suite reads text
  and nothing in it had ever put that page on a screen.

The rule they encode: **a test that reads source is testing source.** For
anything about how a screen looks or behaves under a click, render it.

⚠️ **And rendering is not enough on its own.** `render-talk.js` screenshotted
the first-run overlay with the real page correct underneath it, every
measurement green; then, with the overlay hidden, it measured a page the overlay
had left `inert` — every hit test answering BODY and a click timing out, on a
page that screenshots perfectly. **A picture cannot show you that nothing on it
can be clicked.** Ask what happens when you touch the thing, not only what it
looks like.

## What is in here

⚠️ **GENERATED BY HAND AND GUARDED BY A TEST.** Ten of the twenty-one scripts
were missing from this file when the index was added, including three written
the same day, so half the directory was invisible to anybody reading the README
to find out what exists. `browser-checks-indexed.test.js` fails when a script is
not listed, which is the only reason this table can be trusted a month from now.

📌 **The descriptions are each script's OWN opening sentence**, not a summary
written here. A summary is a second place to be right about one thing. Seven
scripts have no opening sentence, and they are marked as such rather than given
one invented by somebody who did not write them.

| script | what it pins |
|---|---|
| `click-first-run.js` | Click the whole thing, like a person. Nothing here reads source |
| `contrast.js` | Every visible piece of text clears the AA contrast floor, in both themes |
| `live-connect.js` | **no header sentence.** Read it before running it, and give it one. |
| `named-controls.js` | Every control a person can reach has a name a screen reader can say |
| `regress-a-night.js` | Everything the night of 2026-08-21 added, drawn together on one build |
| `render-agent-nav.js` | The agent page's left nav, on a screen (agent-page-nav, 2026-08-23). |
| `render-detail-header-1841.js` | The view-agent-detail header redesign (#1841): the working-rules prompt moved onto the Instructions tab for both doctrine cases (red tab dot, "Add Instructions & Restart"), the hand-edited stale case redesigned as the header restart card ("[name] needs to be restarted" + [Restart], never "it"), the duplicate lower status suppressed when reported, and the role bolded in the meta line. Drives the real painters and asserts the real DOM. |
| `render-detail-ring-1915.js` | The memory ring on the agent detail avatar (#1915): sets a known reading on the open agent and re-drives the real `openDetail` wire, then reads the rendered `#d-ring` -- the ring reaches the page, its arc length tracks the reading (30/70/88% -> ok/warn/high band), the element is actually laid out, and an unknown reading draws no ring. The rendered confirm the source test cannot give, since it catches a dropped `openDetail` wire line while `detailRing()` itself stays correct (a `.dring` CSS-size regression is not caught -- see the check's docblock). |
| `render-agentpage-fullwidth-2012.js` | The full-width agent page (#2012): the content column fills the width past the old 544px cap, the header spans full width (max-width none), `#d-window` fills the page height past the old 560px cap, and the message body keeps a ~66ch measure. Each arm is written as a comparison against the old cap so it reds on the pre-#2012 page. |
| `render-subprojects-1994.js` | Sub-projects UI (#1994): drives the shipped `paintProjects`/`projectCard`/`paintProjectSettings` against a fixture project tree: a parent's children nest (indent depth in the wide tab list) with a "under <parent>" chip and a sub-project count, a child of an archived or dangling parent still renders at the top level (nothing vanishes), a stored cycle renders every row without hanging, and the set-parent `<select>` excludes self + descendants + archived (offering only a parent the engine would accept) while preselecting the current parent. Both themes. |
| `render-worlds-switcher-1704.js` | The multiple-Kosmos switcher (#1704 slice-3, list + create): drives `GET /api/worlds` (the switcher beside the K mark shows the active world's name, the menu lists the worlds with exactly one marked active) and `POST /api/worlds` (the create modal disables Create on an empty name and enables it on a name, and creating a Kosmos closes the modal and the new world appears in the list on refetch) against its own throwaway sandbox registry, plus the switcher is hidden in the consolidated view. Switching between worlds is slice 2b and not covered here. |
| `render-richtext-2067.js` | Restricted-markdown rendering in agent dialogue (#2067): calls the shipped `pjRich` in the page across markdown/degrade/XSS inputs (bold, italic, strike, inline + fenced code, one heading, lists, quote, hr, emoji, bare-URL autolink; a `<script>`/`onerror` payload stays inert; plain text is byte-identical to the page's own `esc`), then paints the real talk thread with a markdown agent message and asserts the DOM and computed CSS (heading weight, code background) in both themes. |
| `render-a11y-copy-1940.js` | The first-run Accessibility step copy + button style (#1940 + #2125 slice 3): the copy names the exact action ("Turn on 'Tmux' in Accessibility"), the Open-Accessibility button carries the gold `fr-sleepbtn` class (asserted via computed style, not just the class name), the "This one is optional" line is gone, and (slice 3) the offer-not-require "anytime in Settings" skip-out is gone -- replaced by what-to-toggle guidance naming the Accessibility list AND the Automation grant. Each arm reds on the pre-fix markup. |
| `render-a11y-gate-2125.js` | The first-run Accessibility Continue-GATE (#2125 slice 3, Josh 2026-09-04): drives the live `/api/a11y-status` route through three readings and asserts the gate is FAIL-SAFE and POSITIVE-ONLY -- `checkable:true + trusted:false` DISABLES Continue (the gate), while `trusted:true`, no-reading (a browser), and a stale reading all leave Continue ENABLED (the controls that prove it never strands a browser tester or an unreadable machine). The DISABLED arm reds if the gate is removed; the ENABLED arms red if the gate over-blocks. |
| `render-engmode-gate-2131.js` | The project terminal is gated on Engineering (Advanced) mode (#2131 regression guard). With eng-mode OFF the raw terminal `.pj-viewport` and the one-to-one box `#pj-thread` are HIDDEN on the project page; the CONTROL turns eng-mode ON and asserts those SAME two elements become VISIBLE (so the OFF arm is not vacuous, not a terminal that never renders); and the SAFETY arm pins the exemption the fix must never break - an ASKING agent keeps its question panel `#d-qask` VISIBLE even in Off (it is how the answer is typed). The gate is page-wide (`ENG_ON`), so these arms cover the mechanism the conversation view shares; a detail `#d-window` arm is omitted because it needs a live captured screen this fleet harness cannot provide (a hidden-in-Off assertion on it would be vacuous). The reported v0.6.28 leak does not reproduce on current main; this locks the invariant so it cannot silently return. |
| `render-preflight-2163.js` | The pre-flight expectations interstitial (#2163, Josh 2026-09-04): clicks through the real flow (Success -> Set up Kosmos -> the interstitial -> Welcome) and asserts the interstitial shows BEFORE the setup steps, sets expectations for the macOS permission prompts, stands OUTSIDE the numbered step count, and its Continue enters the numbered flow at Welcome. The CORE arms red on the pre-#2163 flow (the interstitial never shows, so its wait times out and the check exits 1); the "interstitial hidden on Success" precondition arm passes vacuously pre-#2163 (isHidden is true for an absent element), so it is a precondition, not a discriminator. |
| `render-firstrun-namestep-1994wiz.js` | The first-run name/identity step (#1994, Josh's live fixes): the time zone `<select id=fr-you-tz>` is restored, populated and defaulted (three labelled fields now, reversing #1345's "exactly two"); the name input is width-capped while "What do you do?" keeps full width (computed max-width, so a stale rule reds); the "Continue saves this into every agent..." copy is gone; and pressing Continue POSTs the timezone to `/api/settings` (the real request is caught, proving the save wiring). 10 of 12 arms red on the pre-#1994 page. |
| `render-observed-consumers-1959.js` | #1959: the observed-liveness badge (#1921) is read by the OTHER /api/accounts-fed consumers, not raw `connection.state === 'connected'`. HERMETIC (loads web/index.html over file://). Four arms: the shared helper matrix (`acctUsableLogin`/`acctUnknownLive`/`acctOfferableTarget` across every badge value + the badge-less legacy-state fallback); the `paintConnLive` board summary via a fetch stub (counts usable logins, EXCLUDES `rejected` -- the #874 defect on this surface -- and stays honest on `unchecked`); the `paintAccountPicker` move eligibility via a seeded `ACCOUNTS` global (a `rejected` current account is now signed out and the move UI offers the working sibling as target; a working current account is the control; and an `unchecked` current account -- a live check we could not read -- is NOT called signed out but reads could-not-check, the #1959 NIT / #2023 rule); and the `fillCreateAccounts` create-agent picker via a seeded `CREATE_ACCOUNTS` global (a `rejected` account is EXCLUDED as a run target, an unchecked account stays offered+labelled). Verified 26/26 (chromium+webkit); proven RED on the pre-fix page by observed behavior (the summary counts "3 accounts connected" with rejected included, a rejected current account gets no move prompt, an unchecked current account is falsely called "signed out", and the create picker offers the rejected account). |
| `render-firstrun-connect-box-2187.js` | #2187: the Claude connect output on first-run step 3 sits in a light-gold box. HERMETIC (loads web/index.html over file://, boots no server): drives the page's own frPaintSubscription() (connected) and frPaintConnect() (installing) into `#fr-sub` and reads computed style: the "... is connected" checkrow AND the "Setting Claude up..." setup notification each land in a box with the gold-wash background + gold border (the same values `.fr-confirm` uses). The empty control is the discriminator -- an empty `#fr-sub` computes display:none (no bare gold rectangle before anyone connects), so dropping the `:empty` guard reds it. The connected checkrow's real size is asserted first, so no style arm is vacuous. |
| `render-firstrun-enter-2186.js` | #2186: Enter/Return activates Continue on a wizard step when the step is valid. Drives a real keydown on the focused About-you name field and proves both arms off that one gated step: empty fields (Continue disabled) => Enter does not advance; filled fields (Continue enabled) => Enter fires the real `PUT /api/you` and advances the wizard, exactly as clicking Continue would. The empty-vs-filled contrast is the discriminator; reds against a page with no `frEnterSubmit` handler (the valid-step arm never advances). |
| `render-made-before.js` | The never-recorded state, on a screen (#149/#150, 2026-08-23). |
| `render-busy-line.js` | The "<name> is working…" line, rendered |
| `render-reauth-reach-1918.js` | kosmos#1918: the agent page's "Sign in again" button (auth_failed) actually REACHES the re-auth surface. Clicks it and asserts the settings PANEL becomes visible and the detail panel hides, the browser-only check a jsdom test (which stubs showTab) cannot make. Red against the iteration-1 dead control that called settingsGo without showTab. |
| `render-picker-provider-2097.js` | kosmos#2097/#2098: the create-agent picker is provider-aware. Drives the real `applyCreateProviderUI` and reads `#create-model-row`: on OpenAI the model row is HIDDEN whole (no stale "Claude Sonnet 5" under an OpenAI key) with the model note in its place (the #2140 auto-fallback note when no account is listable); on Anthropic it is shown. Reds on origin/main (no `#create-model-row`, where the model select was only disabled, still displaying its value). |
| `render-create-openai-model-2140.js` | kosmos#2140: the create-agent OpenAI model picker. Drives the real `paintOpenaiCreateModel` with a stubbed `/api/accounts/openai/models`: a LISTABLE account shows the picker with "Let OpenAI choose (recommended)" first + the account's models, and selecting one surfaces its why via `paintModelWhy`; a NOT-LISTABLE account (ChatGPT-mode key) shows the box with the single "OpenAI picks its own model for now" option (no Claude model) and a note keyed to the reason. Reds on the pre-#2140 index (no `paintOpenaiCreateModel`) and the pre-refinement index (box hidden). |
| `render-detail-openai-model-2140.js` | kosmos#2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail page. Drives the real `paintOpenaiDetailModel` with a stubbed `/api/accounts/openai/models` and a set `CURRENT`: a LISTABLE account shows the account's models with "Let OpenAI choose" first and the agent's CURRENT model (`a.plannedModelName`, the raw id for OpenAI) pre-selected, NEVER a Claude model; a NOT-LISTABLE account shows the single "OpenAI picks its own model for now" option with the reason on the msg. Reds on origin/main, where `paintOpenaiDetailModel` does not exist (the detail picker matched Claude models by label under an OpenAI agent). |
| `render-openai-only-2096.js` | kosmos#2096: the "cannot reach a Claude subscription" banner is provider-aware. Drives the real `renderConnection` into `#conn` (file-load): OpenAI-only (`dependsOnClaude=false`) shows NO banner; a Claude-dependent machine STILL warns when Claude is unreachable; a MISSING field falls back to warning (never hide a real Claude failure); connected hides. Reds on origin/main, where `renderConnection` takes only `(conn, agents)` so the OpenAI-only case still shows the banner. |
| `render-firstrun-model-continue-2134.js` | kosmos#2134: the first-run wizard MODEL step offers Continue when OpenAI is the connected model provider, not only when Claude is. Drives the real `frPaintOpenai` with a connected OpenAI account and Claude not connected, and reads `#fr-next` / `#fr-alt`: Continue is shown and "Skip connecting a model" is hidden. Reds on origin/main, where `frPaintOpenai` never touches the action buttons so the OpenAI-only model step shows only Skip. |
| `render-build-marker-2066.js` | kosmos#2066: the board's build marker renders the version in persistent chrome and carries the channel by WEIGHT. Drives the real `paintBuildMark` against a file-load (no board): prod paints a small dim version string with no fill; staging paints a loud badge whose background + ink are asserted via COMPUTED STYLE (non-transparent AND differing from prod, so a phantom class or a missing `--stag` token reds it); an undefined channel falls to prod; no version hides. Reds on origin/main (no `paintBuildMark`, no `#buildmark`). |
| `render-account-badge-1921.js` | kosmos#1921: the Settings account badge renders VERIFIED liveness from `connection.badge`. Drives the real paintAccounts against a stubbed /api/accounts (no board) and asserts the rendered `#set-accounts .acct-box` badge class + text per state. Load-bearing arm: a merely-existing credential (`signed_in_unverified`) renders the MUTED class, never the green `.acct-connected`, in a real DOM, the #874 false-green a source-only unit test cannot rule out. |
| `render-account-name-2095.js` | kosmos#2095: the human-chosen account name is the PRIMARY label in the Settings AI-models row; the key last-4 is a secondary detail. Drives the real paintAccounts against a stubbed /api/accounts (no board) and asserts a NAMED OpenAI row shows its name (never the key) as `.acct-who b` with the key on a secondary `.acct-keytail`; an unnamed OpenAI row and a Claude row are unchanged; and an arbitrary name is HTML-escaped (no injected element child). Reds on origin/main (the row shows the key, not the name). |
| `render-room-scroll.js` | The project room keeps a reader on the floor when the composer resizes it (#1037) |
| `render-alltasks.js` | Every task across every project, and the heading's number equals the rows on the screen (#1382). |
| `render-composer-reset.js` | The composer goes back to one line after a send, measured as a rendered height (#1303 C). |
| `render-head-row.js` | Settings stays on the project header row, beside the title and the search (#1043) |
| `render-fields.js` | The field and control invariants, measured in a real browser, in BOTH schemes |
| `render-first-run.js` | Render every first-run state in a real browser and look at it |
| `render-boot-no-flash.js` | The launch covers itself until the first-run gate resolves, so the agents view never flashes and then vanishes (#1553) |
| `render-conn-url.js` | The sign-in fallback button does not overlap the line above it (#1209) |
| `render-openai-step.js` | The OpenAI install step at parity with Claude's, with an honest indicator (#1205) |
| `render-openai-key-step.js` | The OpenAI key step in its approved box, sizes matched, link not colliding (#1207) |
| `render-openai-key-callout-2164.js` | The add-a-provider OpenAI key step is formatted like the Claude connect callout (#2164), not flat grey. |
| `render-found-board.js` | The board's panel for agents on this Mac that Kosmos is not looking after |
| `render-board-signin-403-2023.js` | A protected-read 403 (no board token, #1946) renders as not-signed-in with the `kosmos open` remedy, not as "cannot read" -- with a 200 control (normal board) and a 500 control (genuine failure still says cannot-read) (#2023) |
| `render-update-abort-2055.js` | A silently-aborting update (the `updateAbort` marker off /api/status) shows a board notice naming N, painted only on a successful read; with a clean control (healthy board shows nothing) plus null and garbage-count controls (#2055) |
| `render-scan-board.js` | The board's disk-scan panel (#1938): agents on this computer Kosmos has no record of Claude ever running in, found by walking the disk for CLAUDE.md files |
| `render-restarting-2019.js` | The disruption in-progress state (#2019, presentation half): an agent WE restarted (cause = restart / model / provider / instructions / account) renders as the animated Kosmos K with cause-named copy and a solid border, presence stays on (never "gone"), and reduced motion holds the K static and fully visible. Calls the page's own render functions with fixture agents shaped to the engine contract; both themes. |
| `render-restart-timedout-2019.js` | A timed-out restart stops the animated K and tells the truth, without dropping to "gone" (#2019): on disruption.timedOut the K animation is none (held still), the label keeps the cause and adds "not back yet", the sub-line drops the "a few seconds" promise, and the card stays in the restarting family. Drives card() with engine-contract-shaped agents; the in-progress card is the control. |
| `render-found-undo.js` | Add and Undo on the found-agents row, pressed for real in a browser |
| `render-adopt-1531.js` | The adopt prompt (#1531): a folder with no instruction file is offered as a question with an empty editable name field, an empty name is refused before the network, a typed name registers, and decline is one blameless click with Undo |
| `render-connect-skip.js` | The predicate that gates the 281MB confirm says skip when Claude already runs and ask when the launcher does not. Reads `frClaudeInstallNeeded()`, does not click. Needs TWO boards booted WITHOUT dry-run (#1573) |
| `render-full-width.js` | The board, settings and create form at 1760px: one row lining up with another (#286, #287) |
| `render-grid-card-width.js` | The projects grid card matches the agents board width, and a long title truncates rather than widening it (#1310) |
| `render-list-row.js` | The not-running row in the list layout, measured cell by cell against a running one (#278) |
| `render-found-count.js` | The found-agents screen: one label per row, a green Added, and a count that cannot disagree with its own rows (#1346). |
| `render-long-title.js` | A long project title truncates instead of squeezing the search box (#1303 F). |
| `render-project-rows.js` | A project row is two lines, with its status on the agents line (#1303 E). |
| `render-member-modal.js` | Adding a project member opens a real dialog, and there are three ways out (#1303 H item 3). |
| `render-agent-lines.js` | The three lines of a rail agent, measured as TEXT rather than as boxes (#1303 A item 3). |
| `render-made-endings.js` | The two endings of Create an agent that are not success |
| `render-memory-words.js` | Measure the two unknown-memory captions on all three surfaces that draw them, |
| `render-create-form.js` | Step two of Create an agent: no rules, half widths, Josh's order, the stepped model group |
| `render-create-made.js` | The last step: the mark, the paced rows, and the greeting you are handed at the end |
| `import-agent-flow.js` | The fourth create option (#1652): a valid agent file fills the instructions textarea and advances; a non-agent file is refused whole. Needs a sandboxed board; completes first run itself |
| `render-survival.js` | The panel naming the agents that will not come back after a restart (#277) |
| `render-not-running.js` | The card and the tile for an agent Kosmos knows about that is not running (#278) |
| `render-offline-note.js` | What the page says when the server it was loaded from is killed under it (#269) |
| `render-org-chart.js` | The org chart: opaque faces, no hub stroke, a pressable callout, centred on its own drawing (#284) |
| `render-org-reduced-motion.js` | The org chart settles under prefers-reduced-motion: on a dense board (manager + eight reports) no two discs overlap after the synchronous settle (#1870, the rendered-DOM arm for #1738) |
| `render-role-limit.js` | Where a role's limit on what it reaches is read, now that it is off the create card |
| `render-role-order.js` | The three role options in Josh's order, natively grouped, with the menu between two of them |
| `render-pjsettings.js` | **no header sentence.** Read it before running it, and give it one. |
| `render-settings-nav.js` | The Settings page's left nav, on a screen (settings-nav, 2026-08-23). |
| `render-plus-gate-1615.js` | The Kosmos Plus tab gates the on-switch on ENROLMENT, not `configured` (#1615). Stubs /api/remote per scenario and asserts, in both themes: an unenrolled machine (everyone today) shows the state 1 holding place with NO "Turn on" switch; an enrolled one keeps the connected flow with the switch so it can still turn Plus off. Also pins the "Kosmos Plus" retitle of the heading and nav pill. Guards the bug where `configured = Boolean(RELAY())` is always true, so gating on it showed the relay switch to every user with no paid gate. |
| `render-prompter-label-1843.js` | The Automation section reads "Prompter" (#1843): the pill opens the section (it was unreachable before this card, absent from SETTINGS_SECTIONS), the two headings read Auto-save then Prompter, the save button's accessible name follows, and no visible text still reads Heartbeat. Both themes. |
| `render-projects.js` | Render every state of the Projects screens in a real browser, light and dark |
| `render-consolidated-layouts.js` | The consolidated view under each Agents layout: no org chart over the rails, and an empty centre that says what to press (#774). |
| `render-rename-say.js` | What the agent page says after you rename an agent |
| `render-reload-toast.js` | The reload toast in both tones, beside the shipped offer toast it must not look like (#270) |
| `render-updates-stale.js` | Settings > Updates, pressed on a page that is older than the Kosmos running it (#691). |
| `render-sleep-button.js` | The Open-sleep-settings button on first-run step 4, and that clicking it really opens the pane, verified by process |
| `render-special-purpose.js` | **no header sentence.** Read it before running it, and give it one. |
| `render-talk-search.js` | The search box above the agent thread: filter by text and by who, the no-match sentence, reset on switching agent |
| `render-talk.js` | A REAL agent card, from the real producer |
| `render-tasks.js` | Drive-through of the tasks column: creating and viewing are both PAGES (#206, then #383) with no trap and Escape inert, the typed draft survives Back, the who chip is the status, the door reveals what the column hides. Fixture tmux only. |
| `render-memory-controls.js` | The Memory tab's three controls (#214): Compact, Clear, Restart together, the chooser sentence, Compact's dialog and verdict. |
| `render-model-change.js` | The Model section (#386) and the #1373 OpenAI sign-in picker: the rows offered, the preselect, and the arm that hides it again. #1484 adds the two dialog arms a two-account fixture can never reach: one sign-in (the row is sent, nothing to choose) and none (the switch will stop), each read from the rendered confirm sentence after removing a fixture home and reloading. Seals all three homes and stubs the models endpoint, so no real key is involved; see the check's own header for why. |
| `render-github-door.js` | The GitHub door on the Connections tab (#529), driven in a real browser: absent gh is the |
| `render-accounts-openai.js` | An OpenAI account added from the Accounts page with a pasted key, listed by provider and offered on the create form (#540); driven against a stand-in codex so no real key is involved. |
| `render-org-drag.js` | The org chart's organic layer (#285): grab the hub, the rings follow, wires stay attached, a drag does not open an agent and a click does. |
| `render-switch-states.js` | The four Settings switches come BACK once their settings read (#229) |
| `render-optout-403-2020.js` | The two telemetry opt-out switches are 403-safe: a gated read draws could-not-read, never a false Off (#2020/#2047) |
| `render-settings-403-2047.js` | The auto-update, engineering-mode and run-limits switches are 403-safe: a gated read draws could-not-read (hidden, no position, a message), never a false Off -- with a 200 control (#2047) |
| `render-theme-toggle.js` | The light and dark control: two options, gold active, same geometry as the view toggle (#284) |
| `render-thread.js` | Render and DRIVE the project thread in a real browser |
| `render-url-state.js` | The view survives a refresh (#374): agent, project, task; and the overview writes a clean URL. |
| `render-update-toast.js` | **no header sentence.** Read it before running it, and give it one. |
| `render-viewtoggle-header-2154.js` | The board-view toggle (#2154): one press flips tabs <-> consolidated, it persists through /api/style, it lives in the header on the tabbed view and in the agents rail on the consolidated view, and it is hidden below 960px. After #2194 it sits to the right of the light/dark switcher in the header. |
| `thread-server.js` | A server for looking at the project thread, with NOTHING pointed at the real |

## Two rules for writing one, learned on 2026-08-24

**Assert rendered text, not DOM text.** `textContent` includes visually hidden
children (an accessibility span, a `.vh` label, anything `display:none`). A check
that asserts a sentence IS present by `textContent` cannot fail on a sentence
nobody can see, and that is a false PASS in the page gate, which ships. Read the
sentence with `innerText` (or Playwright's `innerText()` / `toBeVisible`), which
honour CSS display and visibility, and guard the element with a size. Use
`textContent` only where the DOM text is the thing under test: accessible names
(`named-controls.js`), `<option>` labels, data attributes, and where the read
is an absence control (`=== ''`, `!/.../.test`), which hidden text should fail
too. Every read that stays on `textContent` in a wired check carries a comment
saying which of those it is (#687). Do not sweep a `textContent` blind: an exact
match like `=== 'Saved.'` changes under `innerText` when the element wears
`text-transform`, so check the CSS on the element first. The instance, so the
rule is not abstract: `regress-a-night.js` asserted the instructions lede
"states the consequence" from the Memory screen, where that lede is not drawn,
and passed for weeks on a sentence that was never rendered. The size guard
caught it the hour it went in (#687).

**If an assertion is only true until we do better, say so in the check.** A check
pinned to a temporary state ("Windows is still coming soon", "the no-install road
is not switched on yet") turns into a false alarm at the moment of success, and it
fires looking exactly like a regression. Three of those happened in one day
(#650, #612, and the engine-off legs of `render-github-door.js` the hour #680
shipped the client id). Put the sentence "true until <the improvement>" beside the
assertion, so the person who meets the red knows it is the feature arriving.
Better still, **pin the invariant, not the moment**: assert the whole space of
valid states and refuse only the half state between them. #650's fix is the
shape: the Windows control is a Coming-soon button OR a real installer download,
never a button without the corner or an anchor with it, and the check prints
which it saw. That stays green the day the feature lands, still catches a broken
control, and nobody has to read a comment at the moment they are annoyed by a red.

## Where the screenshots go

Every check writes its screenshots to `SHOT_DIR` if set, otherwise to a fresh
temp dir it names at the end. **None writes into this repo.** Four used to
write into `shots/` here (#630); screenshots differ byte for byte from run to
run, so every page run left the shared checkout dirty and `release.sh` refused
the cut on "main is dirty" (it aborted 0.5.21 that way). A browser-check run
must leave `git status` clean. The PNGs still committed under `shots/` are the
historical set from the PRs that introduced them, not a reference a check
compares against; when a screenshot belongs in a PR, copy it out of `SHOT_DIR`
on purpose.

## Adding or removing a check

The row in the table above and the script move in the same commit. The suite's
`browser-checks-indexed.test.js` asserts it, but that test only fires on a full
`yarn test`, and a PR that ran a subset has merged green and left main red
(#606, #607). So the repo ships a pre-commit hook that runs that one guard
whenever a commit touches `docs/browser-checks/`. Wire it once per clone; every
worktree of the clone inherits it:

    git config core.hooksPath .githooks

With it wired, adding a check without its row refuses the commit and names the
file, and deleting a check that still has a row does the same.

The same hook runs `browser-checks-selectors.test.js` whenever `web/index.html`
or a check is staged (#758): every id a check asks for must exist on the page,
and a change that removes one is refused with the check, its line, the id it
wanted and the nearest ids the page has. That is the static half of the gap the
card names; it catches a removed or renamed id in milliseconds, not a dialog
whose words moved. A check that is stale by ruling is listed in that file's
`KNOWN_STALE` with the commit, and the test refuses an entry that is no longer
stale, so the list cannot outlive the rot it names. Two things it made visible
the night it landed: `render-create-made.js` had asked for `#made-done` since
4bf7d95 (restated in #826), and 15 of the 47 checks here were not in the
release gate (they ran only when somebody remembers). The first count said 27
of 46: it counted literal `run_one "name"` lines and could not see the loop
at `tools/browser-checks.sh:334` that runs twelve more by name. A count
matched by pattern cannot see a loop; Angel's two real runs printing those
twelve in "ran:" were the instrument that corrected it (#812).

## Sandboxed whole, or not at all

The board refuses to start half-sandboxed (#634): if any of `AGENT_WORKFORCE_DATA`,
`AGENT_WORKFORCE_PROJECTS`, `AGENT_WORKFORCE_WORKERS`, `AGENT_WORKFORCE_LAUNCH` is
set, all four must be, and tmux must be inert (`AGENT_WORKFORCE_TMUX_BIN` pointed
at `test-support/fake-tmux.sh`, or `AGENT_WORKFORCE_DRY_RUN=1`). The refusal names
what is still live. This exists because a fixture board with two knobs sandboxed
and three live typed a test message into two real agents' panes and rewrote their
`CLAUDE.md` files; the recipe below used to leave tmux real in exactly that way.
`AGENT_WORKFORCE_HALF_SANDBOX_OK=1` overrides, for somebody who has read this.

### `lib-sandbox-guard.js` is a library, not a check

It is the only `.js` in here that does not drive a browser. **Six checks take their
base URL as `argv[2]` and POST to it**, and two of those complete first run. A bare
invocation fails with `fetch failed`, and the obvious next move is to hand it a board
that already exists, which is how a command that reads like a test changes a running
system.

So those six call `requireSandbox()` before their first POST. It refuses unless
`AGENT_WORKFORCE_DATA` is under a temp root, **exits 2 rather than 1** so a runner can
tell "declined to run" from "found a defect", and **refuses rather than throwing**:
an error takes a whole file down, which on the same discriminator once failed 161
tests while running 137 fewer than the fail-safe version.

**The other five checks self-boot a sandboxed server and are deliberately NOT guarded**,
because they create their own data root for the child and never set one in their own
environment. Guarding them would refuse a check that was never dangerous.

The temp-root test mirrors `engine/status.js` and carries its two corrections: `/tmp`
is not `os.tmpdir()` on macOS, and both sides need resolving because `/var` is a symlink
to `/private/var`.

### `lib-firstrun-steps.js` is a library, not a check

The other non-browser `.js` in here. The first-run wizard numbers its steps (`fr-pane-N`,
`?fr-step=N`), and #1214 inserted Accessibility as step 5, moving every later step up one
and silently breaking nine assertions across four checks that had NAMED a step number
(#1801, #1751). Re-pinning the numbers fixes the instance and re-arms the trap for step 8.

This library keys on IDENTITY instead. Every pane is in the DOM from first paint (hidden
until shown), so a check DISCOVERS the step that holds a content anchor rather than naming
its position:

- `stepForAnchor(page, sel)` -- the step number of the pane holding `sel` (`#fr-fleet` -> 7,
  `#fr-you` -> 6). Throws rather than falling back to an index.
- `paneCount(page)` -- the total steps read from the STATIC `fr-pane-N` panes, a different
  source from the dynamically-built crumb and segments, so a check can cross-check the two.
- `gotoStepForAnchor(page, base, sel, ...)` -- navigate to the discovered step via the real
  `?fr-step=` deep link.

Used by `render-found-undo`, `render-found-count`, `render-first-run` and `click-first-run`.
When the next step is inserted, discovery follows the pane; a hard-coded number does not.

## Running them

```sh
# 1. a server, with every root it writes to pointed somewhere disposable
SB=$(mktemp -d)
PORT=4399 \
  AGENT_WORKFORCE_DATA="$SB/data" \
  AGENT_WORKFORCE_WORKERS="$SB/workers" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch" \
  AGENT_WORKFORCE_PROJECTS="$SB/projects" \
  AGENT_WORKFORCE_TMUX_BIN="$PWD/test-support/fake-tmux.sh" \
  node server.js &

# 2. playwright, installed OUTSIDE this repo
PW=$(mktemp -d)
cd "$PW" && npm init -y && npm i playwright && npx playwright install chromium webkit   # webkit is REQUIRED by render-fields.js

# 3. the checks
#    ⚠️ NODE_PATH is not optional. `require` resolves from the SCRIPT's
#    directory, not the working directory, so without it these walk
#    <repo>/docs/browser-checks/node_modules … / and exit MODULE_NOT_FOUND.
NODE_PATH="$PW/node_modules" node <repo>/docs/browser-checks/render-first-run.js /tmp/frshots
NODE_PATH="$PW/node_modules" node <repo>/docs/browser-checks/click-first-run.js \
  "$SB/data/AgentWorkforce/first-run.json"
```

⚠️ **Sandbox the roots — all FOUR of them.** `click-first-run.js` drives the
real completion flag through the real route. Run unsandboxed and it writes to
`~/Library/Application Support/AgentWorkforce/`, which is the flag the live
board reads. And `AGENT_WORKFORCE_PROJECTS` is a root the server WRITES to
(adding a project on the default path makes its folder there): leave it unset
and a test click creates directories in the operator's real ~/Kosmos/Projects.

⚠️ **Headed by default.** Set `HEADED=0` for a machine with no console session.
Headless renders through SwiftShader rather than the real compositor, so a
paint or geometry result from it is weaker evidence than a headed one.

## What each does

**`render-fields.js`** measures the field and control invariants in **both
engines and both schemes**: that every select renders our own control rather than
the browser's, that no field is the same fill as the box it sits in, that a
field's relationship to its container does not FLIP between light and dark, that
the unknown-memory caption does not paint over the presence dot, and that the
list row's unknown cell carries a word rather than a blank (a blank number cell
reads as `0%`, and for memory `0%` means "loads of room" — the inverse of the
truth).
Since #1800 it also holds the two create-flow textareas (`#create-instr`,
`#import-text`) to one dressing (border colour, border width, radius), with a reach
floor first, and requires the import box to stand apart from its own card.

⚠️ **It exists because CSS had no standing guard at all.** `node --test` reads
source, and source is exactly what lies: the `screen-pass` branch found **three
separate rules that lost the cascade and read in the diff as if they had
worked**. A rule that loses the cascade is identical to a rule that is not there,
and only the element knows which one is winning.

⚠️ **WebKit is not optional here.** Kosmos opens the DEFAULT browser, which on a
stock Mac is Safari, and WebKit renders a `menulist` select differently from
Chromium — a declared 20px radius comes back 5px. A Chromium-only run passes that
defect.

⚠️ **Dark is not optional either.** The app carries two token systems that are
equal in light and divergent in dark; every defect of that class this project has
shipped was invisible in light. A light-only check measures agreement between the
two systems, not correctness of either.

📌 **Its contrast function validates itself on six known pairs before printing a
single real number**, and every check prints its denominator — "all 6 selects
share one appearance" and "all 0 selects share one appearance" are the same
sentence.

```sh
NODE_PATH="$PW/node_modules" node <repo>/docs/browser-checks/render-fields.js
```

⚠️ **This one is headless-only and does not read `HEADED`**, unlike the scripts
described further down. Everything it asserts is computed style plus the relative
geometry of two elements inside one card, both of which are layout rather than
paint — so SwiftShader's software rendering does not weaken them. It would matter
for a screenshot or a compositor result, and this script takes neither.

**`render-first-run.js`** opens all fifteen first-run states in light and dark,
screenshots them into the output directory you pass it (copy them to `docs/screenshots/firstrun-*.png` when they are what you want in the PR), and measures the
things a text assertion cannot see: that the overlay is opaque and actually
covering, that a click in the middle of the screen lands on it, that every
visible string clears its WCAG AA ratio, that nothing runs off the side, and
that every visible button is focusable and named.

⚠️ **It contains a control, and the control is load-bearing.** The contrast
checker's first version treated `rgba(0,0,0,0.035)` as opaque black and reported
nine failures on a page that had none. Compositing alpha fixed it — and "it
stopped reporting anything" is also what a checker broken into silence looks
like. So it plants one element that genuinely fails and requires itself to catch
it before any clean result below is worth reading.

**`render-updates-stale.js`** writes its screenshots into the directory you pass (argv[2]); `shots/updates-stale.png` and `shots/updates-current.png` are copies of one run, and a rerun does not touch them. Copy over when they are what you want in the PR.

**`click-first-run.js`** clicks the whole thing like a person: every step, Back,
Skip, Escape, the hand-off into creating an agent, a returning visit, a failing
`/api/first-run`, a failing `/api/machine`, and a completion flag that will not
stick. It asserts against the DOM and the real flag file, never against source.

## live-connect.js

Not a browser check: the REAL engine against the real world, sandboxed. Runs
the actual download (checksum-gated), the actual `claude install` into a
sandboxed HOME with no tty, and the actual sign-in driver against real tmux and
the real CLI to the paste prompt -- then cancels. **It never completes a
login**, and it asserts afterwards that no credentials were created.

    node docs/browser-checks/live-connect.js

⚠️ The CLI opens a real browser tab to the OAuth page mid-run. Nothing is
authorised, but on a console machine expect the tab.

## render-special-purpose.js

The detail panel calls the instructions a "special purpose" and names no file.

⚠️ **Restart the server after editing `web/index.html`.** It caches the page at
startup, so an in-place edit does not reach the browser. A mutation test that skips
this reports a false PASS: measured, while checking that the AA guard bites.

## render-thread.js

The project thread: the question, the picker, the viewport, a send that lands
and a send that does not, in light and dark.

⚠️ **It must be pointed at `thread-server.js`, never at `node server.js`.** This
screen SENDS. Against a plain server on this machine, pressing Send types into a
live agent's conversation. `thread-server.js` stubs the pane source and `chat`'s
tmux runner so a Send reaches a log line and goes no further, and the check
refuses to run unless it can read that server's own announcement of the stub in
the log it is handed.

    SB=$(mktemp -d)
    PORT=4421 AGENT_WORKFORCE_DATA="$SB/data" \
      AGENT_WORKFORCE_WORKERS="$SB/workers" \
      AGENT_WORKFORCE_LAUNCH="$SB/launch" \
      AGENT_WORKFORCE_PROJECTS="$SB/kosmos-projects" \
      node docs/browser-checks/thread-server.js > /tmp/threadsrv.log &

    NODE_PATH=/path/to/playwright/node_modules \
      node docs/browser-checks/render-thread.js \
        http://127.0.0.1:4421 /tmp/threadshots /tmp/threadsrv.log

**What it caught on its first run**, neither of which any text assertion could
see:

- A delivery that FAILED said "Could not deliver: can't find pane" for a few
  milliseconds and then went silent, because the refresh after the send cleared
  the message line — and the five-second poll cleared it again on every tick.
  The person pressed Send, the message did not arrive, and the screen ended up
  saying nothing at all: the stranded state this feature exists to remove,
  rebuilt inside the fix for it.
- The verdict line under each message measured **3.04:1** in light mode, under
  this project's 4.5:1 floor, on the one sentence that says whether a message
  got there.

⚠️ **And its contrast checker had the alpha bug the others still have**, in the
BACKGROUND rather than the foreground: the sibling checks take the first
background that is not fully transparent and treat it as opaque, which is fine
everywhere they look and wrong on this screen, whose terminal boxes sit on
`--attn-bg` — a 3.5%-black veil. Read as opaque it is near-black, so near-black
text on it measured 1.00 and the check reported two failures on a page that has
none. `flatten()` composites the whole stack. A false failure is cheaper than a
false pass and still costs the next person an hour.

### The three delivery states

`thread-server.js` arranges one agent per outcome, because a fixture where every
send succeeds photographs a third of this feature:

| agent | what its pane does | verdict |
|---|---|---|
| `mara` | takes both sends | `placed` |
| `nils` | refuses the text (`can't find pane`) | `could_not` |
| `casey` | takes the text, refuses the Enter | `unconfirmed` |

The middle column is the whole distinction: `could_not` means **nothing** of the
person's text reached the pane, so re-sending is safe. `unconfirmed` means it may
already be in that agent's composer, and a screen that draws it as a failure is
what makes somebody send it twice — on a permission prompt, the second copy
answers a question the first one already answered.

**What the second round of this check caught**, again none of it visible to an
assertion that reads source:

- The engine's `because` strings are written as CLAUSES, so pasting one after a
  full stop rendered "…until it finishes). it went into its window…". This is
  the defect `renderConnection` has a whole paragraph about further up
  `web/index.html`, committed again on the branch that quotes it. The check now
  asserts no sentence starts lower case.
- Three stacked instructions ("look at its screen", "it is in the conversation
  above", "it may be sitting in its composer unsent") pointing the person at
  three different places, in the message they read while deciding whether to
  press Send again. The engine states the fact; the page gives the one
  instruction. The check counts them.
- Two of the row counts were absolutes, and clearing the projects does not clear
  the THREADS — a project id is derived from its name, so a re-run rebuilds the
  same id and lands on the previous run's file. The counts climbed on every run
  (1, then 2, then 3). They are deltas now, which is the property that was meant
  all along: *this send* added one row.

  ⚠️ **The mechanism underneath that has since changed, and the paragraph above
  described the old one.** A thread now carries the project's `createdAt`, so a
  re-run's freshly created project no longer INHERITS the earlier run's
  messages — the first send supersedes them, renaming the earlier file aside and
  starting clean. Deltas are still the right instrument, for a better reason:
  they measure *this send* regardless of what any previous run left on disk, and
  they keep working whether the earlier thread is inherited, superseded, or
  absent. A count that only happened to be right because of how the store
  behaved last month is a count waiting to be wrong.

## render-talk.js

The agent page's own thread: the question, the option buttons, the composer, and
every state the drawing names, in light and dark.

```sh
NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-talk.js
# HEADED=0 on a machine with no console session; SHOT_DIR=<dir> to keep the shots
```

⚠️ **It needs NO server, and that is deliberate.** Unlike its siblings it loads
the page over `file://` and answers the poll from fixtures, because the states
worth looking at (an agent that cannot be reached, a menu we refused to parse, a
store that cannot be written) need a machine state a sandboxed server has no way
to be in. So it checks the PAINT, not the route. The routes are covered by
`node --test`; the paint is what `node --test` cannot see.

⚠️ **It measures in the page, and it also PRESSES things.** Overflow from
`scrollWidth` vs `clientWidth`, computed backgrounds for the transparent-panel
class, `elementFromPoint` for what is actually on top — and then focus survival
across a repaint, a failed send leaving the buttons pressable, a pasted line
clearing the composer, and a failed poll not stranding a keyboard user. Several
of those are defects no text test and no screenshot can see.

📌 **Its output filenames ARE the committed ones** (`talk-<state>-<theme>.png`),
so `SHOT_DIR=<dir>` then copying the set into `docs/screenshots/` reproduces the
committed evidence exactly. It emitted shorter names for its first two days and
the committed set was a hand-renamed subset of them — the shape the provenance
rule below exists to prevent.

## Screenshot provenance, including the four nothing regenerates

Every `docs/screenshots/thread-*.png` is emitted by `render-thread.js` under the
same filename it is committed as, so the whole set can be regenerated by running
the check. Every `docs/screenshots/talk-*.png` is the same, from
`render-talk.js`. That is the rule this directory operates on: **a screenshot in
the repo is evidence only if the next person can reproduce it.**

Four PNGs are exceptions, and naming them is the only honest way to keep the
rule meaningful:

| file | captured | reproduced by |
|---|---|---|
| `project-add-1-name-only.png` | 2026-08-13, by hand | nothing |
| `project-add-2-advanced-folder.png` | 2026-08-13, by hand | nothing |
| `agent-name-1-capitals-fine.png` | 2026-08-13, by hand | nothing |
| `agent-name-2-background-notice.png` | 2026-08-13, by hand | nothing |

They were driven manually against `thread-server.js` (the add-project flow and
the create-an-agent flow) with one-off Playwright scripts that were not kept.
They are **aging risks**: nothing fails when the screens they show change, so
they will go stale silently, and the first person to notice will be somebody who
trusted them.

⚠️ **Automating them is design-pass work, not a fix to slip in.** The
add-project and create-agent flows each need their own fixture arrangement and
their own assertions, which is a check of comparable size to `render-thread.js`
rather than an extra step inside it. Recorded here so the exception is a known,
dated, deliberate one rather than a silent violation of the rule two paragraphs
up — and so whoever does that pass knows exactly which four files it owes.

### thread-8-unfilable.png

**No longer an exception.** It was hand-captured on 2026-08-14 and is now emitted
by `render-thread.js` like every other `thread-*.png`, because the regression
test for the defect it shows had been written one layer away from it — asserting
on the route payload while the defect was a page SENTENCE, so reverting the
exact string left the suite green. Driving the screen fixed the guard and made
the screenshot regenerable in the same move. One exception fewer.

## ✅ Was: `render-sleep-button` times out. CAUSE FOUND 2026-08-27, fixed.

**The check was driving to the wrong step.** It clicked `#fr-next` once, with the
comment `step 1 -> step 2, the machine checks`. The machine-check step is **4**.

Step 2 is Welcome and contains **no `.fr-check` at all** -- `#fr-checks` lives
inside `<div class="fr-pane" id="fr-pane-4" hidden>`. So `waitForSelector('.fr-check')`
resolved to step 4's row, correctly reported it hidden, and waited out the clock:
`43 x locator resolved to hidden <div class="fr-check attention">`.

⭐ **Every measurement recorded in 2026-08-20's investigation was CORRECT, and
both hypotheses were about the ROW.** Exactly one `.fr-check`, carrying
`attention`, hidden, text beginning "needs your attention: We could not find t..."
-- all true, and all of it describing step 4's row seen from step 2. It was not
ambiguous and it was not missing-because-this-Mac-never-sleeps. It was in a pane
the walk had not reached.

📌 **The answer was in the tree the whole week.** `click-first-run.js` carries
`// The machine step is 4 now.` and clicks three times. One check knew; the other
did not; nothing connected them.

🔑 **The general shape, and it is worth more than the fix:** the failing selector
named a real element and the check asked a TRUE question about it. What was wrong
was the SUBJECT -- which screen the question was asked on. Re-running does not
catch that, and neither does re-reading the assertion. Ask what state the walk
actually left the page in before asking why the element is wrong.

Fixed by clicking through 1 -> 2 -> 3 -> 4 before waiting.

⚠️ **Check for orphaned servers holding ports before diagnosing ANY of these.**
On 2026-08-20 a survey found seven orphaned node processes on this machine, six
holding ports, the oldest eight days old — every one from a worktree that no
longer exists. A check that binds one of those ports fails with no visible
cause, and the natural reading is "the check is broken". That misdiagnosis cost
an hour on `render-first-run`, which is fine.

**The rule that makes the survey possible: a server whose working directory no
longer exists is decidable and always wrong.** No threshold, no judgement.

**`render-role-limit.js`** needs the sandbox to have FIRST RUN ALREADY COMPLETE,
before the server starts:

```sh
mkdir -p "$SB/data/AgentWorkforce"
echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/AgentWorkforce/first-run.json"
```

⚠️ **Skip that and onboarding covers the entire app.** The script asserts nothing
is on top of the sentence precisely because its first version did not, and passed
all twelve checks with the whole page underneath an opaque overlay. Laid out and
readable are different facts and only one of them is what this pins.

**`render-role-order.js`** also needs first run complete (same seeding as
`render-role-limit.js` above), and runs BOTH engines. WebKit is not optional:
the chosen row is marked by `:has(input:checked)` and nothing else, so a
`:has` that did not resolve would leave every option looking unchosen while the
form worked perfectly, and Kosmos opens Safari.

⚠️ **On macOS a click does not move keyboard focus to a radio** unless Full
Keyboard Access is on, so the script focuses before it arrows. Its first version
clicked, and read the missing focus as "native grouping does not work in Safari".

**`render-create-form.js`** replaced the script that pinned the create form's
closed "More models" disclosure, deleted on 2026-08-22. The disclosure is gone:
the providers are a menu now, with everything but Anthropic disabled. That
script was also already half-broken on main, because a SECOND `.smore` lives in
the first-run pane and its locator resolved to two elements. Deleted rather than
left passing its first four assertions on a control that no longer exists.

⚠️ The deleted script is deliberately not named here: this README is checked
against the directory, and a filename in prose reads to that check as a script
that should exist.

It needs first run complete (same seeding as above) and runs both engines.

**`render-create-made.js`** is the only script here that PRESSES CREATE. Start
the server with `AGENT_WORKFORCE_DRY_RUN=1` on top of the sandboxed roots, and
pass `--yes-dry-run` as the second argument or it refuses to run:

```sh
PORT=4561 AGENT_WORKFORCE_DRY_RUN=1 \
  AGENT_WORKFORCE_DATA="$SB/data" AGENT_WORKFORCE_WORKERS="$SB/workers" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch" AGENT_WORKFORCE_PROJECTS="$SB/projects" \
  node server.js &
NODE_PATH="$PW/node_modules" node docs/browser-checks/render-create-made.js \
  http://127.0.0.1:4561 --yes-dry-run
```

⚠️ **The flag is not proof and cannot be.** The server does not report whether
it is in dry run, so nothing in the script can check. Against an ordinary board
this would spawn a session and install a launch job for an agent nobody asked
for. It also needs first run complete, same seeding as above.

## The agent page's nav

`render-agent-nav.js` runs the server in-process against a fixture fleet
(`test-support/fleet`, every state root a temp dir) and clicks the seven pills
on an agent's page in both themes and at phone width. It asserts visibility by
rectangle, leads with a control (six sections at zero height before any click),
and reads the pills' names, the needs-you dot, and the ungated terminal box.
It found the first defect of its own branch: the client's box was ungated
while the server route still refused with the switch off.

## Hunting a winning CSS rule (the #39 method, and its one trap)

When a computed value disagrees with a declared one, ask the ENGINE which
declarations match the element rather than reading the stylesheet (the
lesson written at web/index.html's shint precedent): in a check or a
throwaway probe, walk `document.styleSheets`, test `el.matches(sel)` per
selector, and compare specificities of the rules that carry the property.
A `font:` shorthand riding `var()` serializes its longhands EMPTY in
cssText, so filter on rule matching first and read `cssText` whole.

🛑 **The trap, hit 2026-08-24 and worth not rediscovering: Chromium now
puts a `cssRules` property on EVERY style rule (CSS nesting), so a walker
that branches "has `cssRules` → recurse and continue" skips every rule's
own declarations and reports ZERO matches** — a false zero that reads as
"no rule touches this element" while the override sits in plain sight.
Check `selectorText` first, recurse after. The same shape as
test-support/page.js's brace-walk lesson: verify the instrument before
believing its silence.
