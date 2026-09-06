# installing-taken-2363: remove the vestigial browser link from installing.html's taken branch

## The problem (#2363)
`install/pkg-scripts/installing.html` has a "taken" branch for the port-collision case
(something already answering on the address Kosmos uses - "often THEIRS, not yours" on a
shared Mac). That branch offered a manual browser link (a bare-URL anchor to base+"/",
`#go`, set at runtime). Under #2073 (Kosmos is app-only, no browser surface), that link
is vestigial: clicking it lands cookie-less on a 403/empty board, or on the FOREIGN
board the copy itself calls "often THEIRS, not yours" - either way not the user's
dashboard, which is the native app. Surfaced while closing #2033 (subsumed by #2073).

## The change
- **installing.html**: remove the `<a class="go" id="go">` link from the taken-branch
  markup, and the JS line that pointed it at `base + "/"`. The muted line already
  points at the app ("Your own copy of Kosmos is in Applications") and gives the
  safe-backout, so the branch stays complete with no copy rewrite. `#go` was used only
  in this branch (verified), so removal is clean.
- **install.installing-page.test.js**: the test previously REQUIRED the link present
  (the pre-#2073 design). Rewrote that assertion to require it GONE (no "Open it
  anyway", no `id="go"`, no `getElementById("go").href = base + "/"`) while keeping the
  standing safety guard (the taken branch never auto-navigates / `location.replace`),
  and the Applications-pointer + "often THEIRS" honesty guards unchanged.

## Decisions
- **Remove the link, do NOT rewrite the copy.** The minimal fix: the muted line already
  points at the app and gives safe-backout, so removing the dead link leaves the branch
  complete. Rejected a copy rewrite (rippled into three copy guards for no gain).
- **Applies #2073's ruling, does not contradict a Josh ruling.** #2073 established the
  app is the dashboard and this page must not send anyone onto a board; the vestigial
  link was the last affordance doing so on the taken branch.
- **The explaining comments do NOT quote the old link text.** The install-page guard
  greps this file to prove the link is gone; a comment quoting "Open it anyway" would
  trip the doesNotMatch guard (learned the same lesson on the reason-grep catch comment).

## Weakest premise
No browser-check exercises installing.html (it is a standalone LaunchAgent-opened page,
not in web/, so the #1720 gate does not apply); coverage is the source guard
install.installing-page.test.js, which I updated. If a real port-collision fresh install
needs the taken branch to offer SOMETHING actionable beyond "open the app in
Applications", that is a copy decision for Mona/Josh - but under app-only there is no
safe browser board to link, so pointing at the app is the honest floor.
