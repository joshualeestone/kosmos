# pkgmarker-8132: the .pkg presence marker names a sentence that ships (kosmos#8132)

## Why
tools/served-markers.json had pkg_present "This page becomes your dashboard when Kosmos is ready." No file has had it
since #2073 (the page no longer becomes the dashboard; the native app is). So that row of tools/check-served.js failed
on every build. Measured 11-06 against served 0.7.94: every other row passes; this is the one wrong marker.

## What
- pkg_present is now the installing page's static hint, the first thing a person reads there:
  "This page shows install progress. Kosmos opens in its own app when it is ready." (install/pkg-scripts/
  installing.html). Mona Lisa's open #8134 keeps it as is; she will change the marker in the same PR if she rewords it.
- tools.served-markers-sources-8132.test.js: every present and order marker must be in web/index.html, and every
  pkg_present marker in one of the three pages the installer serves (installing.html, pkg-resources/welcome.html,
  pkg-resources/conclusion.html). It also holds check-served.js to reading those three pages, has floors on every source,
  and a control that a made-up marker and the old dead sentence are not found.
- binary is NOT checked against source: "runOpenPanel" is a selector in the compiled app that no source spells (it
  passes against the served binary). The absent kinds have no source by design.
- "30KB" removed from check-served.js and _pkg_note: the served pkg is 104,719 bytes, and #8134 adds more.

## Measured
- Guard: 4/4 on this branch; on main's markers it fails, naming the dead sentence.
- Served, real: check-served.js with the new marker against installkosmos.com: rc 0, the pkg row ok [installing.html].
- Served, negative: a re-flattened copy of the served pkg with that sentence cut, behind a local mirror: the row FAILs
  (rc 1), and the same harness passes the real served pkg (rc 0). The harness is a scratch copy of check-served.js
  using node:http for the local mirror (check-served refuses http); nothing else differs.
- Every other marker checked first: all present, order and binary rows pass against served 0.7.94; nothing else dead.

## Who runs check-served.js (the card asked)
Nobody automatically: no caller in this repo (only comments, plans and the README), in the fleet tools, ~/.claude/bin,
~/.local/bin or the LaunchAgents. It is a hand-run tool, so anyone who ran it since #2073 got this red row every time.

## Review 1 (sonnet)
- WARNING, fixed: the guard read raw sources, so a marker that survived only inside a comment would pass it (and the
  served check) for the wrong reason. Sources are now matched with comments stripped (check-served.js's own strip),
  with a floor on the strip and a control: "Nothing to do." is in installing.html only inside its deletion comment and
  must not count. Disabling the strip turns that control red. Every current marker survives the strip.
- NIT, fixed: the header says order markers are checked for presence only (web.ruling-guards.test.js holds the order).
- NIT, noted: the served index.html is the source file unchanged; build-installer-pkg.sh rewrites none of the three
  pages; the served runs above cover the new marker.

## Review 2 (opus): NITs only (converged), taken with one more round because one was a false statement in this file
- _cannot_see said the .pkg installer page is outside check-served's population and 'Nothing to do.' cannot be guarded.
  False since the pkg arm (it reads all three pages and guards item 4). Rewritten to say where they are read.
- The guard compares check-served's whole PAGES list, not three substrings, so an added fourth page turns it red.
- The header says the guard is deliberately stricter than the served check (stripped vs raw), and that the strip can
  only over-strip (a false red, never a false green).
- A commented-only control for web/index.html too ("Two questions: what it is for").

## Review 3 (sonnet): NITs only, taken with one more round
- _cannot_see names the kinds the guard covers (present, order, pkg_present); binary is checked against the app only.
- The guard's strip is a copy of check-served.js's (a local there); a new assertion holds the two to one text, and a
  one-character change turns it red.
- Noted, not changed: the marker is the #hint line, which the page hides once install finishes; the bytes still ship,
  so the row is a presence check (text shipped), not a behaviour check.
- Same stale claim found in web.ruling-guards.test.js (a comment saying the installer page cannot be guarded at ship
  time); corrected to name the pkg arm. No assertion changed; that file passes 6/6.

## Review 4 (opus)
- WARNING, fixed (my round-3 prose): "IT IS GUARDED AT SHIP TIME" overclaimed: nothing runs check-served.js
  automatically. The comment is now pointers only: the merge-time pin in install.installing-page.test.js, and the
  pkg_absent row when check-served is run by hand. _cannot_see says "checked ... when it is run (by hand)" too.
- WARNING, fixed: install.installing-page.test.js carried a third copy of the stale claim ("outside the served
  population ... still is"); corrected. A repo-wide search finds no other copy (the one left in check-served.js quotes
  it as the mistake it was).
- NITs, fixed: the header names the pkg arm's strip; the guard holds build-installer-pkg.sh to the two source folders;
  the old-sentence control says what its failure would really mean; the edit note in check-served.js is gone.
30 passed across the three affected test files.
