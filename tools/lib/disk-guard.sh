#!/usr/bin/env bash
# Refuse to start something disk-hungry when the disk cannot hold it, and say
# WHICH disk and HOW MUCH, because a full disk never announces itself as one:
# it arrives as a failed cp, a test dying at its first check, an ECONNRESET,
# five agents failing at once (this Mac, 2026-08-24, twice: 288 MB free, then
# draining at 800 MB/min under a harness run). #736.
#
#   kosmos_require_free_mb <mb> <path> <what-for>
#     returns 0 when the filesystem holding <path> has at least <mb> MB free,
#     otherwise prints one sentence naming the mount, the free space and the
#     need, and returns 1.
#
# KOSMOS_DF is a HARNESS SEAM ONLY: the command used in place of `df`, so a
# test can hand it a disk with 1 GB free and watch this refuse. A guard that
# has never been observed refusing is indistinguishable from one that cannot.
kosmos_require_free_mb() {
  # 🛑 `where`, NOT `path` (#1621). zsh TIES `path` to `PATH` as an array, so a
  # scalar `local path` DESTROYS PATH for this function's dynamic scope and every
  # command it calls dies with "command not found". The declaration alone is
  # enough; no assignment is needed. Harmless when this file is EXECUTED under
  # bash, which is the normal path, and fatal the moment somebody sources it into
  # the zsh the agent Bash tool actually runs. The symptom reads as a broken
  # machine rather than a broken script, which is what makes it expensive.
  # The other three tied names are `cdpath`, `fpath` and `manpath`.
  local need="$1" where="$2" what="${3:-this}" df_cmd="${KOSMOS_DF:-df}" line mount free
  line="$("$df_cmd" -m "$where" 2>/dev/null | awk 'NR==2')"
  free="$(printf '%s\n' "$line" | awk '{print $4}')"
  mount="$(printf '%s\n' "$line" | awk '{print $NF}')"
  case "$free" in ''|*[!0-9]*) echo "could not read free space for $where (df said: ${line:-nothing}); refusing to guess for $what" >&2; return 1 ;; esac
  if [ "$free" -lt "$need" ]; then
    echo "only $free MB free on $mount (the disk holding $where); $what needs about $need MB, and a full disk would not read as one: it would read as a failed copy or a broken build. Free space first." >&2
    return 1
  fi
  return 0
}
