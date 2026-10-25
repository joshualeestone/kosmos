'use strict';
/**
 * #7108: cut text to at most `n` UTF-16 units without leaving half of a surrogate pair. `String.slice` counts units, so
 * a cut through an emoji kept its lead half; JSON.stringify writes that as a lone "\ud83d" escape, and a strict JSON
 * reader (the iPhone's JSONSerialization) refuses the whole answer that carries it. A trailing lead surrogate is
 * dropped, so the result is at most `n` units and always well-formed when the input was.
 */
function cutUnits(text, n) {
  const words = String(text).slice(0, n);
  const last = words.charCodeAt(words.length - 1);
  return last >= 0xD800 && last <= 0xDBFF ? words.slice(0, -1) : words;
}
/* #7108 review 3: the last line of defence. JSON.stringify keeps a lone surrogate (it writes "\ud83d"), and a strict
   reader refuses the whole answer; agent-written text reaches the routes the phone reads by more paths than any one
   cut can cover (a project description, a commitment posted with a broken character). Every string is made well-formed
   as it is written, values AND object keys (review 4: a replacer sees only values, so an object whose keys need it is
   copied with them mended): a lone half becomes U+FFFD, and well-formed text is unchanged. */
// Keys that mend to the same text keep the last value (Object.fromEntries); no live object is keyed by text that can
// carry a lone half, so this is accepted (review 5).
function strictReplacer(_key, value) {
  if (typeof value === 'string') return value.toWellFormed();
  if (value instanceof String) return String(value).toWellFormed();   // a boxed string (review 5)
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((k) => !k.isWellFormed())) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.toWellFormed(), v]));
  }
  return value;
}
function strictStringify(value, space) { return JSON.stringify(value, strictReplacer, space); }
module.exports = { cutUnits, strictStringify };
