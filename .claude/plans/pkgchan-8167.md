# pkgchan-8167: a staging cut publishes Kosmos-staging.pkg, and promote copies it to Kosmos.pkg

Card: kosmos#8167. The sibling of #5032, which did this for `/setup` and left the pkg out.

## The defect (measured 2026-11-06)

Step 3c rebuilds the installer pkg when its inputs change and copies the triple into the site's
`dist/Kosmos.pkg`, whatever the channel. `/dist/Kosmos.pkg` is the one URL the public Download
button links, so the 0.7.95 STAGING cut put 0.7.95's install page (#8134) in front of every new
install before any promote. Josh's word is needed for each version that goes to prod.

## The change

The pkg name now follows the channel:

| cut | publishes | leaves alone |
|---|---|---|
| staging | `dist/Kosmos-staging.pkg` (+ `.sha256`, `.inputs`) | `dist/Kosmos.pkg` triple |
| prod | `dist/Kosmos.pkg` triple AND `dist/Kosmos-staging.pkg` triple | nothing |

A prod cut writes both so staging is never older than prod.

The bytes are the same file under either name: the same build, the same signature and the same
notarisation. The postinstall still runs the prod `/setup`, as it always has. Only the `.sha256`
differs, because it names its own file (`<sha>  Kosmos-staging.pkg`), so `shasum -c` and 9e's
"names the file it describes" hold for each. `promote-channel.sh` copies the staging triple onto
the prod names, rewrites the `.sha256` name, and checks the bytes, so a promote stays a copy with
no re-sign and no re-notarise.

Pieces:
1. `tools/lib/pkg-inputs.sh`: `pkg_publish_needed` takes the pkg name (default `Kosmos.pkg`, so
   existing callers are unchanged). New `pkg_triple_copy <src-dir> <src-name> <dst-dir> <dst-name>`
   copies a triple, writes the `.sha256` under the destination name, and refuses unless the
   copied bytes still match the sidecar's vouch.
2. `tools/release.sh` 3c: decides and publishes per name by `CUT_CHANNEL`.
3. `tools/release.sh` 9c: checks each published name on the wire against the source inputs. On a
   staging cut it also checks that the served prod `Kosmos.pkg` is the export's copy (unchanged).
4. `tools/lib/site-deploy.sh`: carries each triple present, all three files or none, per name.
5. `tools/promote-channel.sh`: when a staging triple is present and its inputs differ from the
   prod triple's, copies it to the prod names before the deploy.
6. `tools/verify-served.sh`: checks the staging pkg pair when it is served.
7. The site repo, separately: a `vercel.json` download header for the new name, then an hourly
   row in `tools/check-served-sidecars.sh`, added only after a staging pkg is actually served
   (a row for a 404 reds every hour).

## Rejected

- Versioned pkg names: the Download button would need a pointer, the #2008 trap.
- Skipping 3c on staging: a staging cut could then never test an installer change.
- Calling the pkg unchanneled in a note: it leaves Josh's per-version rule broken for installers.

## Tonight

No change to the live pkg (Splinter, 21:34). This branch changes what the NEXT cut does.

## Review round 1

- BLOCKER, fixed: on a staging cut the export carries whatever `Kosmos.pkg` the site dist holds, so a leftover
  (for example from a prod cut that aborted after 3c) would have shipped to the Download button while 9c, which
  compared the served copy with the export, passed. 3c now reads the served `Kosmos.pkg.sha256` first (a 200 is
  required) and, if the site dist copy is missing or differs, puts the served triple back. 9c then holds the
  served `Kosmos.pkg` to that pre-cut sha as well as to the export.
- deploy-site.sh: only a 404 means "no staging pkg served"; any other non-200 refuses. A `--promote` that drops a
  local `Kosmos.pkg` which is neither served file says so with a WARNING.
- `check-served.js` gains `--pkg Kosmos-staging.pkg` so installer markers can be checked on staging. Its value is
  checked at start.
- `docs/staging-channel.md` describes the staging pkg and the promote copy.

Deferred, with reasons:
- The site's `.vercelignore`: measured against origin/main with `pkg_upload_filter_excludes`, it excludes neither
  name (a `dist/*.pkg` control shows the check can see an exclusion). No site change is needed for the upload.
- `serve-watch.js` and the site's hourly served-sidecar row: both would alarm on a staging pkg that is not served
  yet. Added after the first staging cut under this change has published one.
- A named promote that follows an un-named promote which was never deployed: the local `Kosmos.pkg` is then the
  staging pkg, and deploy-site keeps it because it is the served staging pkg's bytes. It needs two promotes with
  no deploy between them, and the result is an installer that staging serves and a cut has checked.

## Review round 2

- WARNING, fixed (raised in both rounds): promote copied the working tree's `Kosmos-staging.pkg` whatever the host
  served. It now copies only when that pkg's sha is the served `Kosmos-staging.pkg.sha256` (from `KOSMOS_SITE_URL`,
  default installkosmos.com). Otherwise it leaves `Kosmos.pkg` and prints a WARNING, and the pointer still
  promotes. The tests serve the staging `.sha256` from a stand-in host.
- WARNING, fixed: a staging cut's 3c now warns when the `Kosmos.pkg` it replaces is a copy of the local staging pkg
  (a promote's copy that was never deployed).
- NIT, fixed: the export warns when it carries the staging pkg without `Kosmos.pkg`.
- WARNING, deferred: verify-served checks `Kosmos.pkg` whole, signed and stapled, but not against the source, while
  a staging pkg is served. Between a staging cut and its promote the prod pkg is meant to lag, and nothing records
  which pkg prod should have. Requiring it to equal the staging pkg or the source would red every staging round.
  Recording the pkg sha in the prod pointer (as #5032 records `setup_sha256`) would make it checkable, as a
  follow-up.
- NIT, deferred: a hard kill inside `pkg_triple_copy` can leave a `.pkgcopy.*` temp dir in the site dist. The
  export carries named files only, so it never ships.

## Review round 3

- WARNING, fixed: the staging-cut guard ran after the deploy (9c) and at 3c, but not on what actually deploys. The
  site checkout is shared, so a promote or a hand copy between 3c and the export could change `dist/Kosmos.pkg`, and
  the cut would ship it before 9c saw it. Right after `site_deploy_export`, a staging cut now refuses unless the
  export's `Kosmos.pkg` is a whole triple whose sha is the pre-cut served one. That also covers the second warning
  (an export carrying only the staging pkg: no whole `Kosmos.pkg`, refused).
- NITs, fixed: verify-served's probe tells a 404 from a failure and its comment says the prod pkg's inputs are not
  checked; 9c's temp-dir failure names its cause; the promote refusal says how to recover; the doc bullet order and
  the doc's account of what promote checks; two more deploy-site arms (an unreachable probe refuses; the control
  asserts the new WARNING).

## Review round 4

- WARNING, fixed: a broken local staging triple no longer refuses the whole promote. The pointer promote does not
  depend on it, so the installer is left as it is with a WARNING and the pointer promotes.
- WARNING, fixed: every new probe in deploy-site.sh and verify-served.sh has `-m 30`.
- NITs, fixed: 3c requires a whole 64-character hex sha from the served `.sha256`; `pkg_triple_copy` clears a killed
  earlier copy's `.pkgcopy.*` dir before it starts.
- The verify-served point (the prod pkg is not held to anything while a staging pkg is served) was raised in rounds
  2, 3 and 4. It is not a wording problem, so the decision moved to its own card, kosmos#8172: record the pkg sha in
  the pointer, as #5032 records `setup_sha256`.
- Deferred: the three renames in `pkg_triple_copy` are separate. A crash between them leaves a mixed triple that
  `pkg_triple_check` and `pkg_publish_needed` both report as broken, so the next reader refuses rather than ships it.
