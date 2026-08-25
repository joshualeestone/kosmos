#!/bin/bash
# The tree a site deploy publishes: the COMMITTED site plus the release
# artifacts the release owns, by name, and nothing else (#649).
#
# ⚠️ WHY. release.sh deployed the shared site checkout's WORKING TREE, so a
# cut published whatever anybody had uncommitted there (a half-edited
# homepage, a stray file). It fired twice during the 0.5.22 cut and was
# caught by hand. And the gitignored release artifacts (tarballs, the pkg
# triple) reached production ONLY through that accident. This turns the
# accident into a decision: `git archive HEAD` for the pages, then each
# artifact class copied in by an explicit pattern, and a manifest that
# says what was carried and what was left behind. A file that is neither
# committed nor in a named class does not ship, whatever the working tree
# holds.
#
# What is carried, and why each is named:
#   dist/*.tar.gz + .sha256   the bundles: the current versioned pair (what
#                             installers prefer), the plain pair (older
#                             installers), the tmux pair, and every earlier
#                             versioned pair still on disk, because a
#                             latest.json read seconds before a deploy can
#                             still ask for the version it named. Pruning old
#                             versions is a separate decision, not this one.
#   dist/Kosmos.pkg, .sha256, .inputs   the installer package triple (#638)
#   .vercel/                  the project link the CLI deploys to
# Everything else comes from the commit.
#
# Two things a reader should know:
#   git archive honours export-ignore in .gitattributes / .git/info/attributes.
#   The site has neither today; one would drop committed files from the deploy
#   with no manifest entry (status is clean for committed files).
#   The Vercel CLI reads <cwd>/.git for a deployment's git metadata (commit,
#   author, dirty flag). The export has no .git, so the dashboard's Source
#   column is empty for these deploys; the manifest's "pages: commit" line
#   in the release log is the link from a deployment to its commit.
#
# Usage: source, then `site_deploy_export <site-checkout> <out-dir> [commit]`.
# The commit defaults to HEAD; the release passes the sha it pushed in 7b (read
# before the push, pushed by name),
# because the site checkout is shared and a commit can land between the push
# and the archive, and that one would ship unpushed.
# Prints a manifest; returns 0 on an export ready to deploy, 1 on a refusal
# (not a git checkout, no project link, archive failed, a partial pkg triple,
# the working tree could not be listed), never a partial tree that reads as
# ready.
_SITE_NL="$(printf '\nx')"; _SITE_NL="${_SITE_NL%x}"
_SITE_CARRIED=""
site_deploy_export() {
  local site="${1:?site_deploy_export needs the site checkout}" out="${2:?site_deploy_export needs an output dir}" want="${3:-HEAD}"
  local head f n bytes tarf
  git -C "$site" rev-parse --verify HEAD >/dev/null 2>&1 || { echo "site_deploy_export: $site is not a git checkout with a HEAD" >&2; return 1; }
  [ -f "$site/.vercel/project.json" ] || { echo "site_deploy_export: no .vercel/project.json in $site; the CLI would not know the project" >&2; return 1; }
  head="$(git -C "$site" rev-parse --verify "$want^{commit}" 2>/dev/null)" || { echo "site_deploy_export: $want is not a commit in $site" >&2; return 1; }
  mkdir -p "$out" || return 1
  [ -z "$(ls -A "$out")" ] || { echo "site_deploy_export: $out is not empty; refusing to export into it" >&2; return 1; }
  _SITE_CARRIED="$_SITE_NL"
  # The committed tree, exactly. git archive reads the commit, never the
  # working tree, so a half-edited page ships as it was committed.
  # ⚠️ ARCHIVED TO A FILE AND GIT'S OWN STATUS TESTED, not a pipe: in a caller
  # without pipefail, `git archive | tar -x` on a failing git gave tar an
  # empty stream, tar exited 0, and the export was an empty site that read
  # as ready (measured). This function's promise has to hold on its own.
  # ⚠️ EVERY REFUSAL FROM HERE ON REMOVES $out: a half-extracted export that
  # a caller could deploy is worse than none.
  # The temp archive sits BESIDE $out (under BUILD_ROOT in the release), not
  # in the shared TMPDIR: a stale one there from an interrupted cut made an
  # unrelated suite run red (measured).
  tarf="$(mktemp "$out.archive.XXXXXX")" || { rm -rf "$out"; return 1; }
  if ! git -C "$site" archive --format=tar "$head" > "$tarf"; then echo "site_deploy_export: git archive of $head failed" >&2; rm -f "$tarf"; rm -rf "$out"; return 1; fi
  if ! tar -x -C "$out" -f "$tarf"; then echo "site_deploy_export: could not extract the archive of $head" >&2; rm -f "$tarf"; rm -rf "$out"; return 1; fi
  rm -f "$tarf"
  # The named artifact classes, from the working tree, because that is
  # where the release puts them and git does not carry them.
  mkdir -p "$out/dist" "$out/.vercel"
  # Hard links where the volume allows (the tarball set is ~940 MB and grows
  # ~50 MB a release; this Mac lost 5 GiB to one night of copies), cp otherwise.
  n=0; bytes=0
  for f in "$site"/dist/*.tar.gz "$site"/dist/*.tar.gz.sha256; do
    [ -f "$f" ] || continue
    _site_carry_allowed "$site" "dist/${f##*/}" || { rm -rf "$out"; return 1; }
    _site_carry "$f" "$out/dist/" || { rm -rf "$out"; return 1; }
    _SITE_CARRIED="${_SITE_CARRIED}dist/${f##*/}${_SITE_NL}"
    n=$((n+1)); bytes=$((bytes + $(wc -c < "$f" | tr -d ' ')))
  done
  echo "   carried: $n bundle files ($bytes bytes) from dist/*.tar.gz and .sha256 (top level of dist/ only)"
  # The pkg triple is one unit: a pkg without its checksum or its inputs
  # sidecar is what 9c reds on, ten minutes later. The release's 3c writes
  # all three before this runs; a partial set here means something else put
  # a pkg in the site dist, and that is a refusal, not a carry.
  if [ -f "$site/dist/Kosmos.pkg" ]; then
    for f in Kosmos.pkg.sha256 Kosmos.pkg.inputs; do
      [ -f "$site/dist/$f" ] || { echo "site_deploy_export: dist/Kosmos.pkg is present without dist/$f; the triple deploys whole or not at all. Inside a cut, 3c publishes all three before this runs; by hand, run the release or remove the orphan pair." >&2; rm -rf "$out"; return 1; }
    done
    # COPIED, not linked: 9c compares the served pkg to this copy after the
    # deploy, and a hard link would follow an in-place overwrite of the
    # shared dist (3c's own cp is one; a concurrent cut is another) and re-aim
    # 9c at bytes this cut never deployed (measured: link count 2, new bytes
    # on both). The triple is 21 KB; the link only earns its keep on the
    # tarball set, whose served copy 9b compares against the frozen tree.
    for f in Kosmos.pkg Kosmos.pkg.sha256 Kosmos.pkg.inputs; do
      _site_carry_allowed "$site" "dist/$f" || { rm -rf "$out"; return 1; }
      cp "$site/dist/$f" "$out/dist/" || { rm -rf "$out"; return 1; }; _SITE_CARRIED="${_SITE_CARRIED}dist/$f${_SITE_NL}"
    done
    echo "   carried: the pkg triple (Kosmos.pkg, .sha256, .inputs)"
  else
    echo "   carried: no pkg (dist/Kosmos.pkg is not in the site dist)"
  fi
  cp -R "$site/.vercel/." "$out/.vercel/" || { rm -rf "$out"; return 1; }
  echo "   carried: .vercel/ (project link)"
  echo "   pages:   commit $head"
  # What the working tree holds that this export does NOT ship, named, so a
  # person who expected a file to go live sees why it did not.
  _site_left_behind "$site" "$out" || { rm -rf "$out"; return 1; }
  return 0
}

_site_carry() {   # <file> <dir/>
  ln "$1" "$2" 2>/dev/null || cp "$1" "$2"
}
# May this working-tree file be carried? Two refusals, for every class:
#   tracked by git   a `git add -f` artifact would be overwritten by the
#                    working-tree copy and hidden from the manifest as carried
#                    (a modified tracked artifact shipping silently)
#   newline in name  the carried list is newline-delimited; such a name would
#                    split it and could hide another entry from the manifest
_site_carry_allowed() {   # <site> <relative-path>
  local site="$1" rel="$2"
  case "$rel" in *"$_SITE_NL"*) echo "site_deploy_export: $rel has a newline in its name; refusing to carry it" >&2; return 1;; esac
  if git -C "$site" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
    echo "site_deploy_export: $rel is tracked by git AND matches a carry pattern; the export would overwrite the committed copy with the working tree's. Untrack it or stop carrying it." >&2; return 1
  fi
  return 0
}

# Every working-tree entry that is not committed and was not CARRIED: modified,
# staged, deleted or untracked files, and ignored files the carry loop did not
# take. Keyed on what was actually carried (_SITE_CARRIED), not on the name
# patterns: an orphan Kosmos.pkg.sha256 with no pkg beside it, or a dotfile
# dist/.x.tar.gz the glob skips, matched the pattern and vanished from the
# manifest while not shipping (measured).
# node_modules, __pycache__ and *.pyc are skipped too: not a named class, but
# .vercelignore's exclusions, and listing them would bury the entries that
# matter. Renames print as "old -> new" as porcelain gives them.
# ⚠️ A FAILED LISTING IS A REFUSAL, and git's own reason is printed. An empty
# answer from a failing git status used to print "left behind: nothing", a
# positive clean-tree claim made from a tool failure.
_site_left_behind() {
  local site="${1:?}" out="${2:?}" line path kind any=0 listf errf oldname
  listf="$(mktemp "$out.status.XXXXXX")" || return 1
  errf="$(mktemp "$out.status-err.XXXXXX")" || { rm -f "$listf"; return 1; }
  # -z: NUL-delimited, NEVER quoted. Porcelain v1 without -z C-quotes a name
  # with a space (whatever core.quotePath says) and a non-ASCII name, so a
  # carried "x y.tar.gz" missed the carried list and was printed as left
  # behind while it shipped (measured).
  # ⚠️ WRITTEN TO A FILE AND GIT'S OWN STATUS TESTED, not piped through tr:
  # in a caller without pipefail, tr's 0 hid a failing git status and the
  # function printed "left behind: nothing" (measured). Same rule as the
  # archive above: the promise holds on its own.
  if ! git -C "$site" status --porcelain -z --ignored --untracked-files=all > "$listf" 2>"$errf"; then
    echo "site_deploy_export: could not list the working tree of $site (git status failed: $(tr '\n' ' ' < "$errf"))" >&2; rm -f "$listf" "$errf"; return 1
  fi
  rm -f "$errf"
  while IFS= read -r -d '' line; do
    [ -n "$line" ] || continue
    # porcelain: two status columns, a space, the path (the first column can
    # itself be a space, so this is a cut by position, not by word).
    kind="${line:0:2}"; path="${line:3}"
    # With -z a rename or copy is TWO records: "R  new" (index) or " R new"
    # (work tree, an intent-to-add), then the bare old name. The old name is consumed here, not re-parsed as a record (that
    # cut its first three characters off and printed a file that does not
    # exist, measured).
    oldname=""
    case "$kind" in R?|C?|?R|?C) IFS= read -r -d '' oldname || oldname="";; esac
    case "$_SITE_CARRIED" in *"${_SITE_NL}${path}${_SITE_NL}"*) continue;; esac
    case "$path" in
      .vercel/|.vercel/*) continue;;
      node_modules/*|node_modules|__pycache__/*|*.pyc) continue;;
    esac
    [ "$any" = 1 ] || { echo "   left behind (in the working tree, not in this deploy):"; any=1; }
    case "$kind" in
      '!!') echo "     ignored:   $path";;
      '??') echo "     untracked: $path";;
      A?)   echo "     staged, not committed: $path (does not deploy)";;
      R?|C?|?R|?C) echo "     renamed, not committed: $oldname -> $path (deploys as committed, under the old name)";;
      ?D|D?) echo "     deleted:   $path (deploys as committed)";;
      *)    echo "     modified:  $path (deploys as committed)";;
    esac
  done < "$listf"
  rm -f "$listf"
  [ "$any" = 1 ] || echo "   left behind: nothing (the working tree is the commit plus the named artifacts)"
  return 0
}
