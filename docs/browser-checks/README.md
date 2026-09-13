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

## `fixtures/` (kosmos#2519)

`fixtures/agent-card.json` is a **recording** of one agent card as `status.snapshot()`
emits it, used by `render-talk.js`'s reopen arm on a box with **no live agents** so the
arm keeps its coverage instead of failing the cut. Every KEY is the producer's, and each
field's TYPE is preserved (a null stays null).

⚠️ **Not "only identifying string content is neutralised".** That sentence was wrong here
and the same wrong sentence was corrected twice elsewhere in this change before anyone
noticed it a third time in this file.

**The central guarantee, which this file never actually stated:** `scrubStrings` replaces
EVERY string anywhere in the card, at any depth, including fields status.js has not been
written yet. The categories below are what happens AFTER that whole-card scrub. A reader of
the old version learned only about the ISO-date branch and the `profile` subtree and could
have concluded the rest was untouched.

**What the tool does after the scrub: FIVE treatments and ONE gap. CATEGORY-LIST-BEGIN**
⚠️ The line above said "FOUR treatments and ONE gap, six items in all", which is four plus
one making six. Counting the categories is the act every version of this sentence has got
wrong, so the numbering below is now ascending, gap-free, and checked by an arm. ⚠️ This sentence has now been
wrong five times, each version claiming a smaller number than the truth ("nothing
identifying can survive", "nothing identifying is numeric", "there is no third category",
"everything is in exactly one of three", and then "in five categories" printed above SIX
items with the numbering skipping 4). Counting the items and counting the categories are
different acts, and every version so far has done one while claiming the other:

1. **PINNED to constants.** PIN-LIST-BEGIN
   `because`, `context.because`, `context.ceiling`, `context.ceilingAssumed`, `context.confidence`, `context.notYet`, `context.overCeiling`, `context.percent`, `context.tokens`, `disruption.cause`, `disruption.startedAt`, `disruption.timedOut`, `avatarVer`, `hasAvatar`, `model`, `modelName`, `name`, `role`, `session`, `sessionName`, `stateConflict`, `stateEvidence`, `stateProject`, `target`, `task`
   PIN-LIST-END
   (Paths, not names: `because` is pinned both top-level and under `context`.)
   🛑 **This does NOT make a re-capture byte-identical**, and the sentence claiming it did
   survived here after being struck in the tool's own header. `state`, `stateConfidence`
   and `runner` come from the raw card; the structural booleans pass through as captured;
   six fields vary between null and a value. The pins stop the volatile MEASUREMENTS
   moving, nothing more.
   ⚠️ **"And two profile timestamps" was wrong twice over.** No pin touches a profile
   timestamp. `scrubStrings` rewrites ANY ISO-dated string at any depth anywhere in the
   card to one constant. That is a scrub, not a pin, and it is neither two fields nor
   profile-specific.
2. **RE-PINNED from the raw card** because status.js enum-bounds them: `state`,
   `stateConfidence`, `runner`. Not constants, not structural booleans, not under
   `profile`. The old "exactly one of three" sentence had no room for these and the tool's
   own header calls them a real category.
3. **SCRUBBED STRINGS that are not re-pinned at all**, such as `disruption.cause`, which
   becomes `example-cause`. Neutralised, but pinned to nothing.
4. **STRUCTURAL BOOLEANS passed through**, because each has two possible values, carries
   nothing identifying, and must survive or the recording stops being a real card shape:
   `nameDerived`, `isAgentPane`, `isAgentSession`, `isFleetSession`, `isNamedOurs`,
   `paneless`, `stateProjectInferred`, `activeWhileWaiting`, `stateReported`,
   `stateBackgroundWait`, `neverRecorded`, `reachedByChannel`.
5. **The `profile` subtree**, which gets the strictest treatment: every STRING, NUMBER and
   BOOLEAN under it is neutralised, at any depth. ⚠️ Not literally every value: a `null`
   survives as null, and an array's LENGTH survives even though its elements are scrubbed.
   The tool's own `scrubStrings` comment says so and this file said "EVERY value", which is
   the broader of the two copies. It is free-form
   (`store.readProfile` returns whatever JSON is in the file), so an allowlist there is a
   guarantee resting on what the tree happens to write today. `profile.doctrineVersion`
   is a producer number that reached the recording before this was structural.

⚠️ **There is exactly ONE enumeration in this file and it is the sentinel-bounded list
above.** A second copy stood here, in the bare-name-plus-parenthetical form that
`tools/capture-agent-card.js` identifies as a hole (a name appearing once cannot say that
`because` is pinned in two places), and it announced itself as "checked by an arm" while
sitting OUTSIDE the sentinels the arm reads. The branch went from four copies to six while
claiming it had made the enumeration mechanical. An arm now reds on any second
enumeration outside the sentinels.
6. **A NON-STRING the producer adds OUTSIDE `profile`**, which is in none of the above and
   reaches the committed file verbatim. This is a real gap, not a treatment: measured, a
   `pid: 48213` added to the card or inside `disruption` comes out unchanged, and the
   key-set refusal cannot see a field added inside an existing subtree. Two arms pin the
   current inventory (the live card and the shipped artifact, plus the `disruption`
   subtree explicitly) so that the NEXT one reds a test instead of arriving silently, but
   nothing prevents it.

**CATEGORY-LIST-END**

🛑 **That list has gone stale twice, in all four copies at once each time** (this file,
the tool's header, `render-talk.js`'s header, the plan). If you add a pin, grep for one of
these field names before you finish.

🛑 **Do not hand-edit it.** That is the invented-fixture defect `render-talk.js`'s own
header describes, arriving by another door. Re-record it instead:

```
node tools/capture-agent-card.js     # run on a box that HAS live agents
```

🛑 **The suite constrains WHICH card, and the recipe used to say only "a box that has live
agents".** FOUR arms constrain the committed recording, and the paragraph that first said "three"
named three that do NOT enforce the working half: the rename control only asserts the file
does not already hold `needs_you`, the context arm asserts `confidence: "structured"`, and
the non-string inventory pins the measured `context` key set. The one that actually
enforces WORKING is a fourth, the placeholder-identity arm, whose `stateEvidence` check
accepts only null or a line starting `✽ Working…`. It reds on a re-capture of any
non-working card carrying a `stateEvidence` string, and its message named neither
re-capture nor the constraint, which is exactly the failure this paragraph exists to
prevent, happening inside the paragraph. ⚠️ **And the sentence that first stated this overstated the enforcement, in both halves.**
Measured against the arms: an idle card WITH a readable transcript reds NONE of the four
(the rename control only tests `!== 'needs_you'`; the context arm and the inventory arm
both pass on a measured context; the placeholder-identity arm passes because an idle card's
`stateEvidence` is null, since status.js sets no evidence on that path). An
unreadable-transcript card reds TWO, not three: the rename control is indifferent to it.
So the constraint below is a REQUEST backed by partial enforcement, not a gate. So: **capture while an agent of yours is actually
working and has a readable transcript**, and if you meant to change the recording's shape,
update those arms deliberately rather than reading their red as a bug.

🛑 **NESTED `context` DRIFT IS NOW CLOSED (kosmos#2553); `profile` DRIFT IS DELIBERATELY
NOT.** The gap was real: a rename inside `context` leaves the top-level key-set comparison
in `yarn test` GREEN while the committed recording drives `openDetail` with a shape the
producer no longer emits, on exactly the quiet boxes the fallback exists for. `openDetail`
reads `context.percent`, so it was not hypothetical.
**What closes it:** the `COMPOSITION-AWARE DRIFT GUARD` arm in
`render-talk-goldencard-2519.test.js` derives the SET of `context` key-sets `engine/status.js` can
emit and asserts the recording matches one of them. It reads no board, so composition
cannot fire it (that is what killed the first attempt, removed for firing on an 18-agent
board where two `profile` shapes were legitimately present); it derives from the producer,
so an un-re-captured `engine/status.js` rename matches none and reds; and it lives in the unit
test, not the release-cut check, so a false red costs a test run and never a cut.
**`profile` is left out on purpose, and that is not the same gap.** It is free-form (the
tree writes `dir`/`displayName`/`role`/`reportsTo` per operator), scrubbed wholesale by the
capture, and every page read of it is guarded (`a.profile && a.profile.role`), so a missing
`profile` key is COMPOSITION, never drift.

⚠️ **The LIVE-vs-fixture drift guard (this recording compared key path by key path against
one live card) is still absent, and must stay absent** -- it was the removed attempt, and
its absence is pinned by an arm carrying the `COMPOSITION-AWARE DRIFT GUARD` escape hatch.
kosmos#2553 closed the `context` gap a different way (against the producer's variant SET,
not against one live card), which is why re-adding it is not re-adding the bug.

The capture refuses to write if neutralisation changed the key set.

⚠️ **`render-talk.js` does not behave identically to before this change on every populated
box, and that is deliberate.** Its `liveCard()` now prefers a PANE card over a paneless
one, where the old code took whichever `isNamedOurs` card came first. Two consequences
worth knowing before a cut: on a multi-agent board a paneless card can no longer win the
selection (though `find` still takes the FIRST pane card, so the input is still
pane-ordered, and an earlier version of this line wrongly said the ordering dependence was
gone), and on a board where EVERY card of ours is paneless the RECORDING drives
the arm instead of a paneless live card. The second is the better outcome (`openDetail`
gets the shape it is written for rather than null session/target) and it is not silent:
`realCard` reports `golden` and the run prints the fallback NOTE.

⚠️ `browser-checks-indexed.test.js` indexes `.js` scripts only, so most of this section
can go stale without failing. That is NO LONGER true of the `PIN-LIST` region above: an arm
in `render-talk-goldencard-2519.test.js` extracts the pinned paths from the capture tool
and reds if this file omits one, lists one the code does not pin, or carries a second copy
of the enumeration outside the sentinels. The sentence used to say nothing checked this
section at all, which told a reader the opposite of what is now true. It is here because a committed input to a release-gating check should
say what it is and how it was produced.

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
| `render-org-rings-2576.js` | The context ring + needs-you badge on the Agents org-chart nodes (#2576/#2577): installs a needs_you agent plus two others, sets known readings on each agent's `LAST` entry, re-drives the real `paintOrg`, then reads every `#orgmap .onode` -- a context gauge on EVERY node with an arc tracking its reading (30/70/88% -> ok/warn/high band), a red warning-triangle badge (`.owarn`, the list row's glyph) on the needs-you node ONLY, and NO old `::after` state arc on any node. Unknown context draws no ring. Proven RED by reverting to the old `class="onode' + ring` + `.onode.attn::after` (the badge-only and no-::after arms fail); a fixed non-reading arc reds the arc-tracks-reading arm. |
| `render-dm-badges-2863.js` | The unread-DM bubble on the Agents LIST row and the ORG node (#2863, the follow-up to the grid-card badge #2885): installs a needs_you agent plus two others, seeds `a.dmUnread` on `LAST`, re-drives the real list (`#alist` = `LAST.map(lrow)`) and `paintOrg`, then asserts across both themes that the `.dmbadge` renders and is laid out (not clipped by the overflow:hidden list `.lav`), reads the seeded count, sits at the avatar corner on the list and TOP-LEFT on the org node (opposite the top-right needs-you `.owarn`, so a node that is both never stacks them), with a no-unread negative control on each view. |
| `render-detail-ring-1915.js` | The memory ring on the agent detail avatar (#1915): sets a known reading on the open agent and re-drives the real `openDetail` wire, then reads the rendered `#d-ring` -- the ring reaches the page, its arc length tracks the reading (30/70/88% -> ok/warn/high band), the element is actually laid out, and an unknown reading draws no ring. The rendered confirm the source test cannot give, since it catches a dropped `openDetail` wire line while `detailRing()` itself stays correct (a `.dring` CSS-size regression is not caught -- see the check's docblock). |
| `render-agentpage-fullwidth-2012.js` | The full-width agent page (#2012): the content column fills the width past the old 544px cap, the header spans full width (max-width none), `#d-window` fills the page height past the old 560px cap, and the message body keeps a ~66ch measure. Each arm is written as a comparison against the old cap so it reds on the pre-#2012 page. |
| `render-subprojects-1994.js` | Sub-projects UI (#1994): drives the shipped `paintProjects`/`projectCard`/`paintProjectSettings` against a fixture project tree: a parent's children nest (indent depth in the wide tab list) with a full ancestry line (#2487, "Kosmos › App", was a single "under <parent>" chip) plus decorative depth dots and a sub-project count, and the detail page shows a parent trail + sub-projects section, a child of an archived or dangling parent still renders at the top level (nothing vanishes), a stored cycle renders every row without hanging, and the set-parent `<select>` excludes self + descendants + archived (offering only a parent the engine would accept) while preselecting the current parent. Both themes. |
| `render-cons-tree-2929.js` | Consolidated tree (#2929, Josh 6.59 QA): the consolidated projects rail reads as an openable file structure. Drives the shipped `paintProjects`/`projectCard`/`applyConsFold`/`pjTreeToggleFold` + the `#pj-list` click and keydown delegates against a real fixture tree (top > subproject > third level). Asserts: computed indent grows with depth (24/38/52px); a parent shows a displayed fold caret and `aria-expanded`, a leaf shows neither; a nested `.child` drops its ancestry chip while a dangling-parent child keeps it; folding a parent hides its whole subtree (`pj-fold-hidden`) and flips the caret to ▸ / `aria-expanded=false`, folding a subproject hides only the third level; ArrowRight/ArrowLeft expand/collapse the focused row; and, the key control, in the tab layout the caret is hidden and a consolidated fold hides nothing (the change is consolidated-only, so the shared markup the wide list reuses is never reshaped). Both themes. |
| `render-projects-map.js` | kosmos#2458 (Josh, 2026-09-08 "map view right now"): the Projects tab's third layout, Map, a top-down org chart of the project tree, drawn to Mona's design/subprojects.html (#112) "The Map" spec. Hermetic (file://). Drives the real Map viewtoggle button + `paintProjectsMap` against an injected hierarchy and asserts: reveal of `#pj-map` + the list hidden at computed `display`; a Kosmos root carrying the fleet count; the real parent/child NESTING; attn/idle/count node lines; the dark-mode attn-red contrast lift; both empty states (all-archived vs none); a stored cycle rendered once; the boot-no-paint TDZ contract. Plus the spec additions: each project node is a clickable button (`data-project`, routes to `openProject`) while the Kosmos root is not clickable; a per-branch fold disclosure on parents (leaves none) collapses a branch (child hidden, `aria-expanded=false`) and re-expands; the map scrolls in both directions; and the Map toggle is gated on sub-projects existing (`pjHasSubprojects`). Every assertion can return the dangerous answer. |
| `render-pj-clear-2575.js` | kosmos#2575 (STATE half): DRIVES the project-page "Not waiting? Clear it" dismiss button (`#pj-question-clear`) end to end, the served wiring the node test (`web.pj-clear-state-2575.test.js`, which lifts `pjClearState` against stubs) cannot see. Hermetic (file://), answers every route from `addInitScript`. Opens a project whose one member is a REPORTED needs_you agent (body shape matched to `paintThread`, not hand-rolled), then asserts: the `#pj-question` block paints; the button reads "Not waiting? Clear it" and is REACHABLE via `elementFromPoint` (the render-talk inert lesson); `paintThread` set `PJ_QUESTION_AGENT`. A real click through the shipped listener POSTs `/api/agent/Mara/clear-selfreport` exactly once with `{reason:"operator-dismissed"}`, takes the question OFF screen, drops the clear target, clears the error line, re-enables the button, and STAYS off on the next read (persists). Internal red-capable contrast: a `{ok:false}` clear must LEAVE the question on screen, surface the could-not-clear line, and NOT re-read the thread. Every assertion can return the dangerous answer. Does NOT cover the served-CUT packaging or #2575's needs-operator prod verify. |
| `render-qask-clear-2808.js` | kosmos#2808 (render half): DRIVES the agent-page "waiting on an answer" controls end to end, the served wiring the node test (`web.qask-clear-clamp-2808.test.js`, which lifts the two click handlers against stubs) cannot see. Hermetic (file://), answers every route from `addInitScript`, drives `paintTalk` the render-talk way (set `CURRENT`, unhide `#panel-detail`, stub `/api/agent/<name>/thread` with an asking thread carrying a TALL multi-line command wall). Asserts: `#d-qask` paints; `#d-qask-text` gets `.clamped`; `#d-qask-expand` is visible + REACHABLE via `elementFromPoint` (the render-talk inert lesson), reads "Show full command", and a click toggles `.expanded` and flips the label to "Show less" (aria-expanded true); `#d-qask-clear` is visible + reachable and reads "Clear this message". A real click through the shipped listener POSTs `/api/agent/april/clear-selfreport` exactly once with `{reason:"operator-dismissed"}` and takes the whole `#d-qask` box OFF screen (the success re-read sees asking:false). Internal red-capable contrast: a `{ok:false}` clear must LEAVE the box on screen, surface the could-not-clear line, NOT re-read the thread, and re-enable the button. Every assertion can return the dangerous answer. Not CI-allowlisted (matches render-pj-clear-2575; runs at the cut). |
| `render-worldsw-height-2350.js` | kosmos#2350 (Josh, 2026-09-06): the multi-Kosmos switcher control on the header icon row is the SAME rendered HEIGHT as the light/dark switcher (`.themepick`), so the two read as a matched set. Hermetic (file://). Reveals `#worldsw`, gives it a name, and asserts `getBoundingClientRect().height` of `#worldsw-btn` EQUALS that of `.themepick` at DPR 1 and DPR 2 (the 0.5px control border rounds to a device pixel, so the match must hold on retina too). Compares the two live values rather than a hardcoded pixel count, so a future change to either control re-surfaces here. Control: the pre-fix page (no explicit height on `.worldsw-btn`) measures ~25px against the theme control's 32px and reds. |
| `render-emoji-mute-2357.js` | kosmos#2357 (Josh, 2026-09-06): the composer emoji-picker button (`#pj-emoji-btn`) is a MUTED GREY smiley, not a bright-yellow one. Hermetic (file://). Asserts the glyph span carries a computed `grayscale(...)` filter (a color-font emoji is desaturated by a paint filter; CSS `color` cannot), that the filter is on the GLYPH span and NOT the `.emojibtn` button (so the hover/focus affordance background is unaffected), the grinning-face glyph is present, and the button keeps its aria-label with the glyph aria-hidden. Control: the pre-fix bare-text glyph has no grayscale filter and reds. |
| `render-worldrename-1704.js` | kosmos#1704 item 14.1 + PR4 (Josh: "the little settings cog next to that particular KOSMOS"): a settings cog on EVERY Kosmos row in the switcher, the default "Kosmos 1" included, opening that Kosmos's settings pane. HERMETIC (loads web/index.html over file://, boots no server, fetch stubbed): calls the page's real `worldswRender()` with fixture worlds (default + one named) and asserts both rows carry a cog labelled "Settings for <Kosmos>". A NAMED Kosmos's pane offers rename pre-filled with its name (Save posts `POST /api/worlds/rename` with `{ id, name }`) and says which agents are waiting to start there, by display name. Kosmos 1's pane hides rename (its name is fixed), opens with focus on Close, lists only the OTHER Kosmoses' agents (a name it already holds shows "(already here)", disabled), keeps "Add agents" disabled until an agent is ticked, and Add posts `POST /api/worlds/import` with `{ id, importAgents }`, says what happened and moves focus to Close. A real keyboard Tab stays inside the pane. Reds on the pre-PR4 switcher (no cog on Kosmos 1, a rename-only modal). The engine `renameWorld` + the route are unit-tested separately (engine.worlds-rename-1704 + server.test.js #1704 14.1); the pane's units are in web.world-import-agents-1704.test.js. |
| `render-workindicator-2146.js` | kosmos#2146 (render half): a needs_you/blocked agent that is ALSO actively working shows the board's working glyph alongside its pending state (coexistence, not precedence). HERMETIC (file://): calls the page's real `card()` AND `lrow()` -- both board surfaces, since the list is half the board -- with fixture agents, and asserts the engine's additive `activeWhileWaiting` flag paints a `.alsowork` affordance (the reused `.act` dots + a "Working now" label) WITHOUT changing the state cell's class, its label, or the ground treatment. Placement is checked per surface (grid card: a sibling BELOW the pill; list row: INSIDE the .lstate cell). Controls that can each return the dangerous answer: the SAME needs_you agent with the flag off shows no badge and an identical cell-class/label/ground (so the flag's only effect is additive); a BLOCKED agent with the flag also gets the badge (driven by the flag, not scoped to needs_you); a plain working agent is NOT double-marked. A live-DOM arm verifies the consolidated view hides the badge's decorative dots and sizes its label to the row (with a normal-layout control proving that hide is the consolidated rule, not a global one). Reds on the pre-#2146 page (no `.alsowork`). The engine `activeWhileWaiting` derivation is unit-tested separately (engine/status.activewhilewaiting-2146). |
| `render-worlds-switcher-1704.js` | The multiple-Kosmos switcher (#1704 slice-3, list + create): drives `GET /api/worlds` (the switcher beside the K mark shows the active world's name, the menu lists the worlds with exactly one marked active) and `POST /api/worlds` (the create modal disables Create on an empty name and enables it on a name, and creating a Kosmos closes the modal and the new world appears in the list on refetch) against its own throwaway sandbox registry, plus the switcher stays visible in the consolidated view (since #2282's persistent full-width header). Switching between worlds is slice 2b and not covered here. |
| `render-worldswitch-2238.js` | kosmos#2238: the multiple-Kosmos SWITCH is actionable AND reconnects (the 0.6.35 bug was read-only rows: create worked, selecting a world did nothing; #2346 then landed the fail-safe board self-restart, so `POST /api/worlds/active` returns a FINAL `{ restartRequired, restarting }` the client acts on). Hermetic (file://) against a stateful board stub. Asserts a NON-active row is a real, actionable native <button> and clicking it POSTs `/api/worlds/active` with that world's id; then across the three server outcomes: `restarting:true` shows a "Switching..." banner, POLLS `/api/status.activeWorldId` (the BOOTED world, not the instantly-flipped registry pointer, so it observes the OLD id before the reboot -- the false-success race is closed) and RELOADS on the confirmed flip; `restarting:false` gives HONEST manual "restart Kosmos" guidance with NO reconnect/reload; a no-op switch (`restartRequired:false`) says the world is already active with no reload. Controls: the pre-fix page has no row click handler (the POST-called + marker-moved arms red), and disabling the reconnect branch reds the "Switching..."/reload/booted-poll arms. |
| `render-worldsw-abandon-2628.js` | kosmos#2633 (follow-up to #2628): a SILENT world-switch abandon is surfaced. When a switch reports `restarting:true` but the board comes back on Kosmos 1 having ABANDONED the world you asked for (engine/worldenv + engine/worldbootguard, the #2528 lockout recovery), the reconnect used to poll a bare "Switching..." for the whole ~150s ceiling; now `worldswReconnect` reads `/api/status.lastAbandonedWorld` and says at once `"<name>" could not start, so Kosmos brought you back to Kosmos 1...`, keeping the switcher menu (which holds the banner) open and NOT reloading. Hermetic (file://), board stubbed, reusing the #6 switch flow (row click -> confirm modal -> "Restart Kosmos"). Scenario A (FRESH abandon): board back on w1 (never the switched-to w2) with `lastAbandonedWorld` matching the switched world and stamped AFTER the switch -> the abandon banner names the world, the menu stays open, and `worldswReload` is never called. Scenario B (STALE abandon -- the `at > switchStart` guard): `lastAbandonedWorld.at` older than the switch start (an earlier boot's abandon) must NOT fire the banner; the reconnect falls through to the normal slow ("taking longer than usual") then timeout guidance, still no reload. CONTROL: disabling the #2628 abandon branch reds scenario A (the banner stays "Switching..."); the engine abandon signal is unit-tested in engine/worldenv.abandon-2628. |
| `render-world-import-2563.js` | kosmos#2563 + #1704 PR4: the New Kosmos step, "Add my agents from", one agent at a time. HERMETIC (loads web/index.html over file://, boots no server, fetch stubbed): opening the create modal calls `worldImportFetch()` (GET /api/worlds/list) and `worldImportRender()`, which draws one GROUP per Kosmos: a box labelled "<Kosmos> (N agents)" that ticks every agent in it (part-ticked when only some are) and, beneath it, one labelled box per agent (value = name, data-from = the Kosmos). Scenario A: ticking the first Kosmos's box and one agent of the second, then Create, posts `importAgents:[{from, name}]` for exactly those on POST /api/worlds (COPY semantics); the answer (they start when the new Kosmos is opened) keeps the dialog open with that sentence and Cancel reads Done. Scenario S: Skip clears every tick, and Create posts exactly `{ name }`. Scenario B (endpoint unreachable -> 404): #world-add-import stays HIDDEN so the create flow is unchanged. CONTROL: the pre-PR4 page has one box per KOSMOS (value = world id) and no Skip, so the group and payload checks red. The render/fetch/submit units are covered by web.world-import-2563.test.js. |
| `render-model-spinners-2365.js` | kosmos#2365 / Josh 0.6.40 retest #11: the existing inline `.kspin` breathing spinner appears on the Choose-a-Model screen loading/waiting lines. Hermetic (file://), driving the page's own painter (`frPaintConnect` into `#fr-sub`) plus the OpenAI connect handler. Asserts each SYSTEM-working connect phase (downloading, installing, signin-launching, signin-completing) renders a `.kspin`, the OpenAI "Adding..." validate state (stubbed never-resolving POST) renders a `.kspin`. CONTROL: `signin-browser-open` is waiting on the PERSON to sign in in the browser (not the system working), so it must NOT get a spinner. Whole-feature control (vs origin/main): the pre-fix page renders none of these `.kspin` and reds on all 5 arms. |
| `render-trust-restart-0644.js` | kosmos 0.6.44 (#5 insurance): the View-Agent Terminal tab's "Trust & Restart" button POSTs to `/api/agent/<name>/trust-and-restart` (Pete's route: writes the folder-trust key then restarts, so an agent stuck at the terminal trust question can be unblocked from the page). HERMETIC (file://): sets `CURRENT`, stubs `fetch`, fires the handler. Asserts the button exists, the click POSTs to the URL-encoded `/trust-and-restart` route (method POST), a 200 `{because}` is shown, a 400 refusal `{because}` is shown, and a network throw shows the friendly fallback. kosmos#2129 (arm 7): the same one-click action is also surfaced in the chat "Needs you" box (`#d-qask-trust-restart`, shown only for the folder-trust state); arm 7 reveals that twin, fires it, and asserts it exists and POSTs the same URL-encoded route with the `{because}` shown. CONTROL: on a page without the button arm 1 reds; the stub records the exact URL+method so a wrong route/method reds arm 2; a missing chat-box twin reds arm 7. |
| `render-open-terminal-0644.js` | kosmos 0.6.44: the View-Agent Terminal tab's "Open Terminal" button POSTs to `/api/agent/<name>/launch-terminal` (Pete's route: attaches a Terminal.app window to the agent's live tmux session so the person can watch/answer; read-only about the agent). HERMETIC (file://): sets `CURRENT`, stubs `fetch`, fires the handler. Asserts the button exists, the click POSTs to the URL-encoded `/launch-terminal` route (method POST), a 200 `{ok:true}` shows the opening confirmation, and any non-200 `{ok:false, because}` shows the reason for BOTH a 400 genuine refusal (agent not running) and a 503 environment failure (headless board) -- the handler must not special-case the status code -- and a network throw shows the friendly fallback. CONTROL: no button -> arm 1 reds; wrong route/method -> arm 2 reds. |
| `render-pjmsg-prewrap-2294.js` | kosmos#2294: a PLAIN marker-less multi-line message renders its paragraph breaks on the project message list (`.pj-msg-text`) instead of collapsing to one line. Hermetic (file://), using the page's own `pjRich`. Asserts `.pj-msg-text` computes `white-space: pre-wrap`, a plain two-line message renders taller than a one-line message (the break renders -- the fix), and a MARKDOWN two-line message (pjRich slow path, `<br>`) renders at essentially the same height (pre-wrap does not double its breaks, since the slow path's inter-line breaks are `<br>`, not literal newlines). Control: the pre-fix `white-space: normal` collapses the plain two-line message to one-line height and reds. |
| `render-richtext-2067.js` | Restricted-markdown rendering in agent dialogue (#2067): calls the shipped `pjRich` in the page across markdown/degrade/XSS inputs (bold, italic, strike, inline + fenced code, one heading, lists, quote, hr, emoji, bare-URL autolink; a `<script>`/`onerror` payload stays inert; plain text is byte-identical to the page's own `esc`), then paints the real talk thread with a markdown agent message and asserts the DOM and computed CSS (heading weight, code background) in both themes. Extended for #2701: also asserts GFM tables render as a real table element and heading levels render at graduated sizes (mdh1..mdh6, computed h1>h6 in the painted DOM). |
| `render-richtext-room-2239.js` | Restricted-markdown rendering in the PROJECT ROOM activity thread (#2239, the surface #2067 deferred): calls the shipped `pjBody`/`pjProse` in the page (heading, bold, italic, lists, inline + fenced code, paragraph breaks -> `<br>`, a cited file kept as a "Show me" chip alongside emphasis, a bare `>` staying LITERAL because the room owns a server-supplied quote, a `<script>` payload inert, plain single line byte-identical to `esc`), then posts a markdown room message through the live server and asserts the real `.msg-b` DOM and computed CSS (heading weight, code background) in both themes. Reds on the pre-fix room, which escaped + autolinked only. Extended for #2701: also asserts GFM tables render as a real table element and heading levels render at graduated sizes (mdh1..mdh6, computed h1>h6 in the painted DOM). |
| `render-engmode-gate-2131.js` | The project terminal is gated on Engineering (Advanced) mode (#2131 regression guard). With eng-mode OFF the raw terminal `.pj-viewport` and the one-to-one box `#pj-thread` are HIDDEN on the project page; the CONTROL turns eng-mode ON and asserts those SAME two elements become VISIBLE (so the OFF arm is not vacuous, not a terminal that never renders); and the SAFETY arm pins the exemption the fix must never break - an ASKING agent keeps its question panel `#d-qask` VISIBLE even in Off (it is how the answer is typed). The gate is page-wide (`ENG_ON`), so these arms cover the mechanism the conversation view shares; a detail `#d-window` arm is omitted because it needs a live captured screen this fleet harness cannot provide (a hidden-in-Off assertion on it would be vacuous). The reported v0.6.28 leak does not reproduce on current main; this locks the invariant so it cannot silently return. |
| `render-workchip-zero-2157.js` | #2157 (Josh 2026-09-04): the Agents-tab "Working" tile (the count chip AND its `.act` animation) must NOT render at a KNOWN zero, so an animated "0 Working" never implies activity when there is none. HERMETIC (loads web/index.html over file://, boots no server; stubs `/api/status`) and drives the page's OWN `tick()`. Arms, both engines: the tile wraps BOTH `.act` and `#st-working`; nonzero -> shown + animation laid out; KNOWN zero -> hidden AND the animation is removed from layout (Josh's exact ask, which a fake-element unit test cannot see); a FLOORED zero (an `unknown` agent present) stays shown and renders "0+" not hidden (hiding would claim "none working" on a count that cannot stand behind it -- the #2023 honest-rendering rule); a failed poll brings a previously-hidden tile BACK showing "?", never leaves it hidden. Proven RED on the pre-#2157 page (the tile has no `#st-working-tile` id there, so every arm reports the tile could not be found). The tile-hide LOGIC across the same four cases is additionally pinned by server.test.js's extracted-slice unit test; this check pins the real DOM/CSS integration (the animation actually disappears). |
| `render-firstrun-namestep-1994wiz.js` | The first-run name/identity step (#1994, Josh's live fixes): the time zone `<select id=fr-you-tz>` is restored, populated and defaulted (three labelled fields now, reversing #1345's "exactly two"); the name input is width-capped while "What do you do?" keeps full width (computed max-width, so a stale rule reds); the "Continue saves this into every agent..." copy is gone; and pressing Continue POSTs the timezone to `/api/settings` (the real request is caught, proving the save wiring). 10 of 12 arms red on the pre-#1994 page. |
| `render-observed-consumers-1959.js` | #1959: the observed-liveness badge (#1921) is read by the OTHER /api/accounts-fed consumers, not raw `connection.state === 'connected'`. HERMETIC (loads web/index.html over file://). Four arms: the shared helper matrix (`acctUsableLogin`/`acctUnknownLive`/`acctOfferableTarget` across every badge value + the badge-less legacy-state fallback); the `paintConnLive` board summary via a fetch stub (counts usable logins, EXCLUDES `rejected` -- the #874 defect on this surface -- and stays honest on `unchecked`); the `paintAccountPicker` move eligibility via a seeded `ACCOUNTS` global (a `rejected` current account is now signed out and the move UI offers the working sibling as target; a working current account is the control; and an `unchecked` current account -- a live check we could not read -- is NOT called signed out but reads could-not-check, the #1959 NIT / #2023 rule); and the `fillCreateAccounts` create-agent picker via a seeded `CREATE_ACCOUNTS` global (a `rejected` account is EXCLUDED as a run target, an unchecked account stays offered+labelled). Verified 26/26 (chromium+webkit); proven RED on the pre-fix page by observed behavior (the summary counts "3 accounts connected" with rejected included, a rejected current account gets no move prompt, an unchecked current account is falsely called "signed out", and the create picker offers the rejected account). |
| `render-firstrun-openai-connectbox-2241.js` | kosmos#2241: the connected OpenAI/codex state on first-run renders the SAME gold check-row box Claude uses (the #2187 sibling), reading "OpenAI GPT Codex is connected. This computer is signed in.", not a plain "Added: API key ending" line. HERMETIC (loads web/index.html over file://, no server): drives the real `frPaintOpenai({connected:true})` and reads computed style off `#fr-openai-msg` -- the `.fr-check.ok` checkrow paints (sized, non-vacuous), the box carries the `.fr-connbox` gold-wash background + gold border. CONTROL: a not-connected (dead) paint leaves a plain hint (`dhint`, transparent), never the gold box, so a green is not "any content is gold". |
| `render-firstrun-openai-sub-2621.js` | kosmos#2621 (Josh): the first-run INSTALL flow offers the same "Sign in with ChatGPT" subscription choice Settings does, not API-key-only. HERMETIC (loads web/index.html over file://, no server): drives the real first-run flow and asserts the picker (#fr-openai-pick) offers both Sign-in-with-ChatGPT AND an API key; "Use an API key" reveals only #fr-openai-flow; "Sign in with ChatGPT" reveals only #fr-openai-sub-step; and a stubbed subscription/start -> connected paints the SAME gold "OpenAI GPT Codex is connected. This computer is signed in." box (a subscription carries no keyTail, so no "API key ending" suffix), flips the Connect button, and clears the picker/sub-step. Asserts first-run sends NO reauthDir (a fresh add is never a reauth). Reds on origin/main (frOpenaiShowPick / the picker do not exist there). |
| `render-chatgpt-signin-no-name-2913.js` | kosmos#2913 (Josh, 6.59 QA): the ChatGPT-subscription sign-in must NOT ask for a name -- the subscription pulls in the account's email automatically and that distinguishes accounts, so a name field is extra work for nothing (the API-key steps keep theirs: a pasted key has no email to pull). HERMETIC (loads web/index.html over file://, no server): asserts neither subscription step (`#acct-openai-sub-step`, `#fr-openai-sub-step`) has a name input or the "name is optional" copy, that both "Sign in with ChatGPT" buttons (`#acct-openai-sub-go`, `#fr-openai-sub-go`) remain, and -- as a CONTROL that the removal is surgical not global -- that the Anthropic API-key name field (`#acct-claude-key-label`) is untouched. Reds on origin/main (both `*-sub-label` inputs and both "name is optional" copies exist there). |
| `render-settings-openai-goldbox.js` | kosmos#2241 sibling (SETTINGS, not first-run): adding an OpenAI/codex account in the add-a-provider modal ends on the SAME gold check-row box, reading "OpenAI GPT Codex is connected. This computer is signed in. (API key ending X)", not the bare "Added: API key ending X" line Josh screenshotted (#2241 only covered first-run). HERMETIC (loads web/index.html over file://, no server): drives the real Settings add flow (openAcctAdd -> acctPick('openai') -> paste key -> click Add, stubbing the /api/accounts fetches) and reads computed style off `#acct-success-box` -- the `.fr-check.ok` checkrow paints (sized, non-vacuous) with the spec copy + key-ending, the box carries the `.acct-connbox` gold-wash background + gold border, and the default check/"Success!" heading/say line are hidden (the box carries its own check + title). CONTROL: a plain (Claude) success reuses the SAME panel but stays the green-check panel ("Successfully connected to your Claude account."), NOT the gold box, so a green is not "any success renders gold"; the close-then-reopen path exercises the reset. |
| `render-claude-connect-choice-2433.js` | kosmos#2433 (UI slice of #2420; Josh's #2338 "follow suit on Claude too"): the Settings add-a-provider modal offers Claude the SAME subscription-vs-API-key choice OpenAI has. HERMETIC (loads web/index.html over file://, no server): drives the real add flow (openAcctAdd -> acctPick('claude')) and asserts a fresh add lands on `#acct-claude-pick` with both flows hidden; "Use an API key" reveals `#acct-claude-key-step` (a painted password field + primary Add) and hides the picker + sub step; "Sign in with your subscription" reveals `#acct-claude-sub-step` (the browser-OAuth warn + Start) and hides the others; a pasted ANTHROPIC_API_KEY (stubbing POST /api/accounts/claude/apikey) paints the gold "Claude is connected" box; and a reauth (openAcctReauth) skips the picker onto the subscription step. Then drives the REAL paintAccounts() over a stubbed list (an api-key row + a subscription row) and pins the #2441 row-action state (the #2420 removal engine has landed): the api-key row now carries a LIVE Disconnect and Delete-and-remove, still suppresses Sign-in-again (reauth into a key-holding dir is refused by the connect-start guard #2432; switching billing is remove-and-re-add), and shows NO leftover disabled "removal coming" Disconnect. It also pins the tooltip honesty: the api-key Disconnect title says it ERASES the saved key (forgetAccount erases the raw key on an api-key account) and does NOT reuse the OAuth "sign-in file stays / nothing is deleted" copy, and the api-key Delete title drops the "Unlike Disconnect" contrast (api-key Disconnect erases the key, so it is not the reversible option). CONTROL: the subscription row keeps its live Sign-in-again (which the api-key row lacks) and keeps both the OAuth Disconnect copy and the "Unlike Disconnect" Delete contrast (Disconnect is reversible there), so the reauth suppression and the tooltip rewordings are specific to api-key rows, not blanket; the two-rows-rendered guard makes the row asserts non-vacuous. |
| `render-connect-win32-install-570.js` | kosmos#570 (BLOCKER 3): the connect card's Windows way out. On win32 `connect.download()` refuses before any bytes move -- the binary it fetches is a macOS build -- and the card then offered nothing but "Try again" (the same doomed download) and "Continue anyway" (a board that cannot make a working agent). The note names the real installer, MEASURED not composed: `claude.ai/install.ps1` picks win32-x64/win32-arm64 off the same `downloads.claude.ai` manifest connect.js's own downloader reads, and lands `claude.exe` at `%USERPROFILE%\.local\bin\` -- the exact rung `runners.resolveBin('claude')` resolves, so the instruction and the check that lets a person past the screen agree by construction. HERMETIC (loads web/index.html over file://, no server): drives the page's own `frPaintConnect` with the sentence the engine really produces on win32. ARM 1 asserts `.fr-cmd` renders with real area and the EXACT command, and that its computed white-space wraps rather than clips -- a wrapped command is a wrong command, which is why the rule is pre-wrap/overflow-anywhere, and that is a computed result a source test cannot see. ARM 2 is the Mac control: no PowerShell command, and the plain note instead, so the change is specific rather than blanket. ARM 3 IS THE DISCRIMINATOR: it drives win32 with `canInstallClaude: true` and requires the command to be GONE. The painter gates on BOTH fields on the stated grounds that the day Kosmos publishes a Windows runner build the note retires itself instead of naming a command nobody needs -- a claim that only holds if the gate really reads both, so a gate loosened to the platform alone passes arms 1 and 2 and reds only here. `downloads.claude.ai` already publishes win32 builds, so that is a reachable future, not a hypothetical. |
| `render-win32-board-copy.js` | win32-board-copy (the Windows nativeness and parity audits, 2026-09-12): the board page on Windows, rendered, with the Mac page as the control. The page reads its platform from a server-stamped `<meta name="kosmos-platform">` and its one copy layer (`applyPlatformCopy`) hides Mac-only surfaces through a single `html[data-kosmos-platform="win32"] [data-win-hide]` rule and swaps keyed text from `windowsCopyTable`. Both are COMPUTED results a source test cannot see: a hide rule that loses to a more specific selector leaves the macOS dialog on screen while every markup assertion passes. HERMETIC (loads web/index.html over file://, no server; the page's boot fetches are stubbed before it loads, render-autohello-2686's `addInitScript` shape, so WebKit's file:// access-control refusals never surface as page errors and nothing is filtered). In chromium and webkit it stamps the meta to win32, re-applies the layer, un-hides ancestors, and asserts the computed `display:none` of the S3 Energy and Accessibility mocks, the Accessibility gate row, the S7 Dock drawing, the Settings Accessibility button, the tmux box, the auto-update row and Open Terminal; the Windows words on `#docs-finder` ("Open in File Explorer"), `#set-reveal` ("Open the Kosmos folder"), the Terminal tab ("Live output") and the S7 body; the not-signed-in panel pointing at Kosmos.exe with no Mac path; the wizard walking 1,3,5,6,7,8,9; and no page errors on either page (an unfiltered `pageerror` listener, so a real script error still reds it). CONTROL: the same page with the meta unstamped is not stamped, still shows every one of those surfaces and the Mac words, walks all nine steps and keeps the Mac not-signed-in panel, so the Windows arm cannot pass on a page that hides them from everybody. |
| `render-sound-master-2436.js` | kosmos#2436 (Josh, 2026-09-07): the GLOBAL master on/off for the #2407 new-message sound, in Settings > Automation > Sounds. HERMETIC (loads web/index.html over file://, no server): unhides the automation section, paints `#snd-toggle` from `soundMasterOn()` and asserts it renders ON by default (aria-checked/`.on`, visible + sized); pins Mona's label + hint copy; clicks OFF and asserts the accessible state flips AND the preference persists (`localStorage['kosmos.sound.master'] === 'off'`); clicks back ON and asserts it flips and clears the stored off; and asserts `paintSwitch` reads a stored off back so the next open paints OFF. The GATE logic (master OFF silences the pop on every project, and silences-not-defers) is covered deterministically in `web.bubblepop-2407.test.js`; this pins the DOM half. Non-vacuous: flipping `soundMasterOn`'s default to OFF reds it. |
| `render-firstrun-connect-box-2187.js` | #2187: the Claude connect output on first-run step 3 sits in a light-gold box. HERMETIC (loads web/index.html over file://, boots no server): drives the page's own frPaintSubscription() (connected) and frPaintConnect() (installing) into `#fr-sub` and reads computed style: the "... is connected" checkrow AND the "Setting Claude up..." setup notification each land in a box with the gold-wash background + gold border (the same values `.fr-confirm` uses). The empty control is the discriminator -- an empty `#fr-sub` computes display:none (no bare gold rectangle before anyone connects), so dropping the `:empty` guard reds it. The connected checkrow's real size is asserted first, so no style arm is vacuous. |
| `render-firstrun-access-onebox.js` | Josh 0.6.39 #8 (screen 9.50.20, Mona's #8 spec): screen 2 (Access) shows ONE compact macOS-style prompt preview with the Allow button ringed, not the old three-card stacked fan. HERMETIC (loads web/index.html over file://, boots no server): unhides the `#fr-pane-2 .s2-dlg-fan` chain and reads static markup + computed style. Four arms, each reds against the pre-#8 three-card page: exactly one `.s2-dlg` (was three); the single `.s2-say` is the verbatim `"Terminal" would like to access files in your folders.` with the per-folder (Documents/Downloads/Desktop folder) copy gone; both Don't Allow + Allow buttons render; and the Allow button's `::after` draws a solid gold ring (the callout) while Allow itself is the blue macOS default button. The ring is a computed `::after` a source read cannot see. Illustrative preview only -- the functional `.s2-gate-row` grant below is untouched and not asserted. chromium + webkit. |
| `render-firstrun-stepcap-gear-0640.js` | Josh 0.6.40 re-test #9 + #10. HERMETIC (loads web/index.html over file://, boots no server): unhides `#fr-pane-3` / `#fr-pane-4` and reads computed style. #9: the two `.s3-step-cap` numbered captions render compact (<=12px, weight 600), NOT the 17px/400 they inherited when a bare `.s3-step-cap` lost to `#firstrun .fr-body p` (the gigantic+stretched bug), and no `.s3-standin` element remains (the "(stand-in graphic)" dev-note leak is removed). #10: `.s4-gear` box hugs the cog (box 48-58px, glyph 40-48px) after the 0.6.45 tighten, not the old 76px box nor the original 38px/22px. #768-batch (Josh, 5.44.01, said three times; Mona third round): the S4 title `.s4-nt` is BOLD (computed weight >= 700) at the SMALL body size (.6875rem, ~11px, band 10.5-11.5), and the body `.s4-nb` is normal weight (< 700) at that same size (bold, NOT larger, NOT 17px) -- BOTH kept being dragged to 1.0625rem/17px because a bare class loses the cascade to `#firstrun .fr-body p` (400/1.0625rem), so the computed weight was 400 and the size 17px whatever the rules said; the size-band and weight arms red on that pre-fix page (the old check pinned only ntSize==nbSize, which passed at 17px==17px). And the S4 cog is flex-centred (display:flex, align+justify center) WITH line-height collapsed to the glyph (== font size, not `normal`'s ~1.2x), which reds on the pre-fix `display:grid;place-items:center`. Each earlier arm reds against the pre-0.6.40 page (17px captions, standin present, 38px gear) and arm 3 also reds against the pre-0.6.45 76px box. The caption size and title weight are computed cascade results a source read cannot see. chromium + webkit. |
| `render-firstrun-connect-fires.js` | Josh 0.6.39 #3: the first-run "Connect Claude" button (`#fr-llm-connect`) must FIRE the connect flow when clicked. HERMETIC (loads web/index.html over file://, boots no server): stubs `frConnectStart`, dispatches a real click on the button, and asserts the handler ran (`before=0, after=1`). The button lives in `#fr-pane-5` but its click handler had been delegated on `#fr-pane-3`, so clicks never reached it and the button was tappable-but-dead; the fix binds a direct listener. Proven non-vacuous: REDS on the old delegated code (`after=0`), greens on the fix, chromium + webkit. Invisible to a source read and the node unit suite -- only a real click distinguishes a wired button from a dead one. |
| `render-firstrun-enter-2186.js` | #2186: Enter/Return activates Continue on a wizard step when the step is valid. Drives a real keydown on the focused About-you name field and proves both arms off that one gated step: empty fields (Continue disabled) => Enter does not advance; filled fields (Continue enabled) => Enter fires the real `PUT /api/you` and advances the wizard, exactly as clicking Continue would. The empty-vs-filled contrast is the discriminator; reds against a page with no `frEnterSubmit` handler (the valid-step arm never advances). |
| `render-made-before.js` | The never-recorded state, on a screen (#149/#150, 2026-08-23). |
| `render-busy-line.js` | The "<name> is working…" line, rendered |
| `render-room-busy-scope-2882.js` | The project room "…are working" indicator (#pj-busy) is scoped to its own project (#2882, sibling of #2837): an agent working in this project lights its own room, the same agent does NOT light another project's room (the unscoped-global over-claim), and an unattributed working agent (stateProject null) lights no room (the documented under-claim). Reds on the pre-fix unscoped filter. |
| `render-reauth-reach-1918.js` | kosmos#1918: the agent page's "Sign in again" button (auth_failed) actually REACHES the re-auth surface. Clicks it and asserts the settings PANEL becomes visible and the detail panel hides, the browser-only check a jsdom test (which stubs showTab) cannot make. Red against the iteration-1 dead control that called settingsGo without showTab. |
| `render-picker-provider-2097.js` | kosmos#2097/#2098: the create-agent picker is provider-aware. Drives the real `applyCreateProviderUI` and reads `#create-model-row`: on OpenAI the model row is HIDDEN whole (no stale "Claude Sonnet 5" under an OpenAI key) with the model note in its place (the #2140 auto-fallback note when no account is listable); on Anthropic it is shown. Reds on origin/main (no `#create-model-row`, where the model select was only disabled, still displaying its value). |
| `render-create-openai-model-2140.js` | kosmos#2140: the create-agent OpenAI model picker. Drives the real `paintOpenaiCreateModel` with a stubbed `/api/accounts/openai/models`: a LISTABLE account shows the picker with "Let OpenAI choose (recommended)" first + the account's models, and selecting one surfaces its why via `paintModelWhy`; a NOT-LISTABLE account (ChatGPT-mode key) shows the box with the single "OpenAI picks its own model for now" option (no Claude model) and a note keyed to the reason. Reds on the pre-#2140 index (no `paintOpenaiCreateModel`) and the pre-refinement index (box hidden). Also (#2453 follow-up) an OpenAI IMPORT pre-picks the account's `default:true` model while a normal create stays on "Let OpenAI choose", with the one-shot lifecycle checked end to end: consumed after the paint, cleared on `resetCreateProvider` and on switch-to-Claude, surviving the account-less first paint through to the account-selection paint, and graceful fallback when the list has no default; plus source-pins for `finishImport`'s authoritative set and `resetCreateProvider`'s clear. |
| `render-detail-openai-model-2140.js` | kosmos#2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail page. Drives the real `paintOpenaiDetailModel` with a stubbed `/api/accounts/openai/models` and a set `CURRENT`: a LISTABLE account shows the account's models with "Let OpenAI choose" first and the agent's CURRENT model (`a.plannedModelName`, the raw id for OpenAI) pre-selected, NEVER a Claude model; a NOT-LISTABLE account shows the single "OpenAI picks its own model for now" option with the reason on the msg. Reds on origin/main, where `paintOpenaiDetailModel` does not exist (the detail picker matched Claude models by label under an OpenAI agent). |
| `render-provider-combobox-1040.js` | kosmos#1040 2b: the provider logo combobox (`enhanceProviderSelect` over `#d-provider`). Drives the shipped widget in the real page and asserts the WAI-ARIA combobox contract: the native `<select>` stays the source of truth (visually hidden, still in the DOM with its options), the trigger shows the selected mark+label, click/keyboard open + ArrowUp/Down navigate (aria-activedescendant, skipping disabled) + Enter selects and syncs the hidden select's `.value` and fires `change` + Esc closes and refocuses the trigger, a coming-soon option is aria-disabled and not selectable, Grok/xai falls back to an initial-letter chip (no wrong-brand mark), and a programmatic value change re-renders the trigger. Both themes, plus a screenshot. This is the a11y CONTRACT; a real screen-reader pass is the human follow-up. |
| `render-openai-only-2096.js` | kosmos#2096: the "cannot reach a Claude subscription" banner is provider-aware. Drives the real `renderConnection` into `#conn` (file-load): OpenAI-only (`dependsOnClaude=false`) shows NO banner; a Claude-dependent machine STILL warns when Claude is unreachable; a MISSING field falls back to warning (never hide a real Claude failure); connected hides. Reds on origin/main, where `renderConnection` takes only `(conn, agents)` so the OpenAI-only case still shows the banner. |
| `render-firstrun-model-continue-2134.js` | kosmos#2134: the first-run wizard MODEL step offers Continue when OpenAI is the connected model provider, not only when Claude is. Drives the real `frPaintOpenai` with a connected OpenAI account and Claude not connected, and reads `#fr-next` / `#fr-alt`: Continue is shown and "Skip connecting a model" is hidden. Reds on origin/main, where `frPaintOpenai` never touches the action buttons so the OpenAI-only model step shows only Skip. |
| `render-firstrun-s6-2037.js` | kosmos#2037 (PR-C2): the first-run wizard SCREEN 6 "self improving" consent switch is real, keyboard-operable, and a default-ON opt-out control. HERMETIC (loads web/index.html over file://, boots no server): shows step 6 via the real `frGo(6)`, reads the `#fr-s6-feedback` (daily report) role=switch span as default aria-checked="true", confirms the on-show refresh (which fails to read on file://) leaves it ON (never a false Off), then drives a real bound CLICK and a KEYDOWN(Space)/Enter on it, asserting each flips aria-checked AND sends a PUT to `/api/feedback-setting` via a fetch stub. Also asserts the create-ping switch (`#fr-s6-createping`) is ABSENT (removed per #11/0.6.39; its `/api/ping-setting` backend was later deleted in #2623). Reds on a page where the wiring is absent (the span renders but a click does nothing and no PUT is sent). |
| `render-tophead-consolidated-2282.js` | kosmos#2282 (Josh 0.6.36; Mona's mock design/top-header.html): ONE full-width header across the top on every view. HERMETIC (loads web/index.html over file://, boots no server): reads computed display in the tab view (control: header + tabs show) and in the consolidated view (sets `data-layout=consolidated` + `body.consolidated` at >=960px). Asserts that in consolidated the top header `.headright` stays visible with the appearance (`.themepick`) + view-toggle (`.laypick`) controls and the K mark + Kosmos switcher, the center `.tabs` stay hidden (one screen), the side rail's own `.railme-theme`/`.railme-lay` copies are gone (folded up into the header), and the rail keeps its per-view person -> Settings (`.railme-go`). Reds on origin/main, where the consolidated view hides `.headright` and shows the rail copies. |
| `render-firstrun-import-1652.js` | Screen-9's create arm shows NO find-agents link (#5, Josh's 0.6.39 ruling: "There is no link to appear, even"). The #1652 link was added then removed after Josh's fresh-install test: it wrongly showed on the empty screen and jumped to create instead of loading found agents onto screen 9. Self-boots a sandboxed server; forces the create empty state and asserts the single "Giddy Up" primary, ONE fork button, and NO `.fr-lookimport` link and NO "Documents and Downloads" copy; CONTROLS: the adopt ending (a real fleet) shows no link either, and bare `openCreate()` lands on prompt mode not import. DOM-state only, headless. |
| `render-firstrun-scan-on-grant-1652.js` | #1652: after the file-access grant, found agents LOAD onto screen 9 -- no link (Josh's 0.6.39 ruling: "It just pulls them in"). The counterpart to `render-firstrun-import-1652` (which proves the link is gone); this proves the detection that replaces it. Self-boots a sandboxed server and stubs three routes: GRANTED (`/api/file-access-status` -> `granted:true`) makes `frScanAgents` reach the TCC folders via `/api/scan-import` (not the bare `/api/scan-agents`), and the returned candidates render on screen 9 via `frPaintScan` ("We found 2 agents on this computer.", two add/skip rows). CONTROLS: declined (`granted:false`) and uncheckable (`checkable:false`, e.g. a browser with no native writer) both keep the bare TCC-free scan, so the import scan's macOS prompt NEVER fires without a positive grant (#2125 no-ambush). Which-route assertions via route-hit counters, DOM-state only, headless. |
| `render-import-add-inplace-2419.js` | #2419 (Josh, 0.6.45): the found-agents IMPORT rows add in place, in one click, without jumping to the create page. Self-boots a sandboxed server and stubs four routes (grant + empty scan-agents so `#fr-fleet` is reached; `/api/scan-import` -> one loose agent FILE; `/api/agent-import-file` -> the parsed shape; `/api/agents` -> records the create body). Asserts the row shows name + "Add to Kosmos" only (no path/preview/"Import this one"); clicking Add POSTs `/api/agents` with name + own role + label + instructions (anthropic default and tellKosmos omitted); the button becomes "Added to Kosmos" with the green `::before` check and the `added` class, the row is `done` and STAYS on the list; and it did NOT navigate to `#panel-create`/`#cstep-name` (still on `#firstrun`). CONTROL: a parse refusal shows the reason, re-enables the button, leaves the row not-done, and fires NO create. DOM-state + recorded-POST assertions, headless. |
| `render-bubblepop-2407.js` | #2407 (Josh, 0.6.45): the per-project new-message "bubble pop" plays in the shipped page. Self-boots a sandboxed server and replaces AudioContext (via addInitScript, before any page script) with a counting stub, then exercises the real `ringNewMessages`/`playBubblePop`/`projectSoundOn` globals. Asserts the globals are wired; the first (baseline) load does NOT ring while a later unread rise rings once; a burst (several projects rising at once) rings once, not per message; a muted project does not ring and an unmuted one does (per-project); `SOUND_QUIET` (Do-Not-Disturb) suppresses the pop; the pop a real AudioContext builds is a sine starting at 400 Hz (the documented recipe); and the per-project settings toggle (`#pjs-sound-toggle`) exists and `paintSwitch` drives its state. DOM-state + stubbed-AudioContext call count, headless. |
| `render-addmem-flash-2429.js` | #2429 (Josh, 0.6.45): the add-member modal closes on a successful add BEFORE the board refresh, so the free-agent picker's empty-state line never flashes. Self-boots a sandboxed server, seeds one project + one free agent, opens the modal, and stubs the add POST (success) + the `/api/projects` refresh (agent now ON the project, so the picker would go empty if repainted while open). A MutationObserver records whether the "already on it" text appears while `#am-modal` is visible, and the refresh fetch records whether the modal was already hidden when it fired. Asserts: the modal closes; the empty-state never flashes while open; the refresh runs AFTER the modal is closed. The old order (loadProjects inside addMemberToProject, before amClose) fails both the flash and ordering assertions, so they are real controls. DOM-state + call-ordering, headless. |
| `render-firstrun-wizard-flow.js` | #1652: the first END-TO-END integration guard for the combined first-run flow. Every install fix merged separately, but the whole 1..9 wizard was never verified as one flow, and screen INTERACTION is what broke 0.6.39. Self-boots a sandboxed server and CLICKS Next through 1..9 (never deep-links -- a deep link skips the transition logic under test), mocking the permission/scan endpoints so the flow proceeds without the real macOS TCC grant (that rides Josh's fresh-install re-test, #2243). GRANTED: all 9 advance with no stuck transition and S9 loads the found agent via the granted import scan (#2349 in-flow); NOT-GRANTED: the S2 file-access gate BLOCKS (Next disabled, cannot advance past S2); FINISH: the S9 primary fires /api/first-run/complete. Which-endpoint + DOM-state, headless. |
| `render-build-marker-2066.js` | kosmos#2066: the board's build marker renders the version in persistent chrome and carries the channel by WEIGHT. Drives the real `paintBuildMark` against a file-load (no board): prod paints a small dim version string with no fill; staging paints a loud badge whose background + ink are asserted via COMPUTED STYLE (non-transparent AND differing from prod, so a phantom class or a missing `--stag` token reds it); an undefined channel falls to prod; no version hides. Reds on origin/main (no `paintBuildMark`, no `#buildmark`). |
| `render-account-badge-1921.js` | kosmos#1921: the Settings account badge renders VERIFIED liveness from `connection.badge`. Drives the real paintAccounts against a stubbed /api/accounts (no board) and asserts the rendered `#set-accounts .acct-box` badge class + text per state. Load-bearing arm: a merely-existing credential (`signed_in_unverified`) renders the MUTED class, never the green `.acct-connected`, in a real DOM, the #874 false-green a source-only unit test cannot rule out. |
| `render-disconnect-stop-2570.js` | kosmos#2570: the Settings row's SECOND confirm. Drives the real paintAccounts against a stubbed /api/accounts and a stubbed DELETE that refuses by NAME until the request carries `stopAgents`, then presses three times. Load-bearing arm is the ORDER: the FIRST disconnect must not carry the flag, because a page that always sent it would stop agents nobody agreed to stop. Also pins the WCAG 2.5.3 armed name (accessible name starts with the visible words) for the second confirm, which the one CONFIRM constant cannot cover. |
| `render-account-name-2095.js` | kosmos#2095: the human-chosen account name is the PRIMARY label in the Settings AI-models row; the key last-4 is a secondary detail. Drives the real paintAccounts against a stubbed /api/accounts (no board) and asserts a NAMED OpenAI row shows its name (never the key) as `.acct-who b` with the key on a secondary `.acct-keytail`; an unnamed OpenAI row and a Claude row are unchanged; and an arbitrary name is HTML-escaped (no injected element child). Reds on origin/main (the row shows the key, not the name). |
| `render-restore-dircheck-2615.js` | kosmos#2615 (follow-up to #2609): the removed-list **Restore** control is made UNAVAILABLE when the account folder the agent ran on is gone. #2609 made the ENGINE refuse that restore (restoring would re-enable a launchd job pointing at a deleted directory, the #1659 blank-agent state); the person was still offered a live button and told no afterwards. `/api/removed` now ships `accountFolderGone`, computed by the SAME exported predicate `restore()` refuses on (`removal.restoreBlockedByMissingAccountDir`) rather than a second copy of the test, so the pre-click state cannot drift from the post-click answer. Hermetic (file://), board stubbed, drives the real `paintRemoved()` against a stubbed /api/removed. Seeds TWO rows from one payload: a blocked one and a normal one. 🛑 **It asserts COMPUTED STYLE as well as semantics, and that arm exists because the card shipped greying nothing out while every attribute arm passed.** `disabled` was doing two jobs, the semantics AND the `.btn:disabled` dimming; moving to `aria-disabled` kept the first and silently dropped the second, leaving the blocked and live buttons identical on opacity, cursor, background, colour and border. Arms assert the blocked row is dimmed at all (not a specific number, so a contrast tweak does not red it) and shows `not-allowed`, with a negative arm that the live row is NEITHER. 🛑 **It asserts `aria-disabled` and REDS on hard `disabled`, which is the opposite of what an earlier version of this row said.** A `disabled` button leaves the tab order, so a keyboard user never lands on it and never hears the reason (the repo names a non-focusable control a WCAG AA failure), and a `title` on a disabled control is not announced at all. Do not "fix" the check or the page to use `disabled`: that reintroduces both defects at once. 🔑 The refusal is enforced STRUCTURALLY by the absence of `data-restore` (what the click handler selects), not by the attribute, because `aria-disabled` is advisory and would let a press through on its own; an arm reds if a blocked row still carries `data-restore`. A press on the unavailable control must SAY WHY (a focusable control that does nothing is the failure `aria-disabled` invites), and that explanation must NOT destroy an in-flight restore's "Starting X again" sentence, since `#removed-msg` is one shared assertive region. Both directions of the listener seam are pinned: pressing a LIVE Restore, or the "Delete its files" control in the same row, must not fire the explain handler. Also asserts the accessible name and tooltip say BOTH why it is unavailable AND what makes it work again (matching the engine refusal's own "add that account back under the same name first"). **The negative arm is the load-bearing half:** the normal row must stay LIVE and carry no blocked explanation, because a page that disabled every Restore would satisfy the positive arm alone and would be a worse regression than the one this fixes (a control greyed out where the engine would have said yes looks like a decision, so nobody reports it). CONTROLS, all measured rather than asserted: never-disable reds the positive arm (8 problems, reproducing origin/main); always-disable reds the negative arm (4 problems); widening the explain selector to `.acts button` reds the live-control arm; deleting the `.acts .btn[aria-disabled="true"]` CSS rule reds the two style arms; and widening that rule to every `.acts .btn` reds the style negative arm. |
| `render-account-dup-reauth-2584.js` | kosmos#2584: two "Sign in again" (reauth) controls on Settings > Accounts must never answer to the same accessible name. Seeds the colliding pair itself -- one email with a Claude subscription default (~/.claude) and an OpenAI ChatGPT default (~/.codex), neither labelled -- so coverage does not depend on the board's real accounts the way `named-controls.js` does (it only catches this when the live board happens to hold such a pair). Drives the real paintAccounts against a stubbed /api/accounts (no board) and asserts the two rendered `.acct-reauth` aria-labels are non-empty and DISTINCT. Reds on origin/main, where both defaults take qual="main" and read "Sign in again as agent@example.com (main)". |
| `render-codex-account-picker-2811.js` | kosmos#2811: a DEFAULT-account Codex agent's detail panel must not say "We cannot tell which account this one uses". #2811's `accountForAgent` provider gate is GLOBAL, so the board route resolves such an agent's account to `null` and it lands on `paintAccountPicker`'s `!ours` branch, whose sentence is FALSE for it (the null means no CLAUDE account, not that we cannot tell -- the server's account-status route says so in as many words about the identical wording). NOTE: file names in this column are parsed by browser-checks-indexed.test.js as script references, so other files are named without backticks here. Drives the real `paintAccountPicker` against a stubbed /api/accounts, one page load per arm, and asserts the rendered `#d-account-msg`. CONTROL: the same card with `runner: 'claude'` must still produce the old sentence, else the branch was not reached. Reverting the fix reds it. |
| `render-room-scroll.js` | The project room keeps a reader on the floor when the composer resizes it (#1037) |
| `render-reactions-2255.js` | Emoji reactions on room posts (#2255, hover-restyled in #2806): self-boots a sandboxed server, creates a project + agent, posts a message, opens the room, and drives the operator flow - a post shows the grey-smiley opener and NO "+" (removed per #2806), a quick bar with exactly three default reactions, no initial pills and a hidden full picker; the quick bar is opacity 0 until the message is hovered, then reveals (opacity -> 1); the smiley opens the full picker (PJ_EMOJI) with aria-expanded; clicking a picker emoji adds a pill with count 1 marked `.mine`/aria-pressed; clicking the pill again toggles the reaction OFF (the round-trip control leaves no pill); Escape closes the open picker. DOM-state + computed-opacity, both themes. |
| `render-talk-anchor-1926.js` | kosmos#1926: the agent talk thread keeps a scrolled-back reader on the same MESSAGE (not a pixel) across a repaint that grows content above them. Drives the real `setThread` + `threadAnchor`/`restoreThreadAnchor` against real `data-mid` rows in a real scroll box (no board), grows the rows above the reader between two paints, and asserts the reader's offset below the viewport top is preserved. Control: computes where a pixel-restore would have left them and asserts it would have jumped (so the above-content genuinely grew). Also asserts `dmRow` stamps the stable `data-mid` the anchor reads. Fills the gap `web.thread-scroll.test.js` leaves (its stub box has no rows, so only the pixel fallback is exercised). |
| `render-alltasks.js` | Every task across every project, and the heading's number equals the rows on the screen (#1382). |
| `render-composer-reset.js` | The composer goes back to one line after a send, measured as a rendered height (#1303 C). |
| `emoji-picker-2254.js` | The project composer emoji picker (#2254, input side): the button opens the panel with aria-expanded, the panel is populated, a pick inserts the glyph at the cursor in #pj-post and the panel stays open, Escape closes it. Reds on pre-#2254 (no button), and perturbation-verified (a no-op insert reds the insertion arm). |
| `render-head-row.js` | Settings stays on the project header row, beside the title and the search (#1043) |
| `render-fields.js` | The field and control invariants, measured in a real browser, in BOTH schemes |
| `render-first-run.js` | Render every first-run state in a real browser and look at it |
| `render-gated-next.js` | The S2/S3 permission-gated Next, driven for real: file-access (S2) and sleep+tmux (S3) disable Next ONLY on a measured not-granted reading and unlock on the grant; uncheckable (a browser) and any fetch failure fail SAFE (never block, never false-green); the poll (FR_GATE_POLL_MS, 750ms) re-checks so a grant unlocks on its own, and a "Check again" button (#2451/#2559) lets the user force it now. Also covers #2587: the sleep step is ADVISORY -- a blocked sleep row never disables Next (a laptop that sleeps on battery cannot satisfy it), and the honest note replaces the useless Turn On on that battOnly row; a second arm proves Accessibility/tmux STILL gates Next when sleep is advisory (no bypass into broken agents), and a fixable-desktop control confirms sleep is advisory for everyone. Subsumes the retired render-a11y-gate-2125 (tmux gate) + render-sleep-button (sleep gate). |
| `render-permission-slider-2620.js` | #2620: the first-run S3 mock permission switch (.s3-sw) MIRRORS the real gate instead of a hardcoded On -- not-granted draws no data-granted and runs the swipe hint animation, granted draws data-granted, stops the hint, and is the on-brand blue #2f7bf6. Also asserts the real overlay button (.s3-sw-open, lifted out of the aria-hidden mock) is present, a focusable `<button>`, and carries a target-naming aria-label. Drives the a11y status endpoint not-granted then granted. Deliberately leaves the pixel-precise overlay POSITION and the swipe FEEL to the headed pass (frSyncSwitchOverlays measures the position at runtime across two different mock heights; a human confirms the animation reads gentle). |
| `render-token-usage-2617.js` | Settings > Token Usage is the graphical value view, not a plain white box (#2617): four class cards in FULL numbers (cache-read gold), a shared-axis trend chart with one polyline per class (cache-read towers, the true proportion), an OUTPUT-derived money box that names its class, and the per-model/day table kept. /api/usage is mocked to a fixed two-day response, so the rendered structure is deterministic on any board. The pixel/dark-theme match to Mona's mockup is the headed pass; this pins the pieces are present and wired to the data. |
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
| `render-autohello-2686.js` | kosmos#2686: after a USER-INITIATED restart the board auto-sends the wake `hello` instead of asking the person to type it, but only AFTER the restarted agent is back up (a restart is async -- it kills the pane and a supervisor respawns it later, so an immediate send types into a dead pane). HERMETIC (file://, fetch stubbed). Drives the real `rst-go` confirm handler and asserts: on a restarting->idle recovery exactly one `hello` POSTs to `/api/agent/<name>/thread` and the notice becomes "said hello"; an agent that stays `restarting` sends NO hello and falls to the manual line (the #2019 gap guard -- boardCanSeeIt alone would call it ready); an agent ready on the FIRST poll with no observed gap sends NO hello (the stale-snapshot guard). Also drives the shared `autoHelloAfterRestart` helper directly with the doctrine "Add Instructions & Restart" flow's phrasings (the second call site), and asserts an unconfirmed thread route never claims "said hello". |
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
| `render-createnav-2190.js` | Create advances to the progress ('made') screen on click instead of showing 'Making it' inline; a refusal/error routes back to the create screen with the message beside the field (#2190). Hermetic file://, stubs /api/roles + /api/agents. |
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
| `render-inline-field-errors-2606.js` | kosmos#2606: Create an Agent and Create a Project show validation errors INLINE and field-level (red border + message beside the field + focus), not as small text below the submit button. Drives the shipped `pjFieldBad`/`pjFieldOk` helper and the real `#pj-create` empty-name gate against the real page (file://, no board): asserts the three `.ferr` slots (`#create-name-err`, `#create-label-err`, `#pj-name-err`) show the reason, the input gets `.bad` + `aria-invalid` + focus, the broadened `.frow input.bad` selector paints a red border (read from getComputedStyle, distinct from the plain border), and `pjFieldOk` + typing clear the flag. Both themes. |
| `render-frnav-2647.js` | kosmos#2647 (Josh, product review 2026-09-10): the first-run energy/accessibility screen's **Check again** control and its copy live in the BOTTOM NAV, far left, beside Next. His report was that he **could not see the helper copy at all before finishing the connection**: the old in-pane block rendered perfectly and simply sat below the fold, which is a defect no unit test can see. Hermetic (file://), board stubbed, drives the real `frGo` to the step DISCOVERED from `#fr-s3-msg` (identity, not index, per lib-firstrun-steps). 🛑 **The load-bearing arm is the PRESS, not the placement.** The obvious way to implement this card is a DEAD BUTTON that looks entirely correct: the old Check-again handler is delegated on `#fr-pane-3`, and `#fr-alt` lives in `.fr-acts` OUTSIDE every pane, so moving the class alone yields a control that renders, styles and focuses correctly and silently does nothing. Every placement arm passes on it. The press arm spies on `frRecheckGates` (rather than counting network calls, which the 750ms background poll also makes) and is the only arm that can tell. ⚠️ It UNHIDES `#firstrun` before any geometric arm, because rects inside a `display:none` subtree are all 0x0 at 0,0 and a "far left" comparison between zeros passes on any layout at all. Also asserts Josh's exact top copy, that the deleted reassurance line is gone, that the old in-pane control is gone (moved, not copied: two of them means the invisible one is back), and a NEGATIVE arm that the hint does not leak onto another screen, since `.fr-acts` is shared by nine of them. It also asserts the control is STILL PRESSABLE after a press (a one-shot button that disables itself and never returns is the realistic regression for a control whose whole purpose is "flip the switch, press again", and the press arm alone cannot see it), and that `aria-describedby` ties the button to its hint: the move COST this control its adjacency, since the hint used to sit directly under the gate rows it refers to and now lives in a footer shared by nine screens, where a rotor or tab lands on a button whose whole accessible name is "Check again". CONTROLS, all measured against an isolated copy: replacing the alt's `go` with a no-op reds ONLY the press arm while every visual arm still passes; dropping the re-enable in `frRecheckPress`'s finally reds the one-shot arm; never setting the aria tie reds the describedby arm; never CLEARING it reds the stale-tie arm; dropping the hint-clear calls reds the leak arm; restoring the old top copy reds the copy arm; and moving the hint span after `.fr-spacer` reds the adjacency arm. ⚠️ That last arm was VACUOUS in its first version: it admitted any position in the ~350px between the two buttons, so the span could drift 99px off its own button, wedge toward Next and read as a caption for the wrong one, and still pass. The flex gap is a measured 14px at every width, so the bound is 24px, which is a real limit rather than a restatement of the layout. |
| `render-discovery-gate-2651.js` | kosmos#2651(a) (Josh, product review 2026-09-10): the found + scan DISCOVERY PANELS must NOT auto-scan-and-show on Agents-page load. Josh read that auto-appearance ("we found agents on your computer", widened by #2414/#2410/#2452/#2243) as Kosmos importing every agent file on the machine without consent. The panels are now gated behind an explicit "Look for agents already on this computer" press (`DISCOVERY_OPENED`); a full page reload starts collapsed again. Hermetic (file://), stubs /api/found-agents and /api/scan-agents, forces the Agents tab (`boardbar.hidden=false`), drives the real `paintFoundBoard`/`paintScanBoard`/`paintDiscoveryTrigger`. Six arms: (1) ON LOAD both panels stay hidden and only the trigger shows; (2) the EXPLICIT PRESS opens both panels (found AND scan, each asserted), hides the trigger, and moves keyboard focus into the opened panel (`document.activeElement` lands on `#found-toggle`, not `<body>`); (3) DISMISSED FOREVER (`body.dismissed`) does not re-offer the trigger, and after the trigger row vanishes focus falls back to the Agents tab rather than a stranded `<body>`; (4) EMPTY LOOK (found nothing, not dismissed) keeps the trigger shown as the re-look affordance and returns focus to the trigger button (the disable during the look blurred it); (5) ONLY SCAN VISIBLE (found empty, scan has a candidate) focuses the scan toggle, exercising the fall-through branch of the focus target; (6) TAB-SWITCH RACE holds both fetches on a gate, flips off the Agents tab mid-flight, then releases WITH A CANDIDATE, and asserts neither panel reappears off the Agents tab (the paints' post-await `onAgentsTab()` re-check, closing the #2025 "it appears everywhere" defect) and the post-await focus code does not yank focus back onto the tab the person just left. The load arm alone would pass on a page that never shows the panels at all, so the press arm is load-bearing. Controls, each traced and proven RED: removing the `DISCOVERY_OPENED` gate reds arm 1; a scan-only gate regression reds arm 2's `scanHidden` assertion; removing the focus move reds arm 2's `focusId` assertion; a wrongly-tracked `DISCOVERY_DISMISSED` reds arm 3; dropping the tab fallback reds arm 3's focus assertion and dropping the button refocus reds arm 4; dropping the scan-toggle branch reds arm 5; dropping the paints' post-await `onAgentsTab()` re-check reds arm 6's visibility assertion and dropping the focus-restore guard reds arm 6's focus assertion. The interactive fetches carry a feature-guarded `AbortSignal.timeout(8000)` (guarded for Safari <16, where it throws synchronously) so a hung backend cannot strand the disabled button, and the poll/showTab/press paths run the two paints via `Promise.all` (concurrent, then sequence the trigger paint). The scan panel's `DISCOVERY_OPENED` gate also has a hermetic unit test in `web.found-board.test.js` (a `paintScan` harness plus its can-fail control). |
| `render-profile-field-widths-2697.js` | kosmos#2697 (Josh, design channel 2026-09-10, on the agent Profile tab): the three Profile fields (Name, What they do, Reports to) ran the full container width; Josh asked for Name ~25%, What they do ~50%, Reports to ~25%, each on its own row, plus spacing above "Reports to" and the long Name helper wrapped at ~50%. Hermetic (file://), unhides `#panel-detail` + `#d-sec-profile` + `#d-reports-wrap` and pins the panel to 1200px so the percentage widths clear the shared `min-width:220px` floor (which is left in place so a narrow panel does not crush the fields). Measures each field against its own `.frow`: Name ~25%, What they do ~50%, Reports to ~25% (with tolerance), What-they-do wider than the other two, `#d-reports-wrap` margin-top > 0, and the Name helper width at ~50% of the form. Controls, proven RED: reverting each `flex` back to `flex:1` reds that field's ratio and the 50/25/25 relationship; removing `#d-reports-wrap`'s margin-top reds the spacing assertion; removing the Name helper `max-width` reds the wrap assertion. Scoped to the detail-form ids, so no other form's fields change; a CSSOM scoping negative control asserts every 25%/50% narrowing rule targets only `#d-rename`/`#d-role`/`#d-reports` and no create-form id, so a future edit leaking the sizing to the create form reds even though that panel does not lay out while hidden. |
| `render-project-needsyou-2699.js` | kosmos#2699 (Josh, design channel 2026-09-10): on the project view a needs-you member "just says 'needs you' in text and doesn't show" - it sits in the same spot as Idle/Working and blends in. Josh asked for the little red triangle over the agent's icon and the status text in red. Hermetic (file://), calls the real `pjMember()` row builder for a `needs_you` member and an `idle` member, injects both, and reads computed DOM. Asserts: the needs-you row's `.pj-face .lwarn` triangle is present, is NOT `display:none` (the base `.lav .lwarn{display:none}` is overridden for `.pj-member .pj-face`), and its bounding box overlaps the avatar; the status `<small>` carries `pj-attn` and renders a distinct (red) color from the idle status; the row reads "Needs you". Negative arm: an idle member gets NEITHER the triangle NOR the red. Controls proven RED: dropping the `LROW_WARN` emit reds the triangle-present arm; leaving the base `display:none` (no show/position rule) reds the display + overlap arms; dropping `.pj-attn { color }` reds the distinct-color arm. |
| `render-consolidated-layouts.js` | The consolidated view under each Agents layout: no org chart over the rails, and an empty centre that says what to press (#774). |
| `render-consolidated-settings-2842.js` | Consolidated view: opening user settings from `#rail-me-go` stays in the consolidated view and takes over the display column (`#panel-settings` relocated into `#panel-projects`) instead of kicking back to the tab view (#2842), keeping the agents column and projects list; navigating to a project restores the project view, leaving the consolidated view restores settings to the top level, and the panel fills the column rather than centering. Both themes. |
| `render-rename-say.js` | What the agent page says after you rename an agent |
| `render-reload-toast.js` | The reload toast in both tones, beside the shipped offer toast it must not look like (#270) |
| `render-updates-stale.js` | Settings > Updates, pressed on a page that is older than the Kosmos running it (#691). |
| `render-update-win32-manual.js` | win32-update-check (updater slice S1): Settings > Updates on a Windows bundle before the in-app updater is armed. The update answers are stubbed at the network edge (`updateManual`/`updateChannel` on the poll, `manual`/`channel` on the check). It asserts the exact manual-offer sentence and a visible Download link to the exact versioned zip (described by that sentence), with the check button hidden and no channel tag. On staging, "Staging channel" shows and the link is the staged versioned zip. A could-not-read look names itself, and a press that cannot reach says so, never "Up to date.". The CONTROL: nothing newer gives "Up to date." with no link. |
| `render-special-purpose.js` | **no header sentence.** Read it before running it, and give it one. |
| `render-talk-search.js` | The search box above the agent thread: filter by text and by who, the no-match sentence, reset on switching agent |
| `render-talk.js` | A REAL agent card, from the real producer |
| `render-agent-msg-gray-2805.js` | kosmos#2805 (Josh): an AGENT message in the DM view wears a very light gray (`--k-sunk`) bubble; the person's own message keeps the royal-blue wash. Hermetic (file://), renders an agent row beside a person row and asserts, in light and dark, that the agent bubble is filled (not the transparent #2660 state), is distinct from the person's blue, reads against the DM panel (did not dissolve into the surface), and is a neutral gray. Asserts the RELATIONSHIP, not a literal rgba, so a retune of the gray stays green. |
| `render-room-msgbox-2806.js` | kosmos#2806 (Josh, asks 1+2): in the project ROOM the person's OWN message body wears a light royal-blue box (`--usermsg-tint`) and an AGENT's wears a light gray box (`--k-sunk`), via a `.msg-bd` wrapper around the message body (the room's `.msg-b` class had neither color; #2805 only reached the DM's `.dm-b`). Hermetic (file://), renders real `pjRoomRow` output for an operator row, an agent row, and a bodyless row, and asserts in light and dark that the operator box is filled and blue, the agent box is filled and a neutral gray, the two are distinct, and a bodyless row draws a `.msg` row but NO `.msg-bd`. Asserts the RELATIONSHIP, not a literal rgba. |
| `render-tasks.js` | Drive-through of the tasks column: creating and viewing are both PAGES (#206, then #383) with no trap and Escape inert, the typed draft survives Back, the who chip is the status, the door reveals what the column hides. Fixture tmux only. |
| `render-memory-controls.js` | The Memory tab's three controls (#214): Compact, Clear, Restart together, the chooser sentence, Compact's dialog and verdict. |
| `render-model-change.js` | The Model section (#386) and the #1373 OpenAI sign-in picker: the rows offered, the preselect, and the arm that hides it again. #1484 adds the two dialog arms a two-account fixture can never reach: one sign-in (the row is sent, nothing to choose) and none (the switch will stop), each read from the rendered confirm sentence after removing a fixture home and reloading. Seals all three homes and stubs the models endpoint, so no real key is involved; see the check's own header for why. |
| `render-model-restart-interstitial.js` | kosmos#768-batch (Josh 0.6.47, 5.51.59): switching an agent's model shows a RESTART INTERSTITIAL -- the breathing Kosmos K over "Restarting the agent" -- held while the agent restarts, then the confirm dialog reduces to "Say hello to <agent> to reactivate them on <provider>." HERMETIC (file://, no server). Drives the shared changeDialog directly: `busyHtml`+`minBusyMs` paint the interstitial (button + small text hidden -> clean interstitial, no modal exit), HOLD it on success then render the sentence, render a FAILURE at once (success-only hold, so the modal never traps #1313), and leave a no-`busyHtml` caller byte-unchanged on plain "Working…" with the small text still shown (CONTROL). Then drives the real #d-model-go flow (stubbed POST, CURRENT set, hold shortened via `window.__kosmosRestartHoldMs`): the dialog shows the K "Restarting the agent" then reduces to "Say hello to <agent> to reactivate them on <provider>." A source control pins the prod hold at RESTART_HOLD_MS=10000. chromium. |
| `render-restart-kloader-2831.js` | kosmos#2831 (Josh 0.6.57 review): the explicit restart-from-here (`rst-go` confirm) now plays the branded K-into-circle loader too -- the same `RESTART_BUSY_HTML` + `startKLoader` interstitial the model/provider change shows -- held on the shared `RESTART_HOLD_MS` floor, then hands off to the existing #2686 auto-hello receipt. HERMETIC (file://, fetch stubbed). Drives the real `rst-go` handler and asserts: on success the loader canvas mounts in the restart dialog and ACTUALLY PAINTS with the confirm content hidden, nothing is claimed while it holds, exactly one auto-hello POSTs, the modal closes and the canvas is DETACHED afterwards (no rAF leak), and the receipt reaches the placed line WITH the say-hello nudge; on a REFUSED restart the failure line shows well under a long hold (no hold on failure), the loader is torn down, the controls are restored, and no false receipt is written. Source controls pin that the interstitial is wired on this path and the hold is the shared floor. `window.__kosmosRestartHoldMs` shortens the hold. chromium. |
| `render-pjadd-back-2850.js` | kosmos#2850 item 1 (Josh 0.6.57 consolidated review): adding a project FROM the consolidated view, the "back / All projects" control on the New project form is redundant, so it is hidden there with `visibility:hidden` (scoped to `body.consolidated`) while its box keeps reserving its space so New project does not move up. HERMETIC (file://). Drives the real `openAddProject` in both layouts and asserts: in the TAB view the back button stays visible with height; in the consolidated view it computes `visibility:hidden` yet still reserves height (`display:none` would be 0) with the New project heading sitting below the reserved box; and the hide is CSS-driven, not an inline style. chromium. |
| `render-reassign-restart-2829.js` | kosmos#2829 (Josh 0.6.57 review): after a rename or a report-to/assignment save that needs a restart to take effect, the passive "takes effect when it next starts" notice is replaced by popping the restart modal (a saved variant of `openRestartModal`) so the person can restart right there; on restart the shared `rst-go` flow plays the K loader and auto-sends a hello (owned by render-restart-kloader-2831 / render-autohello-2686). HERMETIC (file://). Drives the real `popRestartAfterSave` and asserts: the modal opens with the saved title ("Saved. Restart X to use it now?") and a saved-context lead, a single `rst-go`-wired "Restart now" fallback (`data-restart-agent` + `data-restart-note=d-role-msg`) is left in the role message line, popping again reuses that button rather than duplicating it, and the ordinary explicit-restart title ("Restart X?") is unchanged. chromium. |
| `render-github-door.js` | The GitHub door on the Connections tab (#529), driven in a real browser: absent gh is the |
| `render-accounts-openai.js` | An OpenAI account added from the Accounts page with a pasted key, listed by provider and offered on the create form (#540); driven against a stand-in codex so no real key is involved. |
| `render-org-drag.js` | The org chart's organic layer (#285): grab the hub, the rings follow, wires stay attached, a drag does not open an agent and a click does. |
| `render-switch-states.js` | The four Settings switches come BACK once their settings read (#229) |
| `render-optout-403-2020.js` | The privacy opt-out switch (feedback-toggle) is 403-safe: a gated read draws could-not-read, never a false Off (#2047). The two telemetry opt-outs it also covered (tell/notify) were deleted in #2623. |
| `render-settings-403-2047.js` | The auto-update, engineering-mode and run-limits switches are 403-safe: a gated read draws could-not-read (hidden, no position, a message), never a false Off -- with a 200 control (#2047) |
| `render-theme-toggle.js` | The light and dark control: two options, gold active, same geometry as the view toggle (#284) |
| `render-thread.js` | Render and DRIVE the project thread in a real browser |
| `render-url-state.js` | The view survives a refresh (#374): agent, project, task; and the overview writes a clean URL. |
| `render-update-toast.js` | **no header sentence.** Read it before running it, and give it one. |
| `render-viewtoggle-header-2154.js` | The board-view toggle (#2154): one press flips tabs <-> consolidated, it persists through /api/style, it lives in the header in every view (since #2282's persistent full-width header; the rail copy is hidden in consolidated), and it is hidden below 960px. After #2194 it sits to the right of the light/dark switcher in the header. |
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
  "$SB/data/Kosmos/first-run.json"
```

⚠️ **Sandbox the roots — all FOUR of them.** `click-first-run.js` drives the
real completion flag through the real route. Run unsandboxed and it writes to
`~/Library/Application Support/Kosmos/`, which is the flag the live
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
mkdir -p "$SB/data/Kosmos"
echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/Kosmos/first-run.json"
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

## `render-plus-blue-1615.js`

kosmos#1615: the Kosmos Plus tab's whole-app blue skin. While the tab is on
screen the app takes the first-step blue ground via `body.plus-active` (a
body-level token override that beats the theme cascade by inheritance), and the
two first-step canvases (`#plus-stars`, `#plus-mark`) mount. The half a source
read cannot see is the LEAVE: `syncPlusChrome()` must un-blue and tear the
canvases down the moment you leave the section OR the tab, so nothing paints
behind another screen and no rAF burns off-screen. The check drives the real
page — enter Plus, leave to another Settings section, re-enter, leave to the
Agents tab — and asserts the computed `body` background is the blue on enter and
is NOT blue on either leave, that `plusMounted` is true on enter and false on
leave, and that both canvases are sized. Runs in light, dark and reduced-motion.
Reds on origin/main, where none of `body.plus-active` / the canvases /
`syncPlusChrome` exist. Chromium (the assertion is computed style + class
toggles, engine-agnostic; both schemes are the coverage that matters here).
- render-remove-force-2651.js -- #2651: the untied-remove override affordance (clear an untied card without stopping its session).
