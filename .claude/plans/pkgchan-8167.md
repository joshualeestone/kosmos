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
