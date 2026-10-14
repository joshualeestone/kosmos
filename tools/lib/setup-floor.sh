# kosmos#6149 point 1: the rollback floor for the Mac and Linux installer.
#
# #4455 (merged as #6146, in 0.7.49) makes the installed app read-only. An installer older than 0.7.45 does not know
# to lift that lock: it removes bin/, fails at the read-only app/, and cannot put the board back, on every install
# 0.7.49 touched. So no Mac pointer (dist/latest.json, dist/latest-staging.json), and therefore no /setup or
# /setup-staging, may name a build older than KOSMOS_SETUP_FLOOR. There is no override: serving such a build breaks
# installs, so the fix is a newer build, never a flag.
#
# Usage: source this file, then `kosmos_setup_floor_ok <label> <version>` (exit 0 = at or above the floor; 1 = refused,
# with the reason on stderr). A version that is not plain numbers and dots is refused: the floor cannot be checked.
KOSMOS_SETUP_FLOOR_REAL="0.7.45"
# Tests whose fixtures predate the floor (0.6.x builds) lower it, and only with BOTH KOSMOS_SETUP_FLOOR_TEST=1 and a
# plain-number KOSMOS_SETUP_FLOOR_LOWER; anything else (one of them alone, a non-numeric value) leaves the real floor.
# Every check under a lowered floor says so on stderr. A real promote or deploy sets neither.
KOSMOS_SETUP_FLOOR="$KOSMOS_SETUP_FLOOR_REAL"
if [ "${KOSMOS_SETUP_FLOOR_TEST:-}" = 1 ]; then
  case "${KOSMOS_SETUP_FLOOR_LOWER:-}" in
    ''|*[!0-9.]*|.*|*.|*..*) ;;
    *) KOSMOS_SETUP_FLOOR="$KOSMOS_SETUP_FLOOR_LOWER" ;;
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
  v=$(printf '%s' "$json" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p')
  art=$(printf '%s' "$json" | sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p')
  kosmos_setup_floor_ok "$label" "$v" || return 1
  [ -n "$art" ] || return 0
  av=$(printf '%s' "$art" | sed -n 's/^kosmos-\(.*\)-[a-z0-9_]*\.tar\.gz$/\1/p')
  if [ -z "$av" ] || [ "$av" != "$v" ]; then
    echo "setup floor (kosmos#6149): $label says version $v but names artifact $art -- refusing (the tarball is what installs)" >&2
    return 1
  fi
}

# The installer's own bytes. A pointer's version says nothing about the /setup or /setup-staging served beside it,
# and a hand rollback can commit an old one next to a new pointer. Every installer from 0.7.45 on knows the read-only
# app and its switch (KOSMOS_READONLY_APP, #4449); none before 0.7.45 does (measured on the served history: 0.7.44's
# /setup has 0 mentions, 0.7.45's 7). So an installer without it is older than the floor.
KOSMOS_SETUP_FLOOR_MARKER="KOSMOS_READONLY_APP"

# `kosmos_setup_floor_tree_ok <who> <dir>`: the tree a deploy is about to publish (its export) must hold no Mac
# pointer and no installer older than the floor: dir/dist/latest.json and dir/dist/latest-staging.json (when present)
# through kosmos_setup_floor_pointer_ok, and dir/setup and dir/setup-staging (when present) must carry the marker.
# Under a lowered floor (test fixtures) the installer check is skipped, with the same warning.
kosmos_setup_floor_tree_ok() {
  local who="$1" dir="$2" f
  for f in dist/latest.json dist/latest-staging.json; do
    [ -f "$dir/$f" ] || continue
    kosmos_setup_floor_pointer_ok "$who: $f" "$(cat "$dir/$f")" || return 1
  done
  [ "$KOSMOS_SETUP_FLOOR" = "$KOSMOS_SETUP_FLOOR_REAL" ] || return 0
  for f in setup setup-staging; do
    [ -f "$dir/$f" ] || continue
    grep -q "$KOSMOS_SETUP_FLOOR_MARKER" "$dir/$f" || {
      echo "setup floor (kosmos#6149): $who: $f does not know $KOSMOS_SETUP_FLOOR_MARKER, so it is an installer from before $KOSMOS_SETUP_FLOOR_REAL and would break every install a read-only build has touched -- refusing" >&2
      return 1
    }
  done
}
