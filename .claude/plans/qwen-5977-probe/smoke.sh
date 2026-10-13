#!/bin/bash
# smoke.sh <worktree> <outdir>: launch real codex with the exact arguments qwenaccounts.launchArgs gives a Qwen account,
# sealed like probe.sh (fake HOME, no KOSMOS_ variables), and ask for one shell command.
set -u
W="$1"; OUT="$2"; rm -rf "$OUT"; mkdir -p "$OUT/wd" "$OUT/home" "$OUT/codex-home"
export PATH=/opt/homebrew/bin:/usr/bin:/bin
for v in $(env | sed -n "s/^\(KOSMOS_[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$v"; done
export AGENT_WORKFORCE_HOME="$OUT/home"
ACCT="$OUT/home/.kosmos-qwen-local"
node -e 'require(process.argv[1]).storeEndpoint(process.argv[2], { baseUrl: "http://localhost:11434/v1", model: "kosmos-qwen2.5-7b-16k:latest", contextWindow: 16384 })' "$W/engine/qwenaccounts.js" "$ACCT"
ARGS=(); while IFS= read -r -d '' a; do ARGS+=("$a"); done < <(node "$W/engine/qwenaccounts.js" launch-args "$ACCT")
printf '%s\n' "${ARGS[@]}" > "$OUT/args.txt"
export HOME="$OUT/home" CODEX_HOME="$OUT/codex-home"
real="$(cd "$OUT" && /bin/zsh -lc 'command -v kosmos' 2>/dev/null)"; [ -n "$real" ] && { echo "ABORT real kosmos at $real" > "$OUT/summary.txt"; exit 1; }
start=$(date +%s)
perl -e 'alarm shift; exec @ARGV' 300 codex exec "${ARGS[@]}" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C "$OUT/wd" --json \
  'Run the shell command `uname -s` and tell me exactly what it printed.' > "$OUT/out.jsonl" 2> "$OUT/err.txt"
echo "rc=$? secs=$(( $(date +%s) - start ))" > "$OUT/summary.txt"
