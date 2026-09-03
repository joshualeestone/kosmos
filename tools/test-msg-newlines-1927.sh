#!/bin/bash
# #1927 -- the installer must carry a message's paragraph breaks across the wire
# as a JSON `\n` escape, not flatten them to spaces. This runs the REAL esc_text
# pipeline extracted from install/kosmos (not a copy, so the test cannot drift
# from the code) against both a hostile multiline input AND a plain single-line
# one, and proves:
#   - the resulting JSON parses,
#   - a blank line round-trips as `\n\n`,
#   - tab and CR are still flattened, quote and backslash still escaped,
#   - a plain single-line message SURVIVES non-empty (#1985), and
#   - negative controls (raw newline; the pre-fix unguarded-N pipeline) FAIL, so
#     a green above means something.
# It also pins the BSD-sed-safe `-e` form AND the `$!` guard on `N`:
#   - the one-line `:a;N;$!ba;...` form is a GNU-sed-ism that dies on a clean
#     Mac's BSD sed (the installer's whole premise);
#   - an UNGUARDED `-e 'N' -e '$!ba'` empties single-line input on BSD sed,
#     because `N` on the last line exits without printing -- that shipped in
#     0.6.24 and discarded EVERY one-line message (#1985).
# A regression back to either form must red here. THE SINGLE-LINE ARM is the one
# the original test lacked: it fed only multiline input, the arm that works, so
# it certified the exact blind spot #1985 fell into.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# node is used only as a JSON parser (the installer targets a Mac without
# python3; node is present in this repo's test environment).
have_node() { command -v node >/dev/null 2>&1; }
if ! have_node; then
  echo "test-msg-newlines-1927: node not found; cannot validate JSON. Treating as failure."
  exit 1
fi

# --- pull the REAL esc_text pipeline out of the installer --------------------
# Every esc_text= line is identical; take the first. Strip the leading
# `esc_text=$(printf '%s' "$text" | ` and trailing `)` so we are left with the
# transform, then run our own $text through the same commands.
esc_line="$(grep -m1 -E '^\s*esc_text=\$\(printf' install/kosmos)"
if [ -z "$esc_line" ]; then
  bad "could not find an esc_text pipeline in install/kosmos"
  echo "test-msg-newlines-1927: $FAILS failures"; exit 1
fi

# The transform after `printf '%s' "$text" | `
transform="$(printf '%s' "$esc_line" | sed -e 's/^[^|]*| //' -e 's/)[[:space:]]*$//')"

run_esc() { # $1 = raw text -> escaped JSON string body on stdout
  printf '%s' "$1" | eval "$transform"
}

# --- the arm the fix exists for --------------------------------------------
raw="$(printf 'first line\n\nsecond paragraph\twith tab\rCR\nhas "quote" and \\ back')"
esc="$(run_esc "$raw")"
json="$(printf '{"text":"%s"}' "$esc")"

verdict="$(printf '%s' "$json" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try {
    const o = JSON.parse(d);
    const t = o.text;
    const NL = String.fromCharCode(10), TAB = String.fromCharCode(9), CR = String.fromCharCode(13);
    if (!t.includes(NL+NL)) return console.log("NO_BLANK_LINE");
    if (t.includes(TAB)) return console.log("HAS_TAB");
    if (t.includes(CR)) return console.log("HAS_CR");
    if (!t.includes("\"quote\"")) return console.log("NO_QUOTE");
    if (!t.includes(String.fromCharCode(92)+" back")) return console.log("NO_BACKSLASH");
    console.log("OK");
  } catch (e) { console.log("INVALID_JSON"); }
});
')"
[ "$verdict" = "OK" ] \
  && ok "multiline message escapes to valid JSON, blank line kept, tab/CR flattened, quote+backslash preserved" \
  || bad "escaped payload wrong (verdict=$verdict; esc=$esc)"

# --- THE SINGLE-LINE ARM (#1985): the common case, and the one that shipped ---
# broken. A plain one-line message must survive as itself, non-empty. Runs the
# REAL extracted pipeline, so a revert to the unguarded `N` (which empties
# single-line input on BSD sed) reds THIS arm.
single='hello world'
esc_single="$(run_esc "$single")"
json_single="$(printf '{"text":"%s"}' "$esc_single")"
single_verdict="$(printf '%s' "$json_single" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try {
    const o = JSON.parse(d);
    if (o.text === "hello world") return console.log("OK");
    console.log("WRONG:"+JSON.stringify(o.text));
  } catch (e) { console.log("INVALID_JSON"); }
});
')"
[ "$single_verdict" = "OK" ] \
  && ok "a plain single-line message survives non-empty and round-trips (#1985)" \
  || bad "single-line message was emptied or mangled (#1985): esc=[$esc_single] verdict=$single_verdict"

# CONTROL: the pre-fix UNGUARDED-N pipeline empties single-line input, so the arm
# above can return the dangerous answer. This is the exact form 0.6.24 shipped;
# hardcoded on purpose (it is a fixed historical shape, not live code).
broke_single="$(printf '%s' "$single" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\t\r' '  ' | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g')"
[ -z "$broke_single" ] \
  && ok "CONTROL: the pre-fix unguarded-N pipeline empties single-line input, so the arm above is meaningful" \
  || bad "CONTROL did not discriminate: the unguarded-N pipeline did not empty single-line input (got [$broke_single])"

# --- negative control: the pre-fix behaviour (raw newline) must FAIL --------
# A raw newline inside a JSON string is a control character JSON forbids; this
# proves the parser above can return the dangerous answer, so its OK means work.
# printf writes the real newline straight into the pipe -- a command
# substitution would strip it and the control would test nothing.
bad_verdict="$(printf '{"text":"a\nb"}' | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try { JSON.parse(d); console.log("PARSED"); } catch (e) { console.log("REJECTED"); }
});
')"
[ "$bad_verdict" = "REJECTED" ] \
  && ok "CONTROL: a raw newline in the JSON is rejected, so the OK above is meaningful" \
  || bad "the JSON check accepts a raw newline (control did not discriminate)"

# --- all four esc_text sites carry the fix ---------------------------------
# Count by the distinguishing fragment of the FIXED pipeline: the `$!`-guarded
# slurp `-e '$!{N;ba' -e '}'`. grep -F so the shell/ERE metacharacters in the
# fragment are matched literally.
n_new="$(grep -cF "sed -e ':a' -e '\$!{N;ba' -e '}' -e 's/" install/kosmos)"
[ "$n_new" -eq 4 ] \
  && ok "all 4 esc_text sites use the paragraph-preserving, single-line-safe (\$!-guarded) pipeline" \
  || bad "expected 4 fixed esc_text sites, found $n_new"

# --- regression guard: BOTH broken forms must NOT return --------------------
# (1) the GNU-only one-liner that dies on BSD sed, and (2) the UNGUARDED `N`
# that empties single-line input on BSD sed (#1985, the form 0.6.24 shipped).
n_bad_oneline="$(grep -cF "sed ':a;N;\$!ba" install/kosmos)"
n_bad_unguarded="$(grep -cF "sed -e ':a' -e 'N' -e '\$!ba'" install/kosmos)"
n_bad=$(( ${n_bad_oneline:-0} + ${n_bad_unguarded:-0} ))
[ "$n_bad" -eq 0 ] \
  && ok "no esc_text site uses a broken sed form (one-line GNU-ism, or the unguarded N that empties single-line input)" \
  || bad "$n_bad esc_text site(s) use a broken sed form (oneline=$n_bad_oneline, unguarded-N=$n_bad_unguarded); see #1985"

echo "test-msg-newlines-1927: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
