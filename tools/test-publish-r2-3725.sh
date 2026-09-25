#!/usr/bin/env bash
# test-publish-r2-3725.sh - offline checks for tools/windows/publish-r2.ps1 (#3725).
#
# The script's real work (signed S3 reads and writes to R2, reads back through installkosmos.com)
# needs a network and a key, so it was measured by hand against a throwaway key prefix in the real
# bucket (see the PR). What this pins offline, on every run:
#   1. it parses (PowerShell's own parser, zero errors);
#   2. THE SIGNER: New-SigV4Authorization reproduces AWS's published SigV4 example for S3 (GET
#      Object, examplebucket, 20130524), so a signing change cannot pass by luck;
#   3. POINTER PARITY: the bytes New-PointerBytes writes (with the script's own $Arch and $Alias)
#      equal what tools/lib/write-latest-win-pointer.js writes for the same build. Both promotes
#      copy a staging pointer onto prod byte for byte, so a drift in either writer breaks a promote;
#   4. the refusals that need no network;
#   5. the gates and the write order, through the script's test transport (a local directory
#      as the bucket, with seams for a failing read and for a concurrent writer). Its served
#      checks read that same directory, so they pass by construction and prove nothing here;
#      the bucket read-backs are what these tests exercise.
#
# Needs pwsh. GitHub's macOS runners ship it; locally a missing pwsh SKIPS, but under CI it FAILS,
# because a guard that silently never runs is not a guard.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PS1="$HERE/windows/publish-r2.ps1"
WRITER="$HERE/lib/write-latest-win-pointer.js"
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

PWSH="$(command -v pwsh || true)"
if [ -z "$PWSH" ]; then
  if [ -n "${CI:-}" ]; then echo "FAIL pwsh is not installed on this CI runner, so publish-r2.ps1 is untested"; exit 1; fi
  echo "SKIP test-publish-r2-3725: pwsh is not installed here (CI runs it)"; exit 0
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# (pwsh -Command appends trailing words to the command text instead of binding $args, so each
# PowerShell step is a small -File script.)
cat > "$TMP/parse.ps1" <<'PSEOF'
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$e)
"errors=" + @($e).Count; $e | ForEach-Object { $_.ToString() }
PSEOF
# Loads named functions and top-level assignments OUT of the real script (no copies), so what is
# tested is what ships. Dot-sourced by the steps below.
cat > "$TMP/load.ps1" <<'PSEOF'
function Import-FromScript([string] $path, [string[]] $functions, [string[]] $variables) {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
  foreach ($v in $variables) {
    $a = $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq ('$' + $v) } | Select-Object -First 1
    if (-not $a) { throw "no top-level assignment to `$$v" }
    Set-Variable -Scope Global -Name $v -Value (& ([scriptblock]::Create($a.Right.Extent.Text)))
  }
  foreach ($f in $functions) {
    $d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $f }, $true) | Select-Object -First 1
    if (-not $d) { throw "no function $f" }
    . ([scriptblock]::Create($d.Extent.Text.Replace("function $f", "function global:$f")))
  }
}
PSEOF

# 1. parse
out="$("$PWSH" -NoProfile -File "$TMP/parse.ps1" "$PS1" 2>&1)"
if [ "$(printf '%s\n' "$out" | head -1)" = "errors=0" ]; then pass "parses"; else fail "parse: $out"; fi

# 2. the signer against AWS's published example (Signature Version 4, "Example: GET Object")
cat > "$TMP/sigv4.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('Hex', 'Sha256-Bytes', 'Hmac', 'New-SigV4Authorization') @('Utf8')
$empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
New-SigV4Authorization 'GET' 'examplebucket.s3.amazonaws.com' '/test.txt' @{ 'range' = 'bytes=0-9'; 'x-amz-content-sha256' = $empty; 'x-amz-date' = '20130524T000000Z' } $empty 'AKIAIOSFODNN7EXAMPLE' 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' '20130524T000000Z' 'us-east-1'
PSEOF
want='AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
got="$("$PWSH" -NoProfile -File "$TMP/sigv4.ps1" "$PS1" "$TMP/load.ps1" 2>&1)"
if [ "$got" = "$want" ]; then pass "SigV4 matches AWS's published GET Object example"; else fail "SigV4: got [$got]"; fi

# 3. pointer parity, both from the same inputs
V=0.6.94; SHA=d476fc6c913ee3254f8406ccad0db09724c313551203682c4ad712f51d20c2db
KM_LWP_VERSION=$V KM_LWP_SHA=$SHA KM_LWP_ARTIFACT="kosmos-win-x64.zip" KM_LWP_VERSIONED="kosmos-$V-win-x64.zip" KM_LWP_ARCH=x64 \
  node "$WRITER" "$TMP/js.json" || fail "the JS writer did not run"
cat > "$TMP/pointer.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('New-PointerBytes') @('Arch', 'Alias', 'Utf8')
[IO.File]::WriteAllBytes($args[2], (New-PointerBytes $args[3] $args[4] "kosmos-$($args[3])-win-$Arch.zip"))
PSEOF
"$PWSH" -NoProfile -File "$TMP/pointer.ps1" "$PS1" "$TMP/load.ps1" "$TMP/ps.json" "$V" "$SHA"
rc=$?
if [ "$rc" -ne 0 ]; then fail "could not run New-PointerBytes out of publish-r2.ps1 (rc $rc)"
elif cmp -s "$TMP/js.json" "$TMP/ps.json"; then pass "pointer bytes equal write-latest-win-pointer.js"
else fail "pointer bytes differ: js=$(cat "$TMP/js.json") ps=$(cat "$TMP/ps.json")"; fi

# 4. offline refusals. Each case asserts its own message, not just the exit code, because a
# refusal about something else (no key, say) also exits 1.
refuses() { # <label> <expected substring> <args...>
  local label="$1" want="$2"; shift 2
  local o rc
  # The test transport is set so a refusal that regressed can never reach the real network.
  mkdir -p "$TMP/refuse-fake"
  o="$(env -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY LOCALAPPDATA="$TMP/none" KOSMOS_PUBLISH_R2_FAKE_DIR="$TMP/refuse-fake" "$PWSH" -NoProfile -File "$PS1" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -qF -- "$want"; then pass "$label"; else fail "$label: rc=$rc out=$o"; fi
}
printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=AKIDTEST\nR2_SECRET_ACCESS_KEY=secret\n' "$(printf 'a%.0s' $(seq 32))" > "$TMP/cred.env"
refuses "bad key prefix refused" "-KeyPrefix" -Zip "$TMP/x.zip" -KeyPrefix 'no-trailing-slash'
refuses "dot-dot key prefix refused" "no . or .. segment" -Zip "$TMP/x.zip" -KeyPrefix '../'
refuses "a stand-in served base needs a test prefix" "-ServedBase is for tests" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1789228393.821399 -ServedBase https://example.com/dist
refuses "missing zip refused" "no such zip" -Zip "$TMP/absent.zip"
refuses "no key refused" "no R2_ACCOUNT_ID" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1789228393.821399
refuses "non-x.y.z version refused" "x.y.z" -Promote -ApprovedVersion '-0.6.94' -ApprovedSha "$SHA" -ApprovalRef 1789228393.821399 -CredentialFile "$TMP/cred.env"
refuses "malformed sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha nothex -ApprovalRef 1789228393.821399 -CredentialFile "$TMP/cred.env"
# PowerShell's plain -match ignores case; these must not.
refuses "UPPERCASE sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$(printf '%s' "$SHA" | tr a-f A-F)" -ApprovalRef 1789228393.821399 -CredentialFile "$TMP/cred.env"
refuses "shell-ish approval ref refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 'x; rm' -CredentialFile "$TMP/cred.env"
refuses "approval ref with a trailing newline refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef $'1789228393.821399\n' -CredentialFile "$TMP/cred.env"
# A zip whose launcher is not the committed Kosmos.exe (the refusal comes before any network).
python3 - "$TMP/wrongexe.zip" <<'PYEOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.1"}'); z.writestr('Kosmos.exe', 'MZ not the launcher')
PYEOF
refuses "a zip with another launcher refused" "is not the committed launcher" -Zip "$TMP/wrongexe.zip" -CredentialFile "$TMP/cred.env"

# 5. THE GATES AND THE ORDER, through the script's test transport (KOSMOS_PUBLISH_R2_FAKE_DIR: a
# local directory is the bucket; every request is logged to <dir>/.calls). Each refusal must
# leave ZERO writes; the happy paths must write in the order the header promises.
FAKE="$TMP/bucket"; mkdir -p "$FAKE"; VDIR="$TMP/vdir"; mkdir -p "$VDIR"; ALOG="$TMP/approvals.log"
EXE="$HERE/windows/Kosmos.exe"
mkzip() { python3 - "$1" "$2" "$EXE" "$3" <<'PYEOF'
import sys, zipfile
out, ver, exe, tag = sys.argv[1:5]
with zipfile.ZipFile(out, 'w') as z:
    z.writestr('app/package.json', '{"version":"%s"}' % ver); z.writestr('Kosmos.exe', open(exe, 'rb').read()); z.writestr('tag.txt', tag)
PYEOF
}
mkzip "$TMP/a.zip" 9.9.1 A; mkzip "$TMP/b.zip" 9.9.1 B
SHA_A=$(shasum -a 256 "$TMP/a.zip" | cut -d' ' -f1)
fake() { : > "$FAKE/.calls"; KOSMOS_PUBLISH_R2_FAKE_DIR="$FAKE" KOSMOS_WIN_VERIFY_DIR="$VDIR" KOSMOS_WIN_PROMOTE_LOG="$ALOG" "$PWSH" -NoProfile -File "$PS1" -CredentialFile "$TMP/cred.env" "$@" > "$TMP/out" 2>&1; }
# Writes to the bucket's CONTENT: publish.lock (taken and removed by every write run) is not one.
writes() { grep '^PUT ' "$FAKE/.calls" | grep -vc '^PUT publish\.lock ' || true; }
record() { node -e 'const s=require(process.argv[1]);const [v,sha,res,out]=process.argv.slice(2);const c={};for(const r of s.REQUIRED_CHECKS)c[r.id]={result:"pass"};if(res==="fail")c.msg={result:"fail"};require("fs").writeFileSync(out,JSON.stringify(s.buildRecord({version:v,sha256:sha,sourceSha:"a".repeat(40),checkResults:c,at:"2026-09-25T12:00:00Z"})))' "$HERE/lib/win-staging-record.js" 9.9.1 "$SHA_A" "$1" "$VDIR/win-staging-$SHA_A.json"; }
promote() { fake -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.821399 "$@"; }
refuses_clean() { # <label> <expected substring>   (after a fake run): refused, said why, wrote nothing
  if [ "$rc" -eq 1 ] && grep -qF -- "$2" "$TMP/out" && [ "$(writes)" -eq 0 ]; then pass "$1"; else fail "$1: rc=$rc writes=$(writes) out=$(tail -2 "$TMP/out")"; fi
}

fake -Zip "$TMP/a.zip" -DryRun; rc=$?
if [ "$rc" -eq 0 ] && [ "$(writes)" -eq 0 ] && [ ! -e "$FAKE/latest-win-staging.json" ]; then pass "a staging -DryRun writes nothing"; else fail "staging dry run: rc=$rc writes=$(writes)"; fi
fake -Zip "$TMP/a.zip"; rc=$?
order=$(grep '^PUT ' "$FAKE/.calls" | grep -v '^PUT publish\.lock ' | awk '{print $2}' | tr '\n' ' ')
if [ "$rc" -eq 0 ] && [ "$order" = "kosmos-9.9.1-win-x64.zip kosmos-9.9.1-win-x64.zip.sha256 latest-win-staging.json " ]; then pass "staging writes zip, sidecar, then the pointer LAST"
else fail "staging order: rc=$rc order=[$order] $(tail -2 "$TMP/out")"; fi
# The headers that make it safe were SENT: a create-only zip, no-cache on what gets overwritten.
if grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip \| if-none-match=\*$' "$FAKE/.calls" \
   && grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip\.sha256 \| cache-control=no-cache$' "$FAKE/.calls" \
   && grep -qE '^PUT latest-win-staging\.json \| cache-control=no-cache$' "$FAKE/.calls"; then pass "staging sends If-None-Match on the new zip and no-cache on the sidecar and pointer"
else fail "staging headers: $(cat "$FAKE/.calls")"; fi
# The next step is printed with the sha left for Josh's message to supply.
if grep -qF -- "-ApprovedSha <sha from his go>" "$TMP/out" && ! grep -qF -- "-ApprovedSha $SHA_A" "$TMP/out"; then pass "staging does not hand out the sha to paste into the approval"
else fail "staging next-step line: $(grep -F -- '-Promote' "$TMP/out")"; fi
# A same-bytes re-run (the advice after an interrupted run) keeps the versioned zip cacheable.
fake -Zip "$TMP/a.zip"; rc=$?
if [ "$rc" -eq 0 ] && grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip \| if-match="[0-9a-f]{64}"$' "$FAKE/.calls"; then pass "a same-bytes re-stage is pinned (If-Match) and stays cacheable (no no-cache)"
else fail "same-bytes re-stage headers: rc=$rc $(grep '^PUT kosmos-9.9.1-win-x64.zip ' "$FAKE/.calls")"; fi
fake -Zip "$TMP/b.zip"; rc=$?; refuses_clean "different bytes under a published version are refused, nothing written" "DIFFERENT bytes"
fake -Zip "$TMP/a.zip" -Version 9.9.2; rc=$?; refuses_clean "a -Version the zip was not built as is refused" "not the version this zip was built as"

promote; rc=$?; refuses_clean "promote with no verification record: refused, nothing written" "HOLD no verification record"
record fail; promote; rc=$?; refuses_clean "promote with a FAILING record: refused, nothing written" "does not pass (FAIL"
record pass
fake -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$(printf 'b%.0s' $(seq 64))" -ApprovalRef 1789228393.821399; rc=$?
refuses_clean "a promote whose sha is not the staged one: refused, nothing written" "check his message"
if ! grep -qF "$SHA_A" "$TMP/out"; then pass "that refusal does not print the staged sha"; else fail "the mismatch refusal printed the staged sha"; fi
promote -DryRun; rc=$?
if [ "$rc" -eq 0 ] && [ "$(writes)" -eq 0 ] && [ ! -e "$ALOG" -o ! -s "$ALOG" ]; then pass "a promote -DryRun writes nothing and logs nothing"; else fail "promote dry run: rc=$rc writes=$(writes) log=$(cat "$ALOG" 2>/dev/null)"; fi
: > "$FAKE/.calls"; mkdir -p "$TMP/notafile"
KOSMOS_PUBLISH_R2_FAKE_DIR="$FAKE" KOSMOS_WIN_VERIFY_DIR="$VDIR" KOSMOS_WIN_PROMOTE_LOG="$TMP/notafile" "$PWSH" -NoProfile -File "$PS1" -CredentialFile "$TMP/cred.env" -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.821399 > "$TMP/out" 2>&1; rc=$?
refuses_clean "a promote whose approval cannot be logged: refused, nothing written" "an approval that is not logged is not given"
cp "$FAKE/latest-win-staging.json" "$TMP/ptr.good"
printf '{"version":"9.9.1","sha256":"%s","artifact":"kosmos-9.9.1-win-x64.zip","versioned":"kosmos-9.9.1-win-x64.zip","arch":"x64"}\n' "$SHA_A" > "$FAKE/latest-win-staging.json"
promote; rc=$?; refuses_clean "promote of a non-canonical staging pointer: refused, nothing written" "canonical pointer shape"
cp "$TMP/ptr.good" "$FAKE/latest-win-staging.json"
cp "$FAKE/kosmos-9.9.1-win-x64.zip.sha256" "$TMP/side.good"; printf '%s  wrong-name.zip\n' "$SHA_A" > "$FAKE/kosmos-9.9.1-win-x64.zip.sha256"
promote; rc=$?; refuses_clean "promote with a wrong versioned sidecar: refused, nothing written" "kosmos-9.9.1-win-x64.zip.sha256 as"
cp "$TMP/side.good" "$FAKE/kosmos-9.9.1-win-x64.zip.sha256"
: > "$ALOG"
promote; rc=$?
order=$(grep '^PUT ' "$FAKE/.calls" | grep -v '^PUT publish\.lock ' | awk '{print $2 ($3 == "COPY" ? "(copy)" : "")}' | tr '\n' ' ')
if [ "$rc" -eq 0 ] && [ "$order" = "kosmos-win-x64.zip(copy) kosmos-win-x64.zip.sha256 latest-win.json " ] \
   && cmp -s "$FAKE/latest-win.json" "$FAKE/latest-win-staging.json" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip"; then
  pass "promote writes the alias copy, its sidecar, then latest-win.json LAST (the staging bytes verbatim)"
else fail "promote order: rc=$rc order=[$order] $(tail -2 "$TMP/out")"; fi
if [ "$(grep -c 'approval=given.*transport=test' "$ALOG")" -eq 1 ] && [ "$(grep -c 'promoted=yes.*transport=test' "$ALOG")" -eq 1 ]; then pass "both approval-log lines name where the promote wrote"
else fail "approval log: $(cat "$ALOG")"; fi
# The promote's copy carried its pin and its own no-cache metadata.
if grep -qE '^PUT kosmos-win-x64\.zip COPY /kosmos-dist-win/kosmos-9\.9\.1-win-x64\.zip \| cache-control=no-cache;x-amz-copy-source=[^;]+;x-amz-copy-source-if-match="[0-9a-f]{64}";x-amz-metadata-directive=REPLACE$' "$FAKE/.calls"; then pass "the alias copy is pinned and replaces its metadata with no-cache"
else fail "copy headers: $(grep COPY "$FAKE/.calls")"; fi
# -ReplaceVersioned never replaces what prod names.
fake -Zip "$TMP/b.zip" -ReplaceVersioned; rc=$?; refuses_clean "-ReplaceVersioned refuses the version prod names" "PROD's latest-win.json names"
# A staging failure after its writes began says what may be up.
: > "$FAKE/.calls"; mkzip "$TMP/c.zip" 9.9.2 C
KOSMOS_PUBLISH_R2_FAKE_FAIL=latest-win-staging.json fake -Zip "$TMP/c.zip"; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "staging writes had begun" "$TMP/out"; then pass "a staging failure after its first write says what may be up"
else fail "staging partial-state note: rc=$rc $(tail -2 "$TMP/out")"; fi
# -ReplaceVersioned, the write itself: pinned (If-Match) and no-cache when it succeeds; a
# stale pin refuses; a promote landing mid-replace gets the previous bytes put back.
mkzip "$TMP/r1.zip" 9.9.4 R1; mkzip "$TMP/r2.zip" 9.9.4 R2; mkzip "$TMP/r3.zip" 9.9.4 R3
cp "$FAKE/latest-win-staging.json" "$TMP/staging.keep"
fake -Zip "$TMP/r1.zip" >/dev/null; fake -Zip "$TMP/r2.zip" -ReplaceVersioned; rc=$?
if [ "$rc" -eq 0 ] && grep -qE '^PUT kosmos-9\.9\.4-win-x64\.zip \| cache-control=no-cache;if-match="[0-9a-f]{64}"$' "$FAKE/.calls"; then pass "a replace is pinned with If-Match and stored no-cache"
else fail "replace headers: rc=$rc $(grep '^PUT kosmos-9.9.4-win-x64.zip ' "$FAKE/.calls") $(tail -1 "$TMP/out")"; fi
KOSMOS_PUBLISH_R2_FAKE_AFTER="GET kosmos-9.9.4-win-x64.zip|kosmos-9.9.4-win-x64.zip|$TMP/r1.zip" fake -Zip "$TMP/r3.zip" -ReplaceVersioned; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "answered 412" "$TMP/out"; then pass "a replace whose pin went stale (a concurrent staging) refuses"
else fail "stale replace pin: rc=$rc $(tail -1 "$TMP/out")"; fi
cp "$TMP/r2.zip" "$FAKE/kosmos-9.9.4-win-x64.zip"; SHA_R2=$(shasum -a 256 "$TMP/r2.zip" | cut -d' ' -f1)
printf '{"version":"9.9.4","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"kosmos-9.9.4-win-x64.zip","arch":"x64"}\n' "$SHA_R2" > "$TMP/prod-944.json"
cp "$FAKE/latest-win.json" "$TMP/prod.keep" 2>/dev/null || : > "$TMP/prod.keep"
KOSMOS_PUBLISH_R2_FAKE_AFTER="GET latest-win.json|latest-win.json|$TMP/prod-944.json" fake -Zip "$TMP/r3.zip" -ReplaceVersioned; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "a promote landed in between" "$TMP/out" && grep -qF "The replace was undone" "$TMP/out" && cmp -s "$FAKE/kosmos-9.9.4-win-x64.zip" "$TMP/r2.zip"; then pass "a promote landing mid-replace: the previous bytes are put back and the replace refuses"
else fail "replace/promote race: rc=$rc zip-restored=$(cmp -s "$FAKE/kosmos-9.9.4-win-x64.zip" "$TMP/r2.zip" && echo yes || echo no) $(tail -1 "$TMP/out")"; fi
if [ -s "$TMP/prod.keep" ]; then cp "$TMP/prod.keep" "$FAKE/latest-win.json"; else rm -f "$FAKE/latest-win.json"; fi
# ...and the put-back itself is pinned: a staging that landed after this replace's upload is
# not reverted (the put-back answers 412 and says so).
cp "$TMP/r2.zip" "$FAKE/kosmos-9.9.4-win-x64.zip"
KOSMOS_PUBLISH_R2_FAKE_AFTER="GET latest-win.json|latest-win.json|$TMP/prod-944.json
PUT kosmos-9.9.4-win-x64.zip|kosmos-9.9.4-win-x64.zip|$TMP/r1.zip" fake -Zip "$TMP/r3.zip" -ReplaceVersioned; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "PUTTING THE PREVIOUS BYTES BACK FAILED (412)" "$TMP/out" && ! grep -qF "The replace was undone" "$TMP/out"; then pass "the replace put-back is pinned: a newer staging is not reverted"
else fail "replace put-back pin: rc=$rc $(tail -1 "$TMP/out")"; fi
cp "$TMP/r2.zip" "$FAKE/kosmos-9.9.4-win-x64.zip"
cp "$TMP/staging.keep" "$FAKE/latest-win-staging.json"
# An AMBIGUOUS record (not a pass, not a fail: unparseable) refuses, nothing written.
cp "$VDIR/win-staging-$SHA_A.json" "$TMP/record.keep"; printf 'not json' > "$VDIR/win-staging-$SHA_A.json"
promote; rc=$?; refuses_clean "an unreadable verification record refuses with nothing written" "AMBIGUOUS"
cp "$TMP/record.keep" "$VDIR/win-staging-$SHA_A.json"
# The bucket gives no ETag for the staged zip: the copy cannot be pinned, so no promote.
KOSMOS_PUBLISH_R2_FAKE_NO_ETAG=kosmos-9.9.1-win-x64.zip promote; rc=$?; refuses_clean "a staged zip with no ETag refuses the promote" "gave no ETag"
# The approval arguments alone do not select a promote.
fake -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.821399; rc=$?; refuses_clean "approval arguments without -Promote refuse" "pass -Promote explicitly"
# A zip with two entries of one name is refused (the check could read one, Explorer the other).
python3 - "$TMP/dup.zip" "$EXE" <<'PYEOF'
import sys, zipfile, warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.5"}'); z.writestr('Kosmos.exe', open(sys.argv[2], 'rb').read()); z.writestr('Kosmos.exe', 'MZ other')
PYEOF
fake -Zip "$TMP/dup.zip"; rc=$?; refuses_clean "a zip with duplicate entries is refused" "duplicate entries"
# A garbage prod pointer means -ReplaceVersioned cannot rule out that prod names the version.
cp "$FAKE/latest-win-staging.json" "$TMP/staging.keep2"; mkzip "$TMP/g1.zip" 9.9.6 G1; mkzip "$TMP/g2.zip" 9.9.6 G2; fake -Zip "$TMP/g1.zip" >/dev/null
cp "$FAKE/latest-win.json" "$TMP/prod.keep2"; printf 'garbage' > "$FAKE/latest-win.json"
fake -Zip "$TMP/g2.zip" -ReplaceVersioned; rc=$?; refuses_clean "-ReplaceVersioned with an unreadable prod pointer refuses" "cannot be read"
cp "$TMP/prod.keep2" "$FAKE/latest-win.json"
# A re-run of an interrupted replace (same bytes now) keeps the replaced zip no-cache.
fake -Zip "$TMP/g2.zip" -ReplaceVersioned; cp "$TMP/out" "$TMP/replace.out"; fake -Zip "$TMP/g2.zip"; rc=$?
if [ "$rc" -eq 0 ] && grep -qE '^PUT kosmos-9\.9\.6-win-x64\.zip \| cache-control=no-cache;if-match=' "$FAKE/.calls"; then pass "re-staging a replaced zip's same bytes keeps it no-cache"
else fail "replace re-run cache-control: rc=$rc $(grep '^PUT kosmos-9.9.6-win-x64.zip ' "$FAKE/.calls") [the replace said: $(tail -1 "$TMP/replace.out")]"; fi
cp "$TMP/staging.keep2" "$FAKE/latest-win-staging.json"
# Prod names 9.9.7 at another sha and the versioned zip is ABSENT: a plain stage of different
# 9.9.7 bytes must refuse (it would pin a sidecar every prod updater then refuses).
cp "$FAKE/latest-win.json" "$TMP/prod.keep3" 2>/dev/null || : > "$TMP/prod.keep3"
printf '{"version":"9.9.7","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"kosmos-9.9.7-win-x64.zip","arch":"x64"}\n' "$(printf 'c%.0s' $(seq 64))" > "$FAKE/latest-win.json"
mkzip "$TMP/p97.zip" 9.9.7 P; fake -Zip "$TMP/p97.zip"; rc=$?
refuses_clean "a stage of different bytes under the version PROD names refuses, even with no zip there" "PROD's latest-win.json names"
if [ -s "$TMP/prod.keep3" ]; then cp "$TMP/prod.keep3" "$FAKE/latest-win.json"; else rm -f "$FAKE/latest-win.json"; fi
# A rounded ts (what PowerShell makes of an unquoted one) is refused, not logged.
fake -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.8214; rc=$?
refuses_clean "a rounded (unquoted) Slack ts is refused" "10 digits . 6 digits"
# A signed read that is neither 200 nor 404 is a refusal, never "nothing there".
mkzip "$TMP/d.zip" 9.9.3 D
KOSMOS_PUBLISH_R2_FAKE_GET_STATUS=kosmos-9.9.3-win-x64.zip:403 fake -Zip "$TMP/d.zip"; rc=$?
refuses_clean "a 403 on the existence read refuses with nothing written" "answered 403"
# Staging moves between the promote's first read and its re-check: refused, nothing written.
cp "$FAKE/latest-win-staging.json" "$TMP/ptr.keep"; printf '{"moved":1}\n' > "$TMP/ptr.moved"
KOSMOS_PUBLISH_R2_FAKE_AFTER="GET latest-win-staging.json|latest-win-staging.json|$TMP/ptr.moved" promote; rc=$?
refuses_clean "staging moving during the promote is refused with nothing written" "changed while the promote was checking"
cp "$TMP/ptr.keep" "$FAKE/latest-win-staging.json"
# The alias is corrupted right after the copy: latest-win.json must NOT move.
cp "$FAKE/latest-win.json" "$TMP/prod.before" 2>/dev/null || : > "$TMP/prod.before"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-win-x64.zip|kosmos-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "the bucket holds kosmos-win-x64.zip as" "$TMP/out" && ! grep -q '^PUT latest-win.json ' "$FAKE/.calls"; then pass "an alias that does not read back stops the promote before latest-win.json"
else fail "alias read-back: rc=$rc $(grep '^PUT' "$FAKE/.calls" | tr '\n' ' ') $(tail -1 "$TMP/out")"; fi
# A -ReplaceVersioned landing right AFTER the pointer write: the promote sees it, puts prod's
# previous latest-win.json back, and refuses. Prod never names bytes it does not hold.
# (The previous release's pointer names its zip's REAL sha: an undo restores the alias only from
# bytes that match what the previous pointer announced.)
printf '{"version":"9.9.0","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"kosmos-9.9.0-win-x64.zip","arch":"x64"}\n' "$SHA_A" > "$FAKE/latest-win.json"
cp "$FAKE/latest-win.json" "$TMP/prod.before"; cp "$TMP/a.zip" "$FAKE/kosmos-9.9.0-win-x64.zip"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "changed right after latest-win.json named them" "$TMP/out" && cmp -s "$FAKE/latest-win.json" "$TMP/prod.before"; then pass "a replace landing after the pointer write: prod's previous pointer is put back"
else fail "post-pointer race: rc=$rc prod-restored=$(cmp -s "$FAKE/latest-win.json" "$TMP/prod.before" && echo yes || echo no) $(tail -1 "$TMP/out")"; fi
cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"
# ...and landing between the alias writes and the pointer write: the pointer is never written.
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-win-x64.zip.sha256|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "latest-win.json was NOT written" "$TMP/out" && ! grep -qF "BACK FAILED" "$TMP/out" && grep -qF "the alias restored" "$TMP/out" && cmp -s "$FAKE/latest-win.json" "$TMP/prod.before"; then pass "a replace landing before the pointer write: the pointer is never written, the alias is put back, no false restore failure"
else fail "pre-pointer race: rc=$rc prod-unchanged=$(cmp -s "$FAKE/latest-win.json" "$TMP/prod.before" && echo yes || echo no) $(tail -1 "$TMP/out")"; fi
cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"
# The alias copy is pinned to the zip the promote checked: a re-stage that lands between the
# checks and the copy must stop the promote before prod's pointer moves.
rm -f "$FAKE/kosmos-win-x64.zip" "$FAKE/kosmos-win-x64.zip.sha256" "$FAKE/latest-win.json"
KOSMOS_PUBLISH_R2_FAKE_RESTAGE_BEFORE_COPY="$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "COPY kosmos-9.9.1-win-x64.zip -> kosmos-win-x64.zip answered 412" "$TMP/out" && [ ! -e "$FAKE/latest-win.json" ] && [ ! -e "$FAKE/kosmos-win-x64.zip" ]; then pass "a re-stage between the checks and the copy stops the promote before prod moves"
else fail "ETag pin: rc=$rc latest-win.json=$([ -e "$FAKE/latest-win.json" ] && echo WRITTEN || echo absent) $(tail -2 "$TMP/out")"; fi
cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"
# The undo, with a previous release whose bytes DIFFER from this one (so a restore that copies
# the wrong thing, or nothing, cannot pass): pointer, alias and alias sidecar all come back
# byte for byte, each PUT is pinned to what this run wrote, and the alias copy is checked first.
mkzip "$TMP/old.zip" 9.9.0 OLD; SHA_OLD=$(shasum -a 256 "$TMP/old.zip" | cut -d' ' -f1)
undo_setup() {
  printf '{"version":"9.9.0","sha256":"%s","artifact":"kosmos-win-x64.zip","versioned":"kosmos-9.9.0-win-x64.zip","arch":"x64"}\n' "$SHA_OLD" > "$FAKE/latest-win.json"
  cp "$TMP/old.zip" "$FAKE/kosmos-9.9.0-win-x64.zip"; cp "$TMP/old.zip" "$FAKE/kosmos-win-x64.zip"
  printf '%s  kosmos-win-x64.zip\n' "$SHA_OLD" > "$FAKE/kosmos-win-x64.zip.sha256"
  cp "$FAKE/latest-win.json" "$TMP/u.ptr"; cp "$FAKE/kosmos-win-x64.zip.sha256" "$TMP/u.side"
  cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"
}
undo_restored() { cmp -s "$FAKE/latest-win.json" "$TMP/u.ptr" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/old.zip" && cmp -s "$FAKE/kosmos-win-x64.zip.sha256" "$TMP/u.side"; }
undo_state() { printf 'ptr=%s alias=%s side=%s' "$(cmp -s "$FAKE/latest-win.json" "$TMP/u.ptr" && echo old || echo NEW)" "$(cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/old.zip" && echo old || echo NEW)" "$(cmp -s "$FAKE/kosmos-win-x64.zip.sha256" "$TMP/u.side" && echo old || echo NEW)"; }
# pinned: the restore PUTs carry if-match, and a HEAD of the alias comes before the undo's COPY.
undo_pinned() { # <pointer-too: yes|no>
  if [ "$1" = yes ]; then grep -qE '^PUT latest-win\.json \| cache-control=no-cache;if-match="[0-9a-f]{64}"$' "$FAKE/.calls" || return 1; fi
  # The LAST sidecar PUT is the undo's (the forward one comes first): it must be pinned itself.
  [ "$(grep -c '^PUT kosmos-win-x64\.zip\.sha256 ' "$FAKE/.calls")" -ge 2 ] || return 1
  grep '^PUT kosmos-win-x64\.zip\.sha256 ' "$FAKE/.calls" | tail -n 1 | grep -qE '\| cache-control=no-cache;if-match="[0-9a-f]{64}"$' || return 1
  awk '/^HEAD kosmos-win-x64\.zip /{h=NR} /^PUT kosmos-win-x64\.zip COPY \/[^ ]*kosmos-9\.9\.0-win-x64\.zip .*x-amz-copy-source-if-match="[0-9a-f]{64}"/{c=NR} END{exit !(h && c && h < c)}' "$FAKE/.calls"
}
undo_setup
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && undo_restored && undo_pinned yes && ! grep -qF "FAILED" "$TMP/out"; then pass "undo after the pointer write: pointer, alias and sidecar restored to the DIFFERENT previous bytes, each pinned"
else fail "post-pointer undo: rc=$rc $(undo_state) pinned=$(undo_pinned yes && echo yes || echo no) $(tail -1 "$TMP/out")"; fi
undo_setup
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-win-x64.zip.sha256|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && undo_restored && undo_pinned no && ! grep -q '^PUT latest-win\.json ' "$FAKE/.calls"; then pass "undo before the pointer write: alias and sidecar restored to the DIFFERENT previous bytes, pinned; the pointer never written"
else fail "pre-pointer undo: rc=$rc $(undo_state) pinned=$(undo_pinned no && echo yes || echo no) $(tail -1 "$TMP/out")"; fi
# The pointer cannot be put back (someone else wrote it after this run): the alias and its
# sidecar are left matching the live pointer, and the report says the pointer is still live.
undo_setup; printf '{"someone":"else"}\n' > "$TMP/other.json"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip
PUT latest-win.json|latest-win.json|$TMP/other.json" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "latest-win.json was rewritten by someone else since, and is left as it is" "$TMP/out" && ! grep -qF "SO PROD STILL NAMES" "$TMP/out" && ! grep -qF "consistently" "$TMP/out" && grep -qF "the alias and its sidecar left as written" "$TMP/out" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip" && ! awk '/^PUT latest-win\.json /{p=1; next} p && /^PUT kosmos-win-x64\.zip/{f=1} END{exit !f}' "$FAKE/.calls"; then pass "a pointer someone else rewrote is left alone, the alias with it, and the report says so truthfully"
else fail "undo with a lost pointer: rc=$rc alias=$(cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip" && echo new || echo CHANGED) $(tail -1 "$TMP/out")"; fi
# Someone else rewrote the alias after this run read it back: the undo leaves THEIR alias alone
# (R2 ignores a COPY's destination If-Match, so the HEAD check is all that protects it).
undo_setup; mkzip "$TMP/theirs.zip" 9.9.8 THEIRS
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip
PUT latest-win.json|kosmos-win-x64.zip|$TMP/theirs.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/theirs.zip" && grep -qF "the alias and its sidecar left as they are (the alias is not ours any more" "$TMP/out" && ! grep -qF "consistently" "$TMP/out" && cmp -s "$FAKE/latest-win.json" "$TMP/u.ptr"; then pass "the undo does not overwrite an alias someone else wrote since"
else fail "undo vs a newer alias: rc=$rc alias=$(cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/theirs.zip" && echo theirs || echo OVERWRITTEN) $(tail -1 "$TMP/out")"; fi
# Someone else writes the alias right after this promote's copy: the read-back sees it, and the
# alias and its sidecar go back to the previous release (the pointer never moved), not left foreign.
undo_setup
# (Triggered by the sidecar write, which follows the copy: a trigger on the alias key would also
# fire on the undo's own copy back, AFTER fires on every match.)
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-win-x64.zip.sha256|kosmos-win-x64.zip|$TMP/theirs.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "not what this promote wrote; latest-win.json was NOT written" "$TMP/out" && undo_restored; then pass "an alias that reads back foreign is put back to the previous release, the pointer untouched"
else fail "alias read-back undo: rc=$rc $(undo_state) $(tail -1 "$TMP/out")"; fi
# The alias sidecar write is pinned: to the sidecar read at the start, or to its absence.
undo_setup; promote >/dev/null
if grep -qE '^PUT kosmos-win-x64\.zip\.sha256 \| cache-control=no-cache;if-match="[0-9a-f]{64}"$' "$FAKE/.calls"; then pass "the alias sidecar write is pinned to the sidecar the promote read"
else fail "sidecar pin: $(grep '^PUT kosmos-win-x64.zip.sha256' "$FAKE/.calls" | head -1)"; fi
undo_setup; rm -f "$FAKE/kosmos-win-x64.zip.sha256"; promote >/dev/null
if grep -qE '^PUT kosmos-win-x64\.zip\.sha256 \| cache-control=no-cache;if-none-match=\*$' "$FAKE/.calls"; then pass "with no sidecar yet, its write is pinned to its absence"
else fail "sidecar absent pin: $(grep '^PUT kosmos-win-x64.zip.sha256' "$FAKE/.calls" | head -1)"; fi

# A clean undo says prod is back on the previous release; only then.
undo_setup
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && undo_restored && grep -qF "Prod is back on the previous release, consistently." "$TMP/out"; then pass "a clean undo, and only a clean one, says prod is consistent"
else fail "clean undo claim: rc=$rc $(undo_state) $(tail -1 "$TMP/out")"; fi
# No alias sidecar before this promote: the undo REBUILDS it from the previous pointer, so the
# restored alias is described by its own release, not by this build.
undo_setup; rm -f "$FAKE/kosmos-win-x64.zip.sha256"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && undo_restored && grep -qF "consistently" "$TMP/out"; then pass "with no previous sidecar the undo writes the previous release's, so the pair agrees"
else fail "undo with no previous sidecar: rc=$rc $(undo_state) $(tail -1 "$TMP/out")"; fi
# A STALE previous sidecar (left by an earlier promote whose pointer write failed) names another
# release: the undo must not copy it back; it rebuilds the sidecar from the previous pointer.
undo_setup; printf '%s  kosmos-win-x64.zip\n' "$SHA_A" > "$FAKE/kosmos-win-x64.zip.sha256"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && undo_restored && grep -qF "consistently" "$TMP/out"; then pass "a stale previous sidecar is not restored: the pair is rebuilt to agree"
else fail "undo with a stale previous sidecar: rc=$rc $(undo_state) $(tail -1 "$TMP/out")"; fi
# The previous release's zip no longer matches its pointer: the alias is NOT restored from it.
undo_setup; cp "$TMP/b.zip" "$FAKE/kosmos-9.9.0-win-x64.zip"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "is not the previous release's bytes any more" "$TMP/out" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip" && ! grep -qF "consistently" "$TMP/out"; then pass "a previous zip that no longer matches its pointer is not copied onto the alias"
else fail "undo with a changed previous zip: rc=$rc alias=$(cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip" && echo new || echo CHANGED) $(tail -1 "$TMP/out")"; fi
cp "$TMP/old.zip" "$FAKE/kosmos-9.9.0-win-x64.zip"
# Only the ALIAS changes after the pointer write (the versioned zip is intact): still undone.
undo_setup
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-win-x64.zip|$TMP/theirs.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && cmp -s "$FAKE/latest-win.json" "$TMP/u.ptr" && grep -qF "changed right after latest-win.json named them" "$TMP/out"; then pass "an alias changed after the pointer write puts the pointer back"
else fail "post-pointer alias change: rc=$rc ptr=$(cmp -s "$FAKE/latest-win.json" "$TMP/u.ptr" && echo old || echo NEW) $(tail -1 "$TMP/out")"; fi
# Someone else writes the POINTER during this promote: it is never overwritten (If-Match), and
# this promote's alias writes are undone.
undo_setup
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-win-x64.zip.sha256|latest-win.json|$TMP/other.json" promote; rc=$?
if [ "$rc" -eq 1 ] && cmp -s "$FAKE/latest-win.json" "$TMP/other.json" && grep -qF "so it was NOT overwritten" "$TMP/out" && grep -qF "still hold THIS build" "$TMP/out" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip"; then pass "a pointer written by someone else mid-promote is not overwritten, and the refusal says the alias holds this build"
else fail "pointer race: rc=$rc ptr=$(cmp -s "$FAKE/latest-win.json" "$TMP/other.json" && echo theirs || echo OVERWRITTEN) $(undo_state) $(tail -1 "$TMP/out")"; fi
# A pointer with no ETag cannot be pinned: refused before any write.
undo_setup
KOSMOS_PUBLISH_R2_FAKE_NO_ETAG=latest-win.json promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "cannot pin its writes" "$TMP/out" && ! grep -E '^(PUT|DELETE) ' "$FAKE/.calls" | grep -qv ' publish\.lock '; then pass "an unpinnable prod pointer is refused before any write"
else fail "no-ETag pointer: rc=$rc writes=$(grep -cE '^(PUT|DELETE) ' "$FAKE/.calls") $(tail -1 "$TMP/out")"; fi
undo_setup

# The first promote ever (no previous pointer): the undo removes the pointer it wrote, and says
# the alias still holds this build rather than claiming a restore.
undo_setup; rm -f "$FAKE/latest-win.json" "$FAKE/kosmos-win-x64.zip" "$FAKE/kosmos-win-x64.zip.sha256"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && [ ! -e "$FAKE/latest-win.json" ] && grep -qF "latest-win.json removed (there was no previous one)" "$TMP/out" && grep -qF "no previous release to restore them from" "$TMP/out" && awk '/^HEAD latest-win\.json /{h=NR} /^DELETE latest-win\.json /{d=NR} END{exit !(h && d && h < d)}' "$FAKE/.calls"; then pass "undo of a first-ever promote removes the pointer (checked first) and claims no restore"
else fail "first-promote undo: rc=$rc latest-win.json=$([ -e "$FAKE/latest-win.json" ] && echo PRESENT || echo absent) $(tail -1 "$TMP/out")"; fi
# ...and if someone else's pointer is there by then, it is NOT removed (R2 ignores If-Match on
# DELETE, so the check is all that protects it).
undo_setup; rm -f "$FAKE/latest-win.json" "$FAKE/kosmos-win-x64.zip" "$FAKE/kosmos-win-x64.zip.sha256"
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win.json|kosmos-9.9.1-win-x64.zip|$TMP/b.zip
PUT latest-win.json|latest-win.json|$TMP/other.json" promote; rc=$?
if [ "$rc" -eq 1 ] && cmp -s "$FAKE/latest-win.json" "$TMP/other.json" && ! grep -q '^DELETE latest-win\.json' "$FAKE/.calls" && grep -qF "rewritten by someone else since" "$TMP/out" && ! grep -qF "consistently" "$TMP/out"; then pass "a first-ever undo does not delete a pointer someone else wrote since"
else fail "first-promote undo vs a newer pointer: rc=$rc $(grep '^DELETE' "$FAKE/.calls") $(tail -1 "$TMP/out")"; fi
cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"; undo_setup
# A zip whose duplicate differs only by case or slash is refused too (Windows extracts both to one file).
python3 - "$TMP/dupcase.zip" "$EXE" <<'PYEOF'
import sys, zipfile, warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.5"}'); z.writestr('Kosmos.exe', open(sys.argv[2], 'rb').read()); z.writestr('KOSMOS.EXE', 'MZ other')
PYEOF
fake -Zip "$TMP/dupcase.zip"; rc=$?; refuses_clean "a zip with a case-only duplicate is refused" "duplicate entries"
python3 - "$TMP/dupslash.zip" "$EXE" <<'PYEOF'
import sys, zipfile, warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.5"}'); z.writestr('Kosmos.exe', open(sys.argv[2], 'rb').read())
    z.writestr('app/x.js', 'a'); z.writestr('app\\x.js', 'b')
PYEOF
fake -Zip "$TMP/dupslash.zip"; rc=$?; refuses_clean "a zip with a slash-only duplicate is refused" "duplicate entries"
# The staged pointer must name Josh's go EXACTLY: the same sha in capitals is a different
# string and refused by this comparison itself (case-sensitive), not only by a later check.
cp "$FAKE/latest-win-staging.json" "$TMP/staging.case"
python3 -c 'import sys,re;p=sys.argv[1];s=open(p).read();open(p,"w").write(re.sub(r"\"sha256\":\"([0-9a-f]{64})\"",lambda m:"\"sha256\":\""+m.group(1).upper()+"\"",s))' "$FAKE/latest-win-staging.json"
promote; rc=$?
refuses_clean "a staging pointer naming the approved sha in capitals is refused" "the staging pointer names version"
cp "$TMP/staging.case" "$FAKE/latest-win-staging.json"
# One run at a time: every write run takes publish.lock (If-None-Match) before it reads, and
# removes it on every exit, refused or not.
[ ! -e "$FAKE/publish.lock" ] && pass "no publish.lock is left behind by the runs above" || fail "a run left publish.lock behind: $(cat "$FAKE/publish.lock")"
cp "$FAKE/latest-win-staging.json" "$TMP/staging.lock-keep"   # the stages below move it
: > "$FAKE/.calls"; mkzip "$TMP/lk.zip" 9.9.9 LK; fake -Zip "$TMP/lk.zip"; rc=$?
if [ "$rc" -eq 0 ] && grep -qE '^PUT publish\.lock \| cache-control=no-cache;if-none-match=\*$' "$FAKE/.calls" && [ "$(grep -n '' "$FAKE/.calls" | grep -m1 -E '^[0-9]+:(GET|PUT) ' | cut -d: -f2- | cut -c1-16)" = "PUT publish.lock" ] && [ ! -e "$FAKE/publish.lock" ]; then pass "a stage takes publish.lock (If-None-Match) before any other request and removes it"
else fail "stage lock: rc=$rc first=$(grep -m1 -E '^(GET|PUT) ' "$FAKE/.calls") lock=$([ -e "$FAKE/publish.lock" ] && echo LEFT || echo gone)"; fi
printf 'run=other mode=promote started=2026-09-25T20:00:00Z host=PC\n' > "$FAKE/publish.lock"
mkzip "$TMP/lk2.zip" 9.9.10 LK2; fake -Zip "$TMP/lk2.zip"; rc=$?
refuses_clean "a stage while another run holds publish.lock is refused" "another publish run holds publish.lock (run=other"
[ -e "$FAKE/publish.lock" ] && grep -qF 'run=other' "$FAKE/publish.lock" && pass "a refused run leaves ANOTHER run's lock alone" || fail "the other run's lock was removed or changed"
promote; rc=$?
refuses_clean "a promote while another run holds publish.lock is refused" "another publish run holds publish.lock"
fake -Zip "$TMP/lk2.zip" -DryRun; rc=$?
if [ "$rc" -eq 0 ] && grep -qF "DRY RUN: another publish run holds publish.lock (run=other" "$TMP/out" && grep -qF 'run=other' "$FAKE/publish.lock"; then pass "a dry run says a held lock would refuse the real run, and leaves it"
else fail "dry-run lock: rc=$rc $(tail -1 "$TMP/out")"; fi
printf 'run=young mode=stage started=%s host=PC\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP/young.lock"; cp "$FAKE/publish.lock" "$TMP/old.lock"; cp "$TMP/young.lock" "$FAKE/publish.lock"
fake -Zip "$TMP/lk2.zip" -BreakLock; rc=$?
refuses_clean "-BreakLock refuses a lock younger than 35 minutes (its run may be alive)" "less than 35 minutes ago may still be working"
cmp -s "$FAKE/publish.lock" "$TMP/young.lock" && pass "a young lock is left in place" || fail "a young lock was removed"
cp "$TMP/old.lock" "$FAKE/publish.lock"
fake -Zip "$TMP/lk2.zip" -BreakLock; rc=$?
if [ "$rc" -eq 0 ] && grep -qE "breaking the lock \([0-9,]+ minutes old\): run=other" "$TMP/out" && [ ! -e "$FAKE/publish.lock" ]; then pass "-BreakLock removes an OLD lock, says whose and how old, and proceeds"
else fail "-BreakLock: rc=$rc lock=$([ -e "$FAKE/publish.lock" ] && echo LEFT || echo gone) $(tail -1 "$TMP/out")"; fi
# A lock swapped for ANOTHER run's while this run works (broken under it): before its next write
# the heartbeat finds it is not this run's and stops; on the way out it never deletes the other
# run's lock, and says the guarantee was broken.
printf 'run=thief mode=stage started=2026-09-25T20:00:00Z host=PC2\n' > "$TMP/thief.lock"
mkzip "$TMP/lk3.zip" 9.9.11 LK3
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT kosmos-9.9.11-win-x64.zip|publish.lock|$TMP/thief.lock" fake -Zip "$TMP/lk3.zip"; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "was taken from it" "$TMP/out" && cmp -s "$FAKE/publish.lock" "$TMP/thief.lock" && ! grep -q '^PUT latest-win-staging\.json' "$FAKE/.calls"; then pass "a lock broken mid-run stops the run before its next write, and the other run's lock is kept"
else fail "heartbeat: rc=$rc lock=$(cmp -s "$FAKE/publish.lock" "$TMP/thief.lock" && echo theirs || echo CHANGED) $(tail -1 "$TMP/out")"; fi
rm -f "$FAKE/publish.lock"
# ...and swapped AFTER the last write: the run finishes, keeps the other lock, and warns.
mkzip "$TMP/lk4.zip" 9.9.12 LK4
KOSMOS_PUBLISH_R2_FAKE_AFTER="PUT latest-win-staging.json|publish.lock|$TMP/thief.lock" fake -Zip "$TMP/lk4.zip"; rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$FAKE/publish.lock" "$TMP/thief.lock" && grep -qF "was someone else's when this run finished" "$TMP/out"; then pass "a run whose lock was taken after its last write keeps the other lock and warns"
else fail "late swap: rc=$rc lock=$(cmp -s "$FAKE/publish.lock" "$TMP/thief.lock" && echo theirs || echo CHANGED) $(tail -2 "$TMP/out" | tr '\n' ' ')"; fi
rm -f "$FAKE/publish.lock"
# A refusal after the lock is taken still removes it.
: > "$FAKE/.calls"; KOSMOS_PUBLISH_R2_FAKE_GET_STATUS=latest-win.json:403 fake -Zip "$TMP/lk.zip"; rc=$?
if [ "$rc" -eq 1 ] && [ ! -e "$FAKE/publish.lock" ] && grep -q '^DELETE publish\.lock' "$FAKE/.calls"; then pass "a refusal after taking publish.lock removes it"
else fail "lock after refusal: rc=$rc lock=$([ -e "$FAKE/publish.lock" ] && echo LEFT || echo gone) $(tail -1 "$TMP/out")"; fi
cp "$TMP/staging.lock-keep" "$FAKE/latest-win-staging.json"
# The approval line keeps record= LAST, since a Windows record path can hold spaces.
_given=$(grep 'approval=given' "$ALOG" | tail -1)
if [ -n "$_given" ] && printf '%s' "$_given" | grep -qE ' record=[^ ]+$'; then pass "record= is the last field of the approval line"
else fail "approval line field order: $_given"; fi
# A failure after prod-facing writes began says so.
: > "$FAKE/.calls"; KOSMOS_PUBLISH_R2_FAKE_FAIL=latest-win.json promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "prod-facing writes had begun" "$TMP/out"; then pass "a failure after the first prod-facing write says what may have changed"
else fail "partial-state note: rc=$rc $(tail -2 "$TMP/out")"; fi

[ "$fails" -eq 0 ] && { echo "test-publish-r2-3725: all passed"; exit 0; }
echo "test-publish-r2-3725: $fails failed"; exit 1
