# robust7b-2286: build the cut's site release commit on a freshly-fetched origin/main

kosmos#2286. Follow-up to #2276/#2278 (site-push-race hardening). Owner: Baron (cut owner).
Splinter authorized building it now (runway: launch cut is well out) and sequenced it: land #2286,
then cut an interim staging 0.6.37 to soak #2278 + #2286 in a real cut before the launch cut.

## Problem (both are #2278's accepted-interim limitations, both rooted in committing on shared LOCAL main)

1. **versions.html overlay** (rare, high-value): a concurrent merge that edits a release-owned path
   (realistically versions.html) is OVERLAID by the replay - our whole versions.html wins and the
   concurrent edit is lost from the served tree. Only overlapping edits to versions.html trigger it
   (page/design merges touch other files), so it is rare, but it silently loses content.
2. **local main diverges** (frequent, low-value-lost): a successful replay pushes a commit-tree commit
   to origin/main but does NOT move local main, so every LATER cut's first push is rejected and takes
   the slow replay path. Self-heals per cut; a slow path, not a correctness failure.

## Fix: make "build on freshly-fetched origin/main" the PRIMARY path (not #2278's fallback)

Replace 7b's "commit on shared local main -> push -> replay-on-reject" with a single loop that ALWAYS
builds the release commit on the freshly-fetched origin/main tip via a temp index + commit-tree, and
NEVER commits to or moves local main. This is exactly #2278's replay mechanism, promoted to primary.

- **Limitation 2 gone completely**: local main is never given a release commit, so it never diverges;
  every cut takes the same clean fetch+commit-tree+push path (retrying only on a genuine non-ff).
- **Limitation 1 gone**: for versions.html, RE-INSERT our new entry into the FRESH page instead of
  overlaying our whole file. Other release paths (dist pointer, manifest, setup, setup.sha256) are
  cut-generated and cut-owned, so overlaying our version stays correct.

### Behavior change to document (more correct, but a change)
Today 7b's push also carries any unpushed commits sitting on the shared local main ("the deploy would
serve them regardless"). Building on fresh origin/main means the cut serves exactly origin/main +
the named release files, and NO LONGER sweeps up unpushed local page work. That is the safer behavior
(a cut should not carry random unpushed commits; that is the same class as `commit -a`), but it is a
change - call it out in the 7b header and the site-push.sh header.

## Pieces

1. **tools/reinsert-versions-entry.js** (new, node, small + unit-testable): args = base versions.html
   path (fresh), our versions.html path (with our entry), version V. Extracts our entry block
   (`    <article class="rel" id="v<dashed-V>">` .. its matching `    </article>`) from our file, and
   inserts it above the first `    <article class="rel" id="v` in the base file (reusing the
   insert-release-entry.js anchor). Prints merged HTML to stdout. Refuses (nonzero) if our entry is
   missing, if the base has no anchor, or if the entry already exists in the base (idempotence guard).

2. **tools/lib/site-push.sh**: replace site_push_with_replay's guts (keep the name + signature-ish so
   release.sh's call site changes minimally, OR add site_commit_on_fresh_main and repoint 7b). The new
   loop: fetch origin/main -> new_base; temp index read-tree new_base; for each non-versions release
   path, stage the WORKING-TREE blob (hash-object -w) via update-index --cacheinfo; for versions.html,
   run reinsert-versions-entry.js against new_base:versions.html + working-tree versions.html, hash the
   result, stage it; write-tree; commit-tree -p new_base; push; on non-ff retry (bounded); on any
   other failure abort with git's error; never touch the working tree or real index or local main.

3. **tools/release.sh 7b**: drop the `git add`/`git commit -- $_site_paths` on local main; call the new
   function which reads the release files from the working tree. Keep the on-main guard (the SITE
   checkout must be on main - it is the source of the working-tree release files). Step 8 already uses
   the returned SITE_SHA, so nothing downstream needs local main to have moved.

4. **tools/test-site-push-race-2276.sh** (extend) or a new test-robust7b-2286.sh:
   - Existing page-merge-survives case (keep).
   - NEW: concurrent merge ADDS a versions.html entry AND our cut adds a different entry -> assert
     BOTH entries present on origin/main exactly once (re-insert, not overlay). RED-CAPABLE: an overlay
     implementation loses the concurrent entry.
   - NEW: after a successful clean push (no race), assert local main was NOT moved/diverged (rev-parse
     local main == its pre-cut value). RED-CAPABLE: the old commit-on-local-main path moves it.
   - NEW (unit): reinsert-versions-entry.js extract+insert correctness + idempotence refusal.
   - Wire into test:shell; run the meta-guards (every-test-runs, zsh-tied-names) + em-dash-guard
     before pushing (memory feedback-run-full-suite-before-pushing-a-new-test).

## Validation ceiling (stated for the record)
Hermetic tests prove the LOGIC. Behavior under a real concurrent cut is only proven in a real cut -
that is what the interim 0.6.37 staging cut is for (Splinter's sequence). Land, then cut interim.

## Traps
- release.sh runs under bash but the Bash tool runs zsh; test scripts have their own shebang - run
  each under its shebang, not at the zsh prompt.
- reindex_dir must be absolute (git resolves a relative GIT_INDEX_FILE against -C dir). Keep that guard.
- LC_ALL=C on the push so the non-ff discrimination grep stays locale-independent (keep it).
- Named paths only; never add -A / never touch the shared working tree or real index.
- No em dashes anywhere (Josh's rule).
