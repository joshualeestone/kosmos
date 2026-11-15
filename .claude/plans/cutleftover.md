# cutleftover: an aborted cut's never-served files no longer stop the next cut of that version (kosmos#8562)

From Splinter 11-15 13:34 after the 0.8.05 Mac+Linux cut refused at step 4b (Baron's reasoning on #8527, 13:33).
Merge only after Baron lifts the current kosmos merge hold.

## Cause (measured in release.sh)
The versioned files (dist/kosmos-<V>-arm64.*, -linux-x64.*) are gitignored in the site checkout. The EXIT trap's
release_site_restore removes them only when this cut wrote them AND had not reached its deploy (`[ "$DEPLOYED" = 1 ]
|| release_site_restore`). The 11-13 attempt died at its deploy (vercel exited with no deployment), so its files
stayed, and today's cut refused at 4b, about two hours in.

## Call
New step 1g (tools/lib/release-leftovers.sh, release_leftovers_clear), before anything is built and before the trap
reads _pair_had: for each family with untracked dist/kosmos-<V>-<family>.* files, ask the served host.
- The version's own .sha256 answers a checksum: served. Refuse, "bump the version" (the existing rule).
- It answers like a made-up version (negative control) while the prod pointer's own version answers a checksum
  (positive control): never served. Move the files into ONE dated folder beside the site checkout
  (`<site>.aborted-<V>-<UTC stamp>`), outside git, nothing deleted.
- Anything else (host down, a control that fails): refuse as unknown, with the exact way forward.
Committed files of that version (a served release's manifest) are never touched.

Rejected: deleting the leftovers (no undo; Baron moved them by hand for the same reason); moving them inside dist/
(git status would show them and later clean-tree checks refuse); treating a 200 as served (the site answers 200 with
its HTML page for any name, measured today by Baron and by me).

Weakest premise: "never served" is read at the host the cut deploys to (HOST, default installkosmos.com). A
deployment never aliased there is unreachable by these URLs too, which is the same reasoning Baron used, and its
bytes cannot be in the edge cache this rule protects.

## Also
- docs/releasing.md's failed-cut checklist said a 200 on the tarball URL means served: false on this host (any name
  answers 200). Rewritten to read the .sha256 body against a control, and to name step 1g.
- tools/test-setup-staging-5032.sh extracted step 1f up to step 2; it now ends at the next step marker (1g sits
  between). Still passes on main's release.sh.

## Tests
- tools/test-release-leftovers-8562.sh (13 arms, registered in package.json test:shell): none, never served (both
  families, one folder, bytes kept, committed file kept, site clean, the three URLs read), served, host down,
  positive control failing, negative control failing, a served family refused per family, and release.sh's call
  order and stop. Mutations of each control, the served check and the tracked-file skip each red their arm.
- Every test that reads release.sh or test:shell: node 246 pass; 46 shell tests pass after the 5032 fix.
