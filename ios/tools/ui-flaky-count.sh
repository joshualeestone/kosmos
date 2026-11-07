#!/bin/bash
# kosmos#7609: the count ui-sample's retry promises. Over main's last N ios.yml runs (default 10): how many ran, went red, and how many
# times each test was FLAKY or still failed. A test FLAKY on 3 of 10 is looked at, not left. Usage: ui-flaky-count.sh [N]
set -u
R=joshualeestone/kosmos; N="${1:-10}"; T="$(mktemp)"; trap 'rm -f "$T"' EXIT
ran=0; red=0
for id in $(gh run list --repo "$R" --workflow ios.yml --branch main --limit "$N" --json databaseId --jq '.[].databaseId'); do
  job="$(gh api "repos/$R/actions/runs/$id/jobs?per_page=50" --jq '.jobs[]|select(.name|test("ui tests"))|.id' | head -1)"
  [ -n "$job" ] || continue
  out="$(gh api "repos/$R/actions/jobs/$job/logs" 2>/dev/null)" || continue
  printf '%s\n' "$out" | grep -q -E '(PASS|FAIL)  ui-sample:' || continue
  ran=$((ran + 1))
  printf '%s\n' "$out" | grep -q 'FAIL  ui-sample:' && red=$((red + 1))
  printf '%s\n' "$out" | sed -n -E 's/^[^ ]+ FLAKY ([A-Za-z0-9_.]+):.*/FLAKY \1/p' >> "$T"
  printf '%s\n' "$out" | sed -n -E 's/^[^ ]+ UI-NOTE (kosmos#[0-9]+).*/NOTE \1/p' >> "$T"
done
echo "main: $ran ui runs read, $red red"
sort "$T" | uniq -c | sort -rn
