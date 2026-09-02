#!/usr/bin/env bash
# #1511: install/setup.sh held its own definition of the data root, and it is the
# one that deletes. `_kosmos_data_root` is now the single shell answer, preferring
# the product's own `dataRootFor` when the install can give one.
#
# 🛑 EVERY ARM HERE EXISTS BECAUSE THE VALUE STEERS AN `rm -rf`. An arm that
# cannot fail is worse than no arm on a delete path.
set -uo pipefail
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s\n     got: %s\n' "$1" "$2"; }

SETUP="$(cd "$(dirname "$0")/.." && pwd)/install/setup.sh"
HELPER="$(mktemp)"
python3 - "$SETUP" "$HELPER" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
i=s.index('_kosmos_data_root() {'); j=s.index('\n}\n', i)+3
io.open(sys.argv[2],'w',encoding='utf-8').write(s[i:j])
PY
[ -s "$HELPER" ] || { echo "FAIL  could not extract _kosmos_data_root from setup.sh"; exit 1; }

# 🛑 UNDER THE FILE'S OWN INTERPRETER AND OPTIONS. setup.sh is `#!/bin/sh` with
# `set -euo pipefail`; the first version of this harness ran the helper in bash with
# no -e, so dropping the `|| _kdr=""` on the consult left all arms green while the
# real uninstall aborted with rc=3 on every pre-#570 install. Same shell, same
# options, or the harness is testing a different program.
run() { /bin/sh -euc "set -o pipefail; $1; . '$HELPER'; _kosmos_data_root" 2>/dev/null; }
# The same, keeping stderr, for the refusal arms: the sentence is the only thing
# that tells the person why the uninstall stopped, and 2>/dev/null hid its deletion.
run_err() { /bin/sh -euc "set -o pipefail; $1; . '$HELPER'; _kosmos_data_root" 2>&1 >/dev/null; }
# The default answer, normalised the way the helper normalises, so a HOME carrying a
# trailing slash does not red five arms for a reason none of them names.
EXP_DEFAULT="$(printf '%s' "$HOME/Library/Application Support" | /usr/bin/tr -s '/')"; EXP_DEFAULT="${EXP_DEFAULT%/}/AgentWorkforce"

# 0. THE FILE PARSES. Every refusal arm below asserts "nothing on stdout, non-zero",
#    and a helper that cannot parse satisfies that. Named here so a syntax error reds
#    by name rather than as ten refusals passing while the acceptance arms fail.
if sh -n "$SETUP" 2>/dev/null; then ok "install/setup.sh parses under sh -n"
else bad "install/setup.sh does not parse; every refusal arm below is void" "$(sh -n "$SETUP" 2>&1 | head -1)"; fi
# A refusal is nothing on stdout, non-zero, AND the sentence on stderr. All three, every
# time: the sentence is what distinguishes a refusal from a crash with the same shape.
refused() {   # $1 = preamble, $2 = a word the reason must contain
  _r=$(run "$1"); _rc=$?
  _e=$(run_err "$1" || true)
  [ -z "$_r" ] && [ "$_rc" -ne 0 ] && case "$_e" in *"refusing to uninstall"*"$2"*) return 0 ;; esac
  printf 'rc=%s out=[%s] err=[%s]' "$_rc" "$_r" "$(printf '%s' "$_e" | head -c 160)"; return 1
}

# 1. no runtime: the literal, which for every install older than #570 IS the path
r=$(run 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA')
[ "$r" = "$EXP_DEFAULT" ] \
  && ok "no runtime falls back to the default root" || bad "no runtime falls back to the default root" "$r"

# 2. the sandbox seam is honoured in the fallback
r=$(run 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=/tmp/sbx-1511')
[ "$r" = "/tmp/sbx-1511/AgentWorkforce" ] \
  && ok "the sandbox seam is honoured" || bad "the sandbox seam is honoured" "$r"

FAKE="$(mktemp -d)"; mkdir -p "$FAKE/runtime/bin" "$FAKE/app/engine"
ln -sf "$(command -v node)" "$FAKE/runtime/bin/node"

# 3. THE ARM THAT CAN TELL THE TWO PATHS APART. On macOS the product's answer and
#    the literal are IDENTICAL, so an arm using the real store.js proves nothing:
#    it passes whether the consult ran or not. This one returns a path the shell
#    fallback could never produce.
printf '%s\n' "module.exports = { dataRootFor: () => '/tmp/ONLY-NODE-1511/AgentWorkforce' };" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "/tmp/ONLY-NODE-1511/AgentWorkforce" ] \
  && ok "the product's own dataRootFor wins when the install can answer" \
  || bad "the product's own dataRootFor wins when the install can answer" "$r"

# 4. CONTROL for arm 3: same store.js, runtime gone, must fall back
rm -f "$FAKE/runtime/bin/node"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$EXP_DEFAULT" ] \
  && ok "CONTROL: no runtime means the literal, even with a willing store.js" \
  || bad "CONTROL: no runtime means the literal, even with a willing store.js" "$r"
ln -sf "$(command -v node)" "$FAKE/runtime/bin/node"

# 5. a store.js with no dataRootFor: the real shape of every install before #570
printf '%s\n' "module.exports = {};" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$EXP_DEFAULT" ] \
  && ok "an install predating dataRootFor falls through" || bad "an install predating dataRootFor falls through" "$r"

# 6. a relative answer must NOT steer a delete
printf '%s\n' "module.exports = { dataRootFor: () => 'not-absolute' };" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$EXP_DEFAULT" ] \
  && ok "a relative answer is refused" || bad "a relative answer is refused" "$r"

# 7. a throwing store.js must not take the uninstall down or return empty
printf '%s\n' 'throw new Error("boom");' > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$EXP_DEFAULT" ] \
  && ok "a throwing store.js falls back rather than emptying" || bad "a throwing store.js falls back rather than emptying" "$r"

# 8. A RELATIVE OVERRIDE IS REFUSED ON THE FINAL ANSWER, not only on the consult.
#    The first version refused node's relative answer and then emitted the same
#    relative string from the fallback, so arm 6 protected nothing in the one case
#    that actually produces a relative root. Refusal = nothing on stdout, non-zero,
#    AND the sentence on stderr (deleting the sentence used to leave every arm green).
r=$(run 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=rel/sbx-1511'); rc=$?
e=$(run_err 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=rel/sbx-1511' || true)
[ -z "$r" ] && [ "$rc" -ne 0 ] && case "$e" in *"refusing to uninstall"*"not an absolute path"*) true ;; *) false ;; esac \
  && ok "a relative AGENT_WORKFORCE_DATA is refused: non-zero, nothing on stdout, the reason on stderr" \
  || bad "a relative AGENT_WORKFORCE_DATA is refused: non-zero, nothing on stdout, the reason on stderr" "rc=$rc out=[$r] err=[$e]"

# 9. HOME EMPTY IS REFUSED, BY RESULT. `set -u` does not catch empty, and the old
#    fallback resolved it to /Library/Application Support/AgentWorkforce, the SYSTEM
#    folder, with the sandbox guard silent because both of its sides derive from HOME.
r=$(run 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA; HOME=""'); rc=$?
e=$(run_err 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA; HOME=""' || true)
[ -z "$r" ] && [ "$rc" -ne 0 ] && case "$e" in *"refusing to uninstall"*"system-wide Library"*) true ;; *) false ;; esac \
  && ok "an empty HOME is refused rather than steering a delete under /Library, with the reason on stderr" \
  || bad "an empty HOME is refused rather than steering a delete under /Library, with the reason on stderr" "rc=$rc out=[$r] err=[$e]"

# 9b. AND HOME=/ REACHES THE SAME FOLDER. The refusal is on the RESULT, so every
#     spelling of a stripped HOME lands in one case; this arm pins the second spelling.
d=$(refused 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA; HOME=/' 'system-wide Library') \
  && ok "HOME=/ is refused the same way, because the refusal reads the result" \
  || bad "HOME=/ is refused the same way, because the refusal reads the result" "$d"

# 9c. THE CONSULT'S ANSWER MUST CARRY THE LEAF. Every rm below the capture is bounded
#     by /AgentWorkforce; an installed store.js returning "/" or "$HOME" would have
#     made "$_support/bin" mean /bin or ~/bin. Arm 3's fake happens to include the
#     leaf, so nothing else exercises this.
printf '%s\n' "module.exports = { dataRootFor: () => '/tmp/ONLY-NODE-1511' };" > "$FAKE/app/engine/store.js"
d=$(refused "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA" 'does not end in /AgentWorkforce') \
  && ok "an absolute consult answer WITHOUT the /AgentWorkforce leaf is refused" \
  || bad "an absolute consult answer WITHOUT the /AgentWorkforce leaf is refused" "$d"

# 10. THE CONSULT HONOURS THE SANDBOX SEAM, through the REAL store.js. The #924
#     shape: runtime present AND an override set. Replacing process.env with {} in
#     the node call left every earlier arm green. Exported, because node reads the
#     environment and setup.sh always exports this variable.
cp "$(dirname "$SETUP")/../engine/store.js" "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; export AGENT_WORKFORCE_DATA=/tmp/sbx-1511")
[ "$r" = "/tmp/sbx-1511/AgentWorkforce" ] \
  && ok "the consult, through the real store.js, honours an exported sandbox seam" \
  || bad "the consult, through the real store.js, honours an exported sandbox seam" "$r"

# 11. AND THE FALLBACK NORMALISES LIKE THE ENGINE: trailing and doubled slashes.
r=$(run 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=/tmp//sbx-1511/')
[ "$r" = "/tmp/sbx-1511/AgentWorkforce" ] \
  && ok "the fallback squeezes // and drops a trailing /, as path.join does" \
  || bad "the fallback squeezes // and drops a trailing /, as path.join does" "$r"

# 9d. A . OR .. COMPONENT IS REFUSED OUTRIGHT. HOME=/. reaches the system Library by
#     a spelling the string check cannot see, and /x/.. is any folder by another name.
for inp in 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA; HOME=/.' \
           'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=/tmp/sbx-1511/x/..' \
           'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=/tmp/sbx-1511/.'; do
  d=$(refused "$inp" '. or .. component') && ok "a . or .. component is refused ($inp)" \
    || bad "a . or .. component is refused ($inp)" "$d"
done

# 9e. A SYMLINK TO THE SYSTEM LIBRARY IS REFUSED, because the parent is canonicalised
#     before the comparison. Control: a symlink to an ordinary folder is accepted.
LNK="$(mktemp -d)"; ln -s "/Library/Application Support" "$LNK/lnk"; mkdir -p "$LNK/plain"; ln -s "$LNK/plain" "$LNK/ok"
d=$(refused "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/lnk" 'system-wide Library') \
  && ok "a symlink to the system Library is refused (parent canonicalised)" \
  || bad "a symlink to the system Library is refused (parent canonicalised)" "$d"
# A symlink AT THE LEAF, pointing into the system folder: the parent canonicalisation
# cannot see it, rm -rf traverses a leaf link as a directory, and every removal
# below appends a component to it. Caught by comparing the resolved folder's
# parent by device:inode. The target is any real subfolder of the system folder.
SYSSUB="$(ls "/Library/Application Support" | head -1)"
mkdir -p "$LNK/leaf"; ln -sfn "/Library/Application Support/$SYSSUB" "$LNK/leaf/AgentWorkforce"
d=$(refused "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/leaf" 'system-wide Library') \
  && ok "a symlink AT THE LEAF into the system Library is refused (parent compared by inode)" \
  || bad "a symlink AT THE LEAF into the system Library is refused (parent compared by inode)" "$d"
mkdir -p "$LNK/leafok" "$LNK/target"; ln -sfn "$LNK/target" "$LNK/leafok/AgentWorkforce"
r=$(run "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/leafok"); rc=$?
[ "$rc" -eq 0 ] && [ "$r" = "$LNK/leafok/AgentWorkforce" ] && ok "CONTROL: a leaf symlink to an ordinary folder is still accepted" \
  || bad "CONTROL: a leaf symlink to an ordinary folder is still accepted" "rc=$rc out=[$r]"
# A CASE VARIANT of the system folder on a case-insensitive filesystem: the string
# check and sh's pwd -P both keep the typed case; the inode does not.
d=$(refused 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA="/LIBRARY/APPLICATION SUPPORT"' 'system-wide Library') \
  && ok "a case variant of the system Library is refused (compared by inode)" \
  || bad "a case variant of the system Library is refused (compared by inode)" "$d"
# A parent that exists but cannot be entered must produce a SENTENCE, not a silent
# abort at the canonicalisation assignment under set -e.
mkdir -p "$LNK/nox"; chmod 600 "$LNK/nox"
d=$(refused "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/nox" 'refusing') && ok "an unenterable parent still gets a refusal sentence, not a silent abort" \
  || { r=$(run "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/nox"); rc=$?; [ "$rc" -eq 0 ] && [ -n "$r" ] \
       && ok "an unenterable parent is accepted with its raw path (string checks still ran)" \
       || bad "an unenterable parent aborted with no sentence" "$d rc=$rc out=[$r]"; }
chmod 700 "$LNK/nox"
r=$(run "KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=$LNK/ok"); rc=$?
[ "$rc" -eq 0 ] && [ "$r" = "$LNK/ok/AgentWorkforce" ] && ok "CONTROL: a symlink to an ordinary folder is still accepted" \
  || bad "CONTROL: a symlink to an ordinary folder is still accepted" "rc=$rc out=[$r]"
rm -rf "${LNK:?}"

# 9f. A NEWLINE (OR QUOTE, BACKTICK, DOLLAR, BACKSLASH) IS REFUSED. The value feeds a
#     grep -F pattern that gates launchctl bootout and rm -f on every agent job, and
#     grep -F reads a newline in the pattern as a pattern SEPARATOR: measured, a
#     two-line pattern matched a plist naming a DIFFERENT root. Same mechanism
#     KOSMOS_HOME is refused for at the top of setup.sh.
NL="$(printf '\n_')"; NL="${NL%_}"
# The value travels in an exported variable, not inline: a quote inlined into the
# preamble breaks the preamble's own quoting, and a syntax error reads as a refusal.
for v in "/tmp/a${NL}/tmp/b" "/tmp/it's" '/tmp/$x' '/tmp/back\\slash'; do
  export KDR_V="$v"
  d=$(refused 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA="$KDR_V"' 'newline, quote') \
    && ok "a shell-significant character is refused ($(printf '%s' "$v" | tr '\n' '|'))" \
    || bad "a shell-significant character is refused ($(printf '%s' "$v" | tr '\n' '|'))" "$d"
done

# 9g. THE CONSULT IS BOUNDED. A store.js that never returns from require would hang
#     the uninstall silently at the capture; the watchdog kills it and the helper
#     falls through to the literal. The arm is itself bounded, so a broken watchdog
#     reds rather than hangs the suite.
printf '%s\n' "while (true) {}" > "$FAKE/app/engine/store.js"
( run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA; KOSMOS_DATA_ROOT_CONSULT_SECONDS=1" > "$FAKE/hang.out" 2>/dev/null; printf '\nrc=%s\n' "$?" >> "$FAKE/hang.out" ) &
HP=$!; i=0
while kill -0 "$HP" 2>/dev/null && [ "$i" -lt 8 ]; do sleep 1; i=$((i+1)); done
if kill -0 "$HP" 2>/dev/null; then kill "$HP" 2>/dev/null; pkill -f "$FAKE/runtime/bin/node" 2>/dev/null; pkill -f "KOSMOS_HOME=$FAKE" 2>/dev/null; bad "a hanging store.js is killed by the watchdog and the helper falls back" "still running after ${i}s"
else
  hr=$(head -1 "$FAKE/hang.out"); [ "$hr" = "$EXP_DEFAULT" ] && grep -q '^rc=0$' "$FAKE/hang.out" \
    && ok "a hanging store.js is killed by the watchdog and the helper falls back (${i}s)" \
    || bad "a hanging store.js is killed by the watchdog and the helper falls back" "$(tr '\n' ' ' < "$FAKE/hang.out")"
fi
# The string "while (true)" lives in the fixture file, not in node's argv, so a pkill
# on it matched NOTHING and two hung nodes once outlived the suite at 100% CPU for
# ten minutes. node's argv[0] is the fake runtime path; the run subshell carries
# KOSMOS_HOME=$FAKE. Both are reachable.
pkill -f "$FAKE/runtime/bin/node" 2>/dev/null || true; pkill -f "KOSMOS_HOME=$FAKE" 2>/dev/null || true

# 9h. NOTHING IS LEFT BEHIND ON EITHER CONSULT OUTCOME. The first watchdog was
#     `sleep N; kill`: on success the sleep was orphaned for the rest of N, and on a
#     non-zero exit `wait` aborted the subshell under set -e before the watchdog was
#     killed. A distinctive N makes the leftover findable on a shared box.
#     ⚠️ TWO CHECKS, ONE LIVE AND ONE LATENT, said so plainly because a check that
#     cannot fail is worse than none: `leftsh` is the LIVE no-leak coverage of the
#     CURRENT poll watchdog (it sleeps 1s regardless of N and can leave a helper
#     subshell). `left` (a `sleep 37`) is a LATENT regression guard: the current
#     watchdog never spawns `sleep N`, so this half cannot fail against the code as
#     written -- it only fires if someone reintroduces the old `sleep $_kdr_secs; kill`.
#     It is kept for that regression, not counted as coverage of the present code.
cp "$(dirname "$SETUP")/../engine/store.js" "$FAKE/app/engine/store.js"
run "KOSMOS_HOME=$FAKE; export AGENT_WORKFORCE_DATA=/tmp/sbx-1511; KOSMOS_DATA_ROOT_CONSULT_SECONDS=37" >/dev/null
printf '%s\n' "module.exports = {};" > "$FAKE/app/engine/store.js"
run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA; KOSMOS_DATA_ROOT_CONSULT_SECONDS=37" >/dev/null || true
sleep 2
left=$(pgrep -fx 'sleep 37' | wc -l | tr -d ' '); leftsh=$(pgrep -f "KOSMOS_HOME=$FAKE" | wc -l | tr -d ' ')
[ "$left" = "0" ] && [ "$leftsh" = "0" ] && ok "no watchdog, sleep or helper subshell outlives the consult on either outcome" \
  || { bad "the consult left processes behind" "sleep-37=$left helper-subshells=$leftsh"; pkill -fx 'sleep 37' 2>/dev/null; pkill -f "KOSMOS_HOME=$FAKE" 2>/dev/null; }

# 11b. THE VALUE THAT REACHES A DELETING CONSUMER CAME FROM THE CONSULT, BEFORE THE
#      DELETE. The two static arms below pin the call's count and position; they
#      cannot see control flow, and a capture under a false condition satisfies both.
#      This runs the REAL uninstall on a fake install inside a box, every root pinned
#      in the box, and measures WHAT WAS DELETED: the shared-supervisor removal reads
#      "$_support/bin", so the bin under the consult's path (which the shell fallback
#      can never produce) must be gone and the bin under the literal must survive.
#      The install has runtime/bin/node and VERSION+app, so rm -rf "$KOSMOS_HOME" DOES
#      run in the box; a capture placed after it would delete the literal's bin
#      instead, which is exactly the iteration-0 defect this card records.
B="$(mktemp -d)"
box_build() {   # $1 = with-runtime | no-runtime
  rm -rf "${B:?}"/*; mkdir -p "$B/home" "$B/launch" "$B/workers" "$B/apps" "$B/sysapps" "$B/homeapps" "$B/bin" \
    "$B/data/AgentWorkforce/bin" "$B/ONLY-NODE/AgentWorkforce/bin" "$B/kh/app/engine"
  : > "$B/data/AgentWorkforce/bin/x"; : > "$B/ONLY-NODE/AgentWorkforce/bin/x"
  printf '0.0.0-test\n' > "$B/kh/VERSION"
  printf '%s\n' "module.exports = { dataRootFor: () => '$B/ONLY-NODE/AgentWorkforce' };" > "$B/kh/app/engine/store.js"
  if [ "$1" = with-runtime ]; then mkdir -p "$B/kh/runtime/bin"; ln -sf "$(command -v node)" "$B/kh/runtime/bin/node"; fi
  # An agent job whose supervisor lives under the CONSULT's root. The ownership
  # proof greps the plist for "$_support/bin/agent-supervisor.sh": with the consult
  # it matches and the job is removed; with any other derivation it is "left alone".
  printf '<plist><dict><key>ProgramArguments</key><array><string>%s/ONLY-NODE/AgentWorkforce/bin/agent-supervisor.sh</string></array></dict></plist>\n' "$B" \
    > "$B/launch/com.kosmos.agent.boxagent.plist"
}
box_uninstall() {
  ( cd "$B" && env -i PATH=/usr/bin:/bin HOME="$B/home" KOSMOS_HOME="$B/kh" AGENT_WORKFORCE_DATA="$B/data" \
      AGENT_WORKFORCE_LAUNCH="$B/launch" AGENT_WORKFORCE_WORKERS="$B/workers" \
      KOSMOS_APP_DIR="$B/apps" KOSMOS_SYS_APP_DIR="$B/sysapps" KOSMOS_HOME_APP_DIR="$B/homeapps" \
      KOSMOS_PROFILE_FILE="$B/zprofile" KOSMOS_BIN_DIR="$B/bin" KOSMOS_PORT=65000 \
      /bin/sh "$SETUP" --uninstall >"$B/out" 2>"$B/err" ); echo $?
}
box_state() { printf 'rc=%s kh=%s consult-bin=%s literal-bin=%s job=%s' "$1" "$([ -d "$B/kh" ] && echo present || echo gone)" \
  "$([ -d "$B/ONLY-NODE/AgentWorkforce/bin" ] && echo present || echo gone)" "$([ -d "$B/data/AgentWorkforce/bin" ] && echo present || echo gone)" \
  "$([ -e "$B/launch/com.kosmos.agent.boxagent.plist" ] && echo present || echo gone)"; }
box_build with-runtime
rc=$(box_uninstall)
if [ "$rc" = "0" ] && [ ! -d "$B/kh" ] && [ ! -d "$B/ONLY-NODE/AgentWorkforce/bin" ] && [ -d "$B/data/AgentWorkforce/bin" ] \
   && [ ! -e "$B/launch/com.kosmos.agent.boxagent.plist" ]; then
  ok "the real uninstall deleted the supervisor under the CONSULT's root and removed the job that named it, after the app tree it consulted was gone"
else
  bad "the real uninstall deleted the supervisor under the CONSULT's root" "$(box_state "$rc") err=[$(tail -2 "$B/err" | tr '\n' ' ')]"
fi
# CONTROL: no runtime, so the consult cannot run and the LITERAL's bin must go
# instead. Proves the arm above can tell the two apart.
box_build no-runtime
rc=$(box_uninstall)
if [ "$rc" = "0" ] && [ ! -d "$B/data/AgentWorkforce/bin" ] && [ -d "$B/ONLY-NODE/AgentWorkforce/bin" ] \
   && [ -e "$B/launch/com.kosmos.agent.boxagent.plist" ]; then
  ok "CONTROL: without a runtime the literal's supervisor went instead and the job naming the other root was left alone"
else
  bad "CONTROL: without a runtime the literal's supervisor went instead" "$(box_state "$rc") err=[$(tail -2 "$B/err" | tr '\n' ' ')]"
fi
rm -rf "${B:?}"

# 12. ONE CALL SITE. The first version captured at each consumer, and the one after
#    `rm -rf "$KOSMOS_HOME"` silently got the literal while the one before it got the
#    product's answer: two derivations in one run, the defect this card removes.
n=$(/usr/bin/grep -cF '$(_kosmos_data_root)' "$SETUP")
[ "$n" -eq 1 ] && ok "uninstall resolves the data root exactly once" \
  || bad "uninstall resolves the data root exactly once" "$n call sites"

# 13. AND THAT ONE CALL COMES BEFORE THE DELETE THAT REMOVES ITS INTERPRETER, inside
#     uninstall(). Line numbers, because the property IS an ordering.
fn=$(/usr/bin/grep -nF 'uninstall() {' "$SETUP" | head -1 | cut -d: -f1)
call=$(/usr/bin/grep -nF '$(_kosmos_data_root)' "$SETUP" | head -1 | cut -d: -f1)
# The CODE line, not a comment quoting it: anchored to the line's start and end.
del=$(/usr/bin/grep -n '^ *rm -rf "\$KOSMOS_HOME"$' "$SETUP" | head -1 | cut -d: -f1)
if [ -n "$fn" ] && [ -n "$call" ] && [ -n "$del" ] && [ "$fn" -lt "$call" ] && [ "$call" -lt "$del" ]; then
  ok "the one call sits inside uninstall() and above rm -rf KOSMOS_HOME ($fn < $call < $del)"
else
  bad "the one call sits inside uninstall() and above rm -rf KOSMOS_HOME" "uninstall=$fn call=$call delete=$del"
fi

rm -rf "$FAKE" "$HELPER"
printf '\n%s\n' "$([ "$FAIL" -eq 0 ] && echo "ALL PASS ($PASS arms)" || echo "$FAIL FAILED, $PASS passed")"
[ "$FAIL" -eq 0 ]
