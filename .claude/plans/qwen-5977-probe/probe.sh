#!/bin/bash
# probe.sh <model> <outdir>: four Codex tasks against a local Ollama model, each capped at 300 s.
set -u
MODEL="$1"; OUT="$2"; mkdir -p "$OUT"
export PATH=/opt/homebrew/bin:/usr/bin:/bin
export CODEX_HOME="$OUT/codex-home"; mkdir -p "$CODEX_HOME"
STUB="$OUT/bin"; mkdir -p "$STUB"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s/kosmos-calls.log"\necho "sent"\n' "$OUT" > "$STUB/kosmos"; chmod +x "$STUB/kosmos"
export PATH="$STUB:$PATH"
# Nothing real may be reachable: a login shell (codex runs zsh -lc) rebuilds PATH from HOME, so HOME is fake too,
# and every KOSMOS_ variable (board address, token) is dropped. Abort if a real kosmos is still found.
export HOME="$OUT/home"; mkdir -p "$HOME"
for v in $(env | sed -n "s/^\(KOSMOS_[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$v"; done
real="$(cd "$OUT" && /bin/zsh -lc "command -v kosmos" 2>/dev/null)"
if [ -n "$real" ] && [ "$real" != "$STUB/kosmos" ]; then echo "ABORT: a login shell finds a real kosmos at $real" >> "$OUT/summary.txt"; echo DONE >> "$OUT/summary.txt"; exit 1; fi
run() {
  name="$1"; prompt="$2"; wd="$OUT/wd-$name"; rm -rf "$wd"; mkdir -p "$wd"
  start=$(date +%s)
  perl -e 'alarm shift; exec @ARGV' 300 nice -n 10 codex exec --oss --local-provider ollama -m "$MODEL" \
    --skip-git-repo-check ${CODEX_EXTRA:-} --dangerously-bypass-approvals-and-sandbox -C "$wd" --json "$prompt" \
    > "$OUT/$name.jsonl" 2> "$OUT/$name.err"
  rc=$?; end=$(date +%s)
  echo "$name rc=$rc secs=$((end - start))" >> "$OUT/summary.txt"
}
run t1-answer 'What is 17 times 23? Answer with just the number.'
run t2-file 'Create a file named hello.txt in the current folder containing exactly the word hi. Then say done.'
run t3-shell 'Run the shell command `uname -s` and tell me exactly what it printed.'
run t4-kosmos 'Use the kosmos command line tool to send the message "build finished" to the room named general. The command is: '"$STUB"'/kosmos reply "build finished". Run it, then say done.'
[ -f "$OUT/wd-t2-file/hello.txt" ] && echo "t2 file: $(cat "$OUT/wd-t2-file/hello.txt")" >> "$OUT/summary.txt" || echo "t2 file: MISSING" >> "$OUT/summary.txt"
echo "t4 kosmos calls: $(cat "$OUT/kosmos-calls.log" 2>/dev/null || echo NONE)" >> "$OUT/summary.txt"
echo DONE >> "$OUT/summary.txt"
