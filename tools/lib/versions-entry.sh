# The versions-page gate (#1453), factored out of step 7 so it can also run at
# step 1.
#
# 🛑 THE CHECK WAS NEVER WRONG. ITS POSITION WAS. Both halves need only `$V`
# (argv, release.sh line 18) and `$SITE` (line 131), and both of those exist
# before the script does any work at all -- yet the gate ran at step 7, after
# the suite, the browser gate, the install gate and the build. Four cuts died
# there (0.5.80, 0.5.90, 0.5.91, 0.6.06), each paying about fifteen minutes of
# machine time to be told something knowable in three seconds.
#
# 🔑 THE EARLY CALL DOES NOT REPLACE THE LATE ONE, AND THEY ASK DIFFERENT
# QUESTIONS. Early asks "can this cut finish?" before spending the machine.
# Late asks "is the page right at the moment we deploy?", which still has to
# hold because the site checkout can change under a cut that runs for fifteen
# minutes. Moving the gate instead of adding to it would trade a slow failure
# for an unguarded deploy.
#
# ⚠️ ONE FUNCTION, TWO CALL SITES, ON PURPOSE. Two copies of a window is the
# stale-assertion shape: somebody widens one and the other keeps refusing, and
# a guard that disagrees with itself is worse than either answer alone.
#
# ⭐ THE WINDOW IS SYMMETRIC AND STAYS SYMMETRIC. A stamp written for
# publication sits about fifteen minutes ahead at step 1, giving off = -15,
# and 15 <= 20 passes, so the early call does NOT refuse correctly-stamped
# entries -- measured, not assumed. Widening the future side was proposed and
# REJECTED: the guard's own comment in release.sh says the four newest entries
# of 2026-08-21 "claimed release times that had not happened yet", so forward
# stamps are precisely part of what it catches. A wider future window would
# make a guess satisfiable again, which is the hole the guard exists to close.

kosmos_versions_entry_id() { echo "v$(echo "$1" | tr . -)"; }

# Prints the entry's rel-d string, or nothing when there is no entry.
kosmos_versions_entry_stamp() {
  local v="$1" file="$2" id
  id="$(kosmos_versions_entry_id "$v")"
  sed -n "/id=\"$id\"/,/<\/article>/p" "$file" 2>/dev/null \
    | sed -n 's/.*rel-d">\([^<]*\)<.*/\1/p' | head -1
}

# Prints `ok`, `unparseable`, or the signed minute offset (positive = the entry
# is in the past). The expression is the one that has always run at step 7.
kosmos_versions_entry_stamp_off() {
  V_ENTRY="$1" node -e "
  const s = process.env.V_ENTRY || '';
  const m = s.match(/^(\w+) (\d+), (\d+), (\d+):(\d+) (AM|PM)/);
  if (!m) { console.log('unparseable'); process.exit(0); }
  const months = 'January February March April May June July August September October November December'.split(' ');
  let h = Number(m[4]) % 12; if (m[6] === 'PM') h += 12;
  const t = new Date(Number(m[3]), months.indexOf(m[1]), Number(m[2]), h, Number(m[5]));
  const off = Math.round((Date.now() - t.getTime()) / 60000);
  console.log(Math.abs(off) <= 20 ? 'ok' : String(off));
"
}

# The whole gate. $1 version, $2 versions.html, $3 a short label naming what is
# lost by failing here, so the early refusal can say the machine is unspent and
# the late one cannot claim that.
kosmos_versions_entry_gate() {
  local v="$1" file="$2" cost="$3" id stamp off now
  id="$(kosmos_versions_entry_id "$v")"

  if ! grep -q "id=\"$id\"" "$file" 2>/dev/null; then
    echo "   $v has no entry in $file."
    echo "   Write it (ruled copy, real timestamp) and re-run. $cost"
    return 1
  fi
  echo "   $v is on the page"

  stamp="$(kosmos_versions_entry_stamp "$v" "$file")"
  off="$(kosmos_versions_entry_stamp_off "$stamp")"
  if [ "$off" != "ok" ]; then
    now="$(date '+%B %-d, %Y, %-I:%M %p %Z')"
    echo "   the entry for $v is stamped: $stamp"
    echo "   the clock says:              $now"
    echo "   that is off by $off minutes (positive means the entry is in the past)."
    echo "   Paste the clock line above into the entry's rel-d and re-run. $cost"
    return 1
  fi
  echo "   its timestamp agrees with the clock"
  return 0
}
