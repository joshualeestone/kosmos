# kosmos#6149 point 1: the rollback floor for the Mac and Linux installer.
#
# #4455 (merged as #6146, in 0.7.49) makes the installed app read-only. An installer that cannot lift that lock
# removes bin/ on update, fails at the read-only app/, and cannot put the board back, on every install 0.7.49
# touched. Installers from 0.7.42 on can lift it (#4449); 0.7.45 is the first such installer served on prod. So no Mac
# pointer (dist/latest.json, dist/latest-staging.json) may name a build older than KOSMOS_SETUP_FLOOR (0.7.45,
# stricter than needed, which fails closed), and no /setup or /setup-staging may be an installer that cannot lift
# the lock (the marker, below). There is no override for real use (only the test knob below, which only lowers the
# floor, warns, and release.sh refuses): serving such an installer breaks installs, so the fix is a newer build.
#
# Usage: source this file, then call one check; each returns 0 (passes) or 1 (refused, the reason on stderr). The
# scripts named are the DIRECT callers; tree_ok and site_untouched_ok also run pointer_ok and installer_ok:
#   kosmos_setup_floor_ok <label> <version>              a version (publish-staging-pointer.sh; release.sh, override)
#   kosmos_setup_floor_pointer_ok <label> <json>          a pointer (promote-channel.sh, deploy-site.sh's early check)
#   kosmos_setup_floor_installer_ok <label> <file>        an installer (promote-channel.sh, release.sh step 1a and 2b)
#   kosmos_setup_floor_tree_ok <who> <dir>                a site tree's pointers and installers (the exports)
#   kosmos_setup_floor_site_untouched_ok <who> <site> <channel>   the pair a cut re-publishes untouched (release.sh)
# A version that is not plain numbers and dots is refused: the floor cannot be checked.
KOSMOS_SETUP_FLOOR_REAL="0.7.45"
# Tests whose fixtures predate the floor (0.6.x builds) lower it, and only with BOTH KOSMOS_SETUP_FLOOR_TEST=1 and a
# plain-number KOSMOS_SETUP_FLOOR_LOWER; anything else (one of them alone, a non-numeric value) leaves the real floor.
# Every check under a lowered floor says so on stderr. A real promote or deploy sets neither.
KOSMOS_SETUP_FLOOR="$KOSMOS_SETUP_FLOOR_REAL"
if [ "${KOSMOS_SETUP_FLOOR_TEST:-}" = 1 ]; then
  case "${KOSMOS_SETUP_FLOOR_LOWER:-}" in
    ''|*[!0-9.]*|.*|*.|*..*) ;;
    *) # only ever LOWER: a value at or above the real floor is ignored (it would also skip the installer check)
      if awk -v a="$KOSMOS_SETUP_FLOOR_LOWER" -v b="$KOSMOS_SETUP_FLOOR_REAL" 'BEGIN {
          n = split(a, x, "."); m = split(b, y, "."); k = (n > m) ? n : m
          for (i = 1; i <= k; i++) { p = (i <= n) ? x[i] + 0 : 0; q = (i <= m) ? y[i] + 0 : 0
            if (p < q) exit 0; if (p > q) exit 1 }
          exit 1 }'; then
        KOSMOS_SETUP_FLOOR="$KOSMOS_SETUP_FLOOR_LOWER"
      fi ;;
  esac
fi

kosmos_setup_floor_ok() {
  local label="$1" v="$2"
  [ "$KOSMOS_SETUP_FLOOR" = "$KOSMOS_SETUP_FLOOR_REAL" ] ||
    echo "setup floor (kosmos#6149): WARNING the floor is LOWERED to $KOSMOS_SETUP_FLOOR by KOSMOS_SETUP_FLOOR_TEST and KOSMOS_SETUP_FLOOR_LOWER (the real floor is $KOSMOS_SETUP_FLOOR_REAL): tests only" >&2
  case "$v" in
    ''|*[!0-9.]*|.*|*.|*..*)
      echo "setup floor (kosmos#6149): $label names version '$v', which cannot be compared with the floor $KOSMOS_SETUP_FLOOR -- refusing" >&2
      return 1 ;;
  esac
  # Numeric, part by part (0.7.100 is newer than 0.7.45; a string compare would say older).
  if awk -v a="$v" -v b="$KOSMOS_SETUP_FLOOR" 'BEGIN {
      n = split(a, x, "."); m = split(b, y, "."); k = (n > m) ? n : m
      for (i = 1; i <= k; i++) { p = (i <= n) ? x[i] + 0 : 0; q = (i <= m) ? y[i] + 0 : 0
        if (p > q) exit 0; if (p < q) exit 1 }
      exit 0 }'; then
    return 0
  fi
  echo "setup floor (kosmos#6149): $label names $v, older than $KOSMOS_SETUP_FLOOR. Once 0.7.49 (#4455, read-only app) is out, an installer older than $KOSMOS_SETUP_FLOOR breaks every install it updates: it cannot lift the app's lock. Serve a build at or above $KOSMOS_SETUP_FLOOR instead -- refusing" >&2
  return 1
}

# `kosmos_setup_floor_pointer_ok <label> <pointer-json-text>`: a Mac pointer's version AND the version in its artifact
# name (kosmos-<version>-<arch>.tar.gz) must both be at or above the floor, and must be the same version: a pointer
# that says 0.7.49 but names an older tarball is refused, since the tarball is what installs. An artifact that is not
# a versioned kosmos tarball name is refused too (fail closed): every real Mac pointer names one.
kosmos_setup_floor_pointer_ok() {
  local label="$1" json="$2" v art av
  # One of each key: readers of a doubled key disagree (JSON.parse keeps the last, a first-match reader the first, a
  # greedy sed the last on one line), so with one key each every reader agrees on which build installs. The extractors read `"key":` (the real
  # writer, write-latest-pointer.js, writes one line in that form); a pointer spelled `"key" :` reads as having no
  # version and is refused, which fails closed.
  # No escapes: a key spelled with a JSON escape (\u0076ersion) is invisible to these extractors yet read by a JSON
  # parser, so a pointer with any backslash is refused (the real writer, write-latest-pointer.js, never emits one).
  # One line: a key whose colon sits on the next line ("version"<newline>:"0.6.1") hid from a per-line count, while a
  # JSON parser reads it; so newlines and returns become spaces before the counts and the extractors read the pointer.
  json=$(printf '%s' "$json" | tr '\n\r' '  ')
  case "$json" in
    *\\*) echo "setup floor (kosmos#6149): $label has a backslash (a JSON escape could hide a key) -- refusing" >&2; return 1 ;;
  esac
  if [ "$(printf '%s' "$json" | grep -o '"version"[[:space:]]*:' | wc -l | tr -d ' ')" -gt 1 ] ||
     [ "$(printf '%s' "$json" | grep -o '"artifact"[[:space:]]*:' | wc -l | tr -d ' ')" -gt 1 ]; then
    echo "setup floor (kosmos#6149): $label names version or artifact more than once -- refusing" >&2
    return 1
  fi
  v=$(printf '%s' "$json" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p')
  art=$(printf '%s' "$json" | sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p')
  kosmos_setup_floor_ok "$label" "$v" || return 1
  [ -n "$art" ] || {
    echo "setup floor (kosmos#6149): $label names no artifact, so what it installs cannot be checked -- refusing" >&2
    return 1
  }
  av=$(printf '%s' "$art" | sed -n 's/^kosmos-\(.*\)-[a-z0-9_][a-z0-9_]*\.tar\.gz$/\1/p')
  if [ -z "$av" ] || [ "$av" != "$v" ]; then
    echo "setup floor (kosmos#6149): $label says version $v but names artifact $art -- refusing (the tarball is what installs)" >&2
    return 1
  fi
}

# The installer's own bytes. A pointer's version says nothing about the /setup or /setup-staging served beside it,
# and a hand rollback can commit an old one next to a new pointer. The switch (KOSMOS_READONLY_APP) and the lift came
# in one change (card #4449, PR #4476), so an installer that names it can lift the read-only app; a string check, not
# a proof. The measurements behind it are in .claude/plans/setupfloor-6149.md (0.7.42 on carry it; the prod /setup
# served before 0.7.45 does not). The pointers' floor stays 0.7.45, the first PROD-served such installer.
KOSMOS_SETUP_FLOOR_MARKER="KOSMOS_READONLY_APP"

# `kosmos_setup_floor_installer_ok <label> <file>`: the installer must know the read-only app (the marker). Under a
# lowered floor (test fixtures, whose installers are stand-ins) it is skipped, with the warning.
kosmos_setup_floor_installer_ok() {
  local label="$1" file="$2"
  if [ "$KOSMOS_SETUP_FLOOR" != "$KOSMOS_SETUP_FLOOR_REAL" ]; then
    echo "setup floor (kosmos#6149): WARNING the floor is LOWERED to $KOSMOS_SETUP_FLOOR (the real floor is $KOSMOS_SETUP_FLOOR_REAL): the installer check on $label is skipped: tests only" >&2
    return 0
  fi
  [ -f "$file" ] && [ -r "$file" ] || {
    echo "setup floor (kosmos#6149): $label ($file) is missing or unreadable, so the installer cannot be checked -- refusing" >&2
    return 1
  }
  grep -q "$KOSMOS_SETUP_FLOOR_MARKER" "$file" || {
    echo "setup floor (kosmos#6149): $label does not know $KOSMOS_SETUP_FLOOR_MARKER, so it is an installer from before $KOSMOS_SETUP_FLOOR_REAL and would break every install a read-only build has touched -- refusing" >&2
    return 1
  }
}

# `kosmos_setup_floor_tree_ok <who> <dir>`: the tree a deploy is about to publish (its export) must hold no Mac
# pointer and no installer older than the floor: dir/dist/latest.json and dir/dist/latest-staging.json (when present)
# through kosmos_setup_floor_pointer_ok, and dir/setup and dir/setup-staging (when present) must carry the marker.
# Under a lowered floor (test fixtures) the installer check is skipped, with a warning. Out of its scope, on purpose:
# the .pkg (its postinstall fetches and verifies /setup, so /setup covers it) and the unversioned alias tarball (the
# app, not an installer).
kosmos_setup_floor_tree_ok() {
  local who="$1" dir="$2" f
  for f in dist/latest.json dist/latest-staging.json; do
    [ -f "$dir/$f" ] || continue
    kosmos_setup_floor_pointer_ok "$who: $f" "$(cat "$dir/$f")" || return 1
  done
  for f in setup setup-staging; do
    [ -f "$dir/$f" ] || continue
    kosmos_setup_floor_installer_ok "$who: $f" "$dir/$f" || return 1
  done
}

# `kosmos_setup_floor_site_untouched_ok <who> <site> <channel>`: a cut's FAIL-FAST, on the pair it re-publishes WITHOUT
# writing it: a staging cut leaves the prod pair (dist/latest.json, setup), a prod cut leaves the staging pair
# (dist/latest-staging.json, setup-staging). The pair the cut writes is not checked here (the cut replaces it with
# the new build, which is how an old one gets fixed). It reads whatever tree it is given (release.sh gives it the
# site's origin/main, fetched, or the checkout if the fetch fails); the cut's export check before its deploy reads the
# bytes actually published and stays the authority.
kosmos_setup_floor_site_untouched_ok() {
  local who="$1" site="$2" channel="$3" ptr inst
  case "$channel" in
    staging) ptr="dist/latest.json"; inst="setup" ;;
    prod) ptr="dist/latest-staging.json"; inst="setup-staging" ;;
    *) echo "setup floor (kosmos#6149): $who: unknown channel '$channel' -- refusing" >&2; return 1 ;;
  esac
  [ ! -f "$site/$ptr" ] || kosmos_setup_floor_pointer_ok "$who: $ptr" "$(cat "$site/$ptr")" || return 1
  [ ! -f "$site/$inst" ] || kosmos_setup_floor_installer_ok "$who: $inst" "$site/$inst" || return 1
}
