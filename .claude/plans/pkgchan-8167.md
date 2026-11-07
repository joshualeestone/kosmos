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
