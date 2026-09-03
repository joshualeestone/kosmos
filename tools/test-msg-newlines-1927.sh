#!/bin/bash
# #1927 -- the installer must carry a message's paragraph breaks across the wire
# as a JSON `\n` escape, not flatten them to spaces. This runs the REAL esc_text
# pipeline extracted from install/kosmos (not a copy, so the test cannot drift
# from the code) against a hostile multiline input and proves:
#   - the resulting JSON parses,
#   - a blank line round-trips as `\n\n`,
#   - tab and CR are still flattened, quote and backslash still escaped,
#   - and a negative control (raw newline, the pre-fix behaviour) FAILS, so a
#     green above means something.
# It also pins the BSD-sed-safe `-e` form: the one-line `:a;N;$!ba;...` form is
# a GNU-sed-ism that dies on a clean Mac's BSD sed (the installer's whole
# premise), so a regression back to it must red here.
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
n_new="$(grep -cE "esc_text=\\\$\(printf '%s' \"\\\$text\" \| sed 's/.*| tr '.t.r' '  ' \| sed -e ':a'" install/kosmos 2>/dev/null)"
# The precise pattern is awkward to quote; count the distinguishing tail instead.
n_new="$(grep -cE "esc_text=.*sed -e ':a' -e 'N' -e '.\!ba' -e 's/" install/kosmos)"
[ "$n_new" -eq 4 ] \
  && ok "all 4 esc_text sites use the paragraph-preserving BSD-safe pipeline" \
  || bad "expected 4 fixed esc_text sites, found $n_new"

# --- regression guard: the broken GNU-only one-liner must NOT return --------
n_bad="$(grep -cE "sed ':a;N;\\\$!ba" install/kosmos)"
[ "${n_bad:-0}" -eq 0 ] \
  && ok "no esc_text site uses the GNU-only one-line sed form that dies on BSD sed" \
  || bad "$n_bad esc_text site(s) use the one-line ':a;N;\$!ba' form BSD sed cannot run"

echo "test-msg-newlines-1927: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
