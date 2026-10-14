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
# Tests whose fixtures predate the floor (0.6.x builds) lower it with KOSMOS_SETUP_FLOOR, and every check that runs
# under a lowered floor says so on stderr. It is a test fixture knob: a real promote or deploy never sets it.
KOSMOS_SETUP_FLOOR="${KOSMOS_SETUP_FLOOR:-$KOSMOS_SETUP_FLOOR_REAL}"

kosmos_setup_floor_ok() {
  local label="$1" v="$2"
  [ "$KOSMOS_SETUP_FLOOR" = "$KOSMOS_SETUP_FLOOR_REAL" ] ||
    echo "setup floor (kosmos#6149): WARNING the floor is LOWERED to $KOSMOS_SETUP_FLOOR by KOSMOS_SETUP_FLOOR (the real floor is $KOSMOS_SETUP_FLOOR_REAL): tests only" >&2
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
