# kosmos_test_locale_pin (#5073): give the test suite a UTF-8 locale when its caller has none at all.
#
# Without one, tmux sanitises its own format output and replaces the field tabs with underscores, so every test
# that reads tmux parses one garbage field per pane and goes red for a reason that is not the change. That is how
# the 0.7.19 re-cut aborted on 2026-10-02: it was launched through `tmux run-shell`, which inherits the tmux
# SERVER's environment, and that had no LANG. ssh forwards only LANG/LC_*, so the cut on the other Mac had none.
#
# Rules, in order:
# - LC_ALL, LC_CTYPE and LANG all empty: export LANG=en_US.UTF-8 (what every agent shell and the board's own
#   launchd job already carry) and say so on stderr, once.
# - Any of them set to something that is not UTF-8 (a caller who chose a locale): change nothing, and say on
#   stderr that tmux output will be unreadable, so a red names its cause.
# - A UTF-8 locale already in effect: nothing, silently.
# The effective ctype is LC_ALL, else LC_CTYPE, else LANG, which is the order the C library reads them in.
kosmos_test_locale_pin() {
  local eff="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
  if [ -z "$eff" ]; then
    export LANG=en_US.UTF-8
    echo "run-tests: no locale was set (LANG, LC_CTYPE and LC_ALL all empty); using LANG=en_US.UTF-8 so tmux output is readable (#5073)" >&2
    return 0
  fi
  case "$eff" in
    *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) return 0 ;;
  esac
  echo "run-tests: WARNING the locale in effect is '$eff', not UTF-8: tmux will replace its field separators and tests that read tmux will fail for that reason, not for the change (#5073)" >&2
  return 0
}
