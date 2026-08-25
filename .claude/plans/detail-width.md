# Plan: detail-width

Two width fixes Josh raised live while testing the shipped app this
morning (2026-08-25), in #chaoskosmos-design.

## 1. Agent detail page width (10:07 CDT)

Josh: "Can we make the width of the viewing agent the same as we did on
the settings stuff so it's not just this gigantically wide view and it
could all kind of fit centered like we're doing with the updated settings
pages? That seems like a real quick thing we could roll into an update
and push out."

Investigation: `#panel-detail` (class `.detail`) shares `.dbody`/`.snav`/
`.dsec` with Settings by design (the markup comment above Settings' own
nav says so explicitly). Settings got a width cap in #770 (`176px 34rem`,
centred, with a 60rem fallback); `#panel-detail` never did, so it was
still on the base `.dbody` rule's fluid `minmax(0, 1fr)` column.

- [x] Combined `#panel-settings .dbody` and `#panel-detail .dbody` into
      one selector at all three specificity tiers (base, 60rem, 56rem
      restatement) rather than duplicating the rule, so the two pages
      cannot drift apart on this again.
- [x] `.dhead` (the avatar/name header) is a SIBLING of `.dbody`, not a
      child, so capping `.dbody` alone would leave the header spanning
      the full window while the grid below it centres to 746px. Capped
      to the same total width, with the same 60rem relaxation.

## 2. Project page header merge in tab view (10:12 CDT)

Josh: "there are still some styling changes that I'd mentioned
specifically on viewing a project that didn't get implemented yet, like:
Moving the title and description to where the conversation title is /
Moving all the page contents up, is that card still open or did it get
closed out?"

Investigation: #520 piece nine merged the project title into the
conversation header for the CONSOLIDATED layout only. #761 named this as
an explicit open question ("check after the cut whether he wants the
same in the tab view") rather than closing it out. Josh's message above
is the yes.

- [x] `placeProjectHead()` no longer branches on layout -- it always
      merges `.pjhead` into `.pjmidhead`, in every layout, once, and
      stays merged (idempotent on repeat calls).
- [x] New unscoped CSS rules give the tab view the same merged shape
      (title beside search, "Conversation" label hidden, one rule
      beneath). Deliberately unscoped rather than duplicating the
      consolidated-scoped block: the existing `html[data-layout=
      "consolidated"] body.consolidated …` rules have higher specificity
      (an attribute selector plus a class on body) and keep winning
      inside consolidated exactly as before, so these new rules only
      have anything to style in the tab view.
- [x] Added a 60rem responsive breakpoint the consolidated version never
      needed, since consolidated is gated to windows >= 1280px and tab
      view is not -- title/search/description stack below 60rem, using
      the same breakpoint Settings/detail already use.
- [x] Title size in the tab-view merge matches consolidated's ACTUAL
      rendered size (1.25rem), not the 1rem the consolidated rule states
      but never wins (verified by hand: `#pj-one-view .dname`, an
      ID-scoped rule, beats the class-only 1rem attempt on specificity --
      a pre-existing latent redundancy, not something this change
      introduces or needs to fix).

## Verification

- [x] `node --test web.settings-width.test.js web.layout-picker.test.js`
      -- 17/17, including a full rewrite of the "piece nine" test (the
      old version pinned the now-deliberately-removed "move it back for
      tabs" behaviour) and a new test for the detail-page header width.
- [x] `npm test` (full suite) -- 0 failures, exit 0.
- [x] `bash tools/browser-checks.sh` (full suite) -- all page checks
      passed, run AFTER both edits were saved (an earlier run, started
      before the header-merge edit existed, produced a stale screenshot
      that looked like the fix had not taken effect; caught by direct
      Playwright reproduction against a live server before trusting it,
      see the pre-challenge proof for the full trace).
- [x] Direct Playwright verification beyond the unit tests: DOM inspection
      confirms `.pjhead.parentElement === .pjmidhead` and the
      "Conversation" label computes to `display: none` in tab view, at
      both 1280px and 700px viewport widths, with screenshots.
