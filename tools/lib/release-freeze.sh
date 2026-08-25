#!/bin/bash
# The tree a release tests is the tree it builds, by construction (#597).
#
# ⚠️ WHY THIS EXISTS. release.sh used to run every step in the shared main
# checkout, and that checkout is pulled by every agent on the Mac (auto-sync).
# On 2026-08-24 two cuts in a row were fast-forwarded mid-run: the suite and
# the page gate ran on one sha and the bundle that shipped was another, and
# only a byte diff of the SERVED bundle showed it. "Clean and on main" at
# step 1 is a fact about one instant.
#
# So the release freezes: a detached worktree at the bump sha, made by the
# release and removed by it, in which steps 3 through 6 run. A pull into the
# shared checkout from then on changes nothing the release tests or builds.
# And the served bundle is compared against that tree, so the log's "built
# <sha>" is measured rather than remembered.
#
# Usage: source this file.
#   build="$(release_freeze <repo> <sha> <root>)"   prints the worktree path
#   release_thaw <repo> <build>                     removes it
#   release_bundle_matches_tree <tarball> <tree> [<connector-sha>]
#       0 if every tree-derived file in the tarball (app/** and the top-level
#       bin/kosmos command) equals the tree's, web/index.html after the
#       version bake; the connector (app/bin/kosmos-tunnel, not a tree file) is
#       matched against <connector-sha> when given and must be PRESENT if it is;
#       and the other direction (#609): every file the tree and the app need
#       is in the tarball; prints each difference and each missing file;
#       2 when the expected set could not be derived
#   release_bundle_expected_files <tree>           prints that set, one per line

release_freeze() {
  local repo="$1" sha="$2" root="$3" build
  [ -n "$repo" ] && [ -n "$sha" ] && [ -n "$root" ] || { echo "release_freeze: repo, sha and root are required" >&2; return 1; }
  build="$root/kosmos-$sha"
  # git's chatter to stderr, never into the stdout this function returns.
  git -C "$repo" worktree add --detach -q "$build" "$sha" >&2 || return 1
  # ⚠️ Checked, not assumed: the worktree is AT the sha and carries nothing
  # else. A worktree that resolved the sha to something else, or picked up
  # untracked files, would put the whole class back with a reassuring path.
  # ⚠️ THE ADD SUCCEEDED, so a failed check below must remove the worktree it
  # made -- otherwise the shared checkout keeps a phantom registration in
  # .git/worktrees until git gc, and the caller's EXIT trap is not installed
  # until it has this function's return value.
  if [ "$(git -C "$build" rev-parse HEAD)" != "$sha" ]; then
    echo "release_freeze: $build is not at $sha" >&2; release_thaw "$repo" "$build"; return 1
  fi
  if [ -n "$(git -C "$build" status --porcelain)" ]; then
    echo "release_freeze: $build is not clean" >&2; release_thaw "$repo" "$build"; return 1
  fi
  printf '%s' "$build"
}

release_thaw() {
  local repo="$1" build="$2"
  [ -n "$build" ] && [ -d "$build" ] || return 0
  git -C "$repo" worktree remove --force "$build" 2>/dev/null || rm -rf "$build"
  git -C "$repo" worktree prune 2>/dev/null
}

# Where a bundle path comes from in the tree, when it is not the same path.
# ⚠️ ONE RELOCATION, AND IT IS STATED IN TWO PLACES: here and the `cp` in
# tools/build-kosmos-bundle.sh that performs it. Add a relocation there and
# not here and the next release refuses at step 9b with "not in the tree",
# which is the loud direction; the reverse (here and not there) cannot make
# a mismatch pass, because the file would then be missing from the bundle.
# Map a path AS IT SITS IN THE TARBALL to the tree file it was copied from.
# ⚠️ EACH RELOCATION IS STATED HERE AND AT THE `cp` IN build-kosmos-bundle.sh
# THAT PERFORMS IT. app/* mirrors the repo root; two files are relocated
# (bin/kosmos <- install/kosmos, app/bin/kosmos-report-hook.sh <-
# install/kosmos-report-hook.sh); everything else under app/ keeps its path
# with the app/ prefix stripped. Add a relocation there and not here and the
# next release refuses at step 9b with "not in the tree", the loud direction.
release_bundle_source_path() {
  case "$1" in
    bin/kosmos)                    printf '%s' "install/kosmos" ;;
    app/bin/kosmos-report-hook.sh) printf '%s' "install/kosmos-report-hook.sh" ;;
    app/*)                         printf '%s' "${1#app/}" ;;
    *)                             printf '%s' "$1" ;;
  esac
}

# The files the served bundle MUST carry, derived from the tree and from the
# app itself, never from the build script's hand-maintained list (#609): a
# list that duplicated the build's would drift with it, and the failure this
# closes is exactly a cp line dropped from that list. Five sources, each the
# thing that would break without the file:
#   the server's local require graph   a missing module crashes the board
#   every engine/*.js (not *.test.js)  the build copies the glob; a dropped
#                                      glob line drops them all
#   the files the engine resolves      path.join(__dirname, '..', 'bin', X):
#   under bin/ by path                 copied at every agent creation (#731:
#                                      a day of installs could not make one)
#   everything under web/              the build copies the tree; a dropped
#                                      cp -R drops the page
#   the pinned relocations             bin/kosmos (the command) and
#                                      app/bin/kosmos-report-hook.sh, whose
#                                      tree paths differ from their bundle
#                                      paths; app/assets/Kosmos.icns when the
#                                      tree has it
# Prints bundle-relative paths, one per line. Needs node for the require walk
# (the release machine has it; a tree with no server.js prints the rest).
release_bundle_expected_files() {
  local tree="$1" walk rc
  [ -d "$tree" ] || { echo "release_bundle_expected_files: no tree at $tree" >&2; return 2; }
  # A Kosmos tree has both; a tree without them would derive a set that is
  # nearly empty and pass a nearly empty bundle, so it is refused, not passed.
  [ -d "$tree/web" ] && [ -d "$tree/engine" ] || { echo "release_bundle_expected_files: $tree has no web/ or no engine/, so it is not a Kosmos tree and the expected set cannot be derived from it" >&2; return 2; }
  printf 'app/server.js\napp/package.json\nbin/kosmos\napp/bin/kosmos-report-hook.sh\n'
  [ -f "$tree/assets/Kosmos.icns" ] && printf 'app/assets/Kosmos.icns\n'
  ( cd "$tree" && [ -d web ] && find web -type f ! -name '.*' | sed 's|^|app/|' )
  ( cd "$tree" && [ -d engine ] && find engine -maxdepth 1 -name '*.js' ! -name '*.test.js' | sed 's|^|app/|' )
  # join( and resolve( both (reporthook.js resolves the hook with path.resolve).
  # The connector is resolved by path too (engine/remote.js) but is not a tree
  # file: the comparator's checksum argument owns it, so it is left out here.
  # app/bin/kosmos-app (#677) is excluded the same way, defensively: nothing
  # under engine/ resolves it today (install/setup.sh places it, not the
  # Node engine), so this exclusion is not load-bearing yet -- but if an
  # engine file ever did reference it this way, demanding it from the TREE
  # as well as verifying it by checksum would be an unresolvable
  # contradiction, the same one this line already prevents for the tunnel.
  ( cd "$tree" && find engine -maxdepth 1 -name '*.js' ! -name '*.test.js' -exec grep -hoE "(join|resolve)\(__dirname, *'\.\.', *'bin', *'[^']*'\)" {} + 2>/dev/null | sed "s/.*'bin', *'\([^']*\)').*/app\/bin\/\1/" | grep -vx -e 'app/bin/kosmos-tunnel' -e 'app/bin/kosmos-app' || true )
  # The require walk needs node; without it the modules outside engine/ would
  # go unlisted and a bundle lacking one would pass, so no node is a refusal,
  # and a walk that throws is one too, with node's own words.
  if [ -f "$tree/server.js" ]; then
    command -v node >/dev/null 2>&1 || { echo "release_bundle_expected_files: node is not on PATH, and the server's require graph (the modules the board cannot start without) needs it" >&2; return 2; }
    walk="$( cd "$tree" && node -e '
      const path = require("path"), fs = require("fs");
      const seen = new Set(); const q = [path.resolve("server.js")];
      while (q.length) {
        const f = q.pop(); if (seen.has(f)) continue; seen.add(f);
        let s = ""; try { s = fs.readFileSync(f, "utf8"); } catch { continue; }
        for (const m of s.matchAll(/require\(\s*["\x27](\.[^"\x27]+)["\x27]\s*\)/g)) {
          let r = path.resolve(path.dirname(f), m[1]);
          if (!fs.existsSync(r) && fs.existsSync(r + ".js")) r += ".js";
          if (fs.existsSync(r) && fs.statSync(r).isFile()) q.push(r);
        }
      }
      for (const f of seen) console.log("app/" + path.relative(process.cwd(), f));
    ' 2>"$tree/.kosmos-walk-err" )"; rc=$?
    [ "$rc" -eq 0 ] || { echo "release_bundle_expected_files: the require walk failed (node exit $rc): $(cat "$tree/.kosmos-walk-err" 2>/dev/null || true)" >&2; rm -f "$tree/.kosmos-walk-err"; return 2; }
    rm -f "$tree/.kosmos-walk-err"
    printf '%s\n' "$walk"
  fi
  return 0
}

# Compare every TREE-DERIVED file the served bundle ships against the tree it
# was built from: app/** and the top-level bin/kosmos (the command every user
# runs). runtime/** (a downloaded Node) and VERSION (a build stamp) are not
# tree files and are deliberately not extracted, so they cannot be compared.
# app/web/index.html is compared after the one substitution the build makes.
# $3 (optional): the expected sha256 of app/bin/kosmos-tunnel. The connector
# is NOT a tree file (kosmos-relay builds it), so it is verified against this
# checksum -- the sha of the tunnel THIS release built -- rather than skipped.
# Passing it empty means no bundle is expected to carry a tunnel, and a tunnel
# appearing anyway is a failure (a file the comparison has no source for).
# The expected set below (#609) leaves the tunnel out for that reason: its
# presence and bytes are this checksum's to judge, never the tree's.
# $4 (optional, #677): the expected sha256 of app/bin/kosmos-app, the native
# launcher. Same shape and same reason as $3 -- it IS compiled from a tree
# file (native-app/main.swift), but codesigning changes its bytes, so the
# tree comparison that works for a plain .js file cannot apply to it either;
# this checksum (computed by the caller from the bundle it just built) is its
# source of truth instead. Unlike the tunnel it is not derived-set-excluded
# by name (:114's grep -vx), because nothing under engine/ ever resolves it
# the way engine/remote.js resolves the tunnel, so it never appears as a
# derivation candidate in the first place.
# Then THE OTHER DIRECTION (#609): every file the tree and the app say the
# bundle must carry is in it; a missing one is named. 2 when the set could not
# be derived (not a Kosmos tree, no node for the require walk).
release_bundle_matches_tree() {
  local tar="$1" tree="$2" want_tunnel_sha="${3:-}" want_native_app_sha="${4:-}" tmp ver rel src cmpfile got_tunnel_sha saw_tunnel=0 got_native_app_sha saw_native_app=0 bad=0 expected
  [ -f "$tar" ] && [ -d "$tree" ] || { echo "release_bundle_matches_tree: need a tarball and a tree" >&2; return 2; }
  ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tree/package.json" | head -1)"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bundle-cmp.XXXXXX")" || return 2
  # `app bin`: the two tree-derived trees. A tarball missing either is a
  # failure, not a skip -- tar exits non-zero when a named member is absent.
  tar -xzf "$tar" -C "$tmp" app bin || { rm -rf "$tmp"; echo "release_bundle_matches_tree: could not read app/ and bin/ from $tar" >&2; return 2; }
  local n=0
  while IFS= read -r rel; do
    n=$((n+1))
    if [ "$rel" = app/bin/kosmos-tunnel ]; then
      # The connector: verified against the built tunnel's checksum, not the tree.
      if [ -z "$want_tunnel_sha" ]; then echo "   the bundle carries a connector but no expected checksum was given: $rel"; bad=1; continue; fi
      saw_tunnel=1
      got_tunnel_sha="$(shasum -a 256 "$tmp/$rel" | awk '{print $1}')"
      [ "$got_tunnel_sha" = "$want_tunnel_sha" ] || { echo "   the served connector is not the one this release built ($got_tunnel_sha != $want_tunnel_sha): $rel"; bad=1; }
      continue
    fi
    if [ "$rel" = app/bin/kosmos-app ]; then
      # The native launcher: verified against the built app's checksum, not
      # the tree, for the same codesigning reason as the connector.
      if [ -z "$want_native_app_sha" ]; then echo "   the bundle carries a native app but no expected checksum was given: $rel"; bad=1; continue; fi
      saw_native_app=1
      got_native_app_sha="$(shasum -a 256 "$tmp/$rel" | awk '{print $1}')"
      [ "$got_native_app_sha" = "$want_native_app_sha" ] || { echo "   the served native app is not the one this release built ($got_native_app_sha != $want_native_app_sha): $rel"; bad=1; }
      continue
    fi
    src="$(release_bundle_source_path "$rel")"
    cmpfile="$tmp/$rel"
    if [ ! -f "$tree/$src" ]; then echo "   not in the tree: $rel"; bad=1
    elif [ "$rel" = app/web/index.html ]; then
      sed "s/__KOSMOS_VERSION__/$ver/" "$tree/$src" | cmp -s - "$cmpfile" || { echo "   differs from the tree beyond the baked version: $rel"; bad=1; }
    else
      cmp -s "$tree/$src" "$cmpfile" || { echo "   differs from the tree: $rel"; bad=1; }
    fi
  done < <(cd "$tmp" && find app bin -type f 2>/dev/null | sed 's|^\./||')
  # THE OTHER DIRECTION (#609): every file the tree and the app say the bundle
  # must carry is in it. The loop above walks what IS in the bundle, so a file
  # the build forgot was invisible to it; this walks what SHOULD be.
  # Not through a pipe: sort would eat the derivation's 2. And the set must
  # hold a web/ file and an engine/ file, the two derived sources, or the
  # derivation is broken and would pass a bundle missing the page or the engine.
  if ! expected="$(release_bundle_expected_files "$tree" 2>"$tmp/.derive-err")"; then
    echo "   could not derive the files the bundle must carry from $tree: $(cat "$tmp/.derive-err" 2>/dev/null || true)"; rm -rf "$tmp"; return 2
  fi
  expected="$(printf '%s\n' "$expected" | sort -u)"
  printf '%s\n' "$expected" | grep -q '^app/web/' && printf '%s\n' "$expected" | grep -q '^app/engine/' || { rm -rf "$tmp"; echo "   the derived set names no web/ file or no engine/ file, so the derivation is broken (it would pass a bundle missing the page or the engine)"; return 2; }
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    [ -f "$tmp/$rel" ] || { echo "   missing from the bundle (the tree and the app need it): $rel"; bad=1; }
  done <<EOS
$expected
EOS
  rm -rf "$tmp"
  # ⚠️ An empty bundle compares equal to everything; zero files is a failure.
  [ "$n" -gt 0 ] || { echo "   the bundle holds no tree-derived files" ; return 1; }
  # ⚠️ PRESENCE, not just checksum-if-present: when a connector sha is
  # expected (a real cut), a bundle that shipped WITHOUT the connector must
  # fail -- a Kosmos with no Plus connector is the exact thing #583 prevents,
  # and its tree files would otherwise all match and pass here.
  if [ -n "$want_tunnel_sha" ] && [ "$saw_tunnel" -eq 0 ]; then
    echo "   the bundle carries no Plus connector (app/bin/kosmos-tunnel) but one was expected"; bad=1
  fi
  # Same presence requirement, same reason, for the native launcher (#677):
  # a bundle that shipped WITHOUT it would otherwise pass on tree files alone.
  if [ -n "$want_native_app_sha" ] && [ "$saw_native_app" -eq 0 ]; then
    echo "   the bundle carries no native app (app/bin/kosmos-app) but one was expected"; bad=1
  fi
  return $bad
}

# A cut that fails after it began writing into the site checkout leaves that
# checkout claiming a version it never served: dist/latest.json naming the new
# version, setup.sha256 for an installer nobody can download, and the versioned
# tarball pair whose name is cache-immutable (cut 5 of 0.5.24 refused to
# republish over the pair cut 4 left behind). A stray site deploy in that state
# would publish a latest.json pointing at a version that does not exist.
#   release_site_restore <site> <version> <pair-existed-before: 0|1>
# puts the two tracked files back to their committed bytes and removes the
# versioned pair when this cut created it. versions.html is NOT touched: its
# entry is hand-written and the re-cut needs it. Prints what it did. 0 always
# (it runs from a trap; a failure here must not mask the cut's own reason).
release_site_restore() {
  local site="$1" v="$2" had="$3" f
  [ -n "$site" ] && [ -n "$v" ] && [ -d "$site" ] || { echo "release_site_restore: site and version are required" >&2; return 0; }
  for f in dist/latest.json setup.sha256; do
    if git -C "$site" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      if ! git -C "$site" diff --quiet -- "$f"; then
        git -C "$site" checkout -q -- "$f" && echo "   put back: $f (the cut had changed it; the site checkout no longer claims $v)"
      fi
    fi
  done
  if [ "$had" != 1 ]; then
    for f in "dist/kosmos-$v-arm64.tar.gz" "dist/kosmos-$v-arm64.tar.gz.sha256"; do
      [ -f "$site/$f" ] && rm -f "$site/$f" && echo "   removed: $f (this cut created it and never served it; the name is cache-immutable, so it must not linger)"
    done
  fi
  return 0
}
