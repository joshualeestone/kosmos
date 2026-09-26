package io.kosmos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which of the person's own addresses the app opens full screen (kosmos #2854).
 *
 * The sign-in page (login.kosmosplus.com) is the only thing holding the session, so it hands
 * the app three values when the person taps "Open my Kosmos": the address they chose, every
 * address on their account (/v1/account/me `addresses`), and the short-lived handoff token.
 * Anything can fire that intent, so every host is checked here with the same one-label rule as
 * the iOS app (PushBridgeLogic.isMacHost) and the board's sw.js: exactly one RFC 1123 label
 * directly under the coordinator's domain, never the coordinator's own host.
 *
 * Pure Java with no Android types, so the rule runs as a plain JVM unit test.
 */
final class AddressChoice {

    /** The URL the TWA opens: https://name.kosmosplus.com/#kst=token. */
    final String target;
    /** Origins handed to setAdditionalTrustedOrigins: the chosen one first, then the rest. */
    final List<String> trustedOrigins;

    private AddressChoice(String target, List<String> trustedOrigins) {
        this.target = target;
        this.trustedOrigins = Collections.unmodifiableList(trustedOrigins);
    }

    // KST1.<base64url>.<base64url> (kosmos-relay crates/proto token.rs): the only characters a
    // handoff token has, so nothing else can ride into the URL through it.
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._-]{1,4096}");

    /**
     * Null means "do not open an address": the app opens the sign-in page instead. That covers
     * no choice at all (an account with no Mac), a missing or malformed token, a chosen host that
     * fails the rule, and a chosen host that is not among the account's addresses.
     *
     * @param coordinatorHost the verified front door, e.g. login.kosmosplus.com
     * @param chosen the address the person tapped, a bare host
     * @param addresses every address on the account; may be empty when the page sends none
     * @param token the handoff token for the chosen address
     */
    static AddressChoice choose(String coordinatorHost, String chosen, List<String> addresses, String token) {
        String pick = macHost(chosen, coordinatorHost);
        if (pick == null || token == null || !TOKEN.matcher(token).matches()) return null;

        List<String> hosts = new ArrayList<>();
        hosts.add(pick);
        boolean listed = false;
        if (addresses != null) {
            for (String a : addresses) {
                String h = macHost(a, coordinatorHost);
                if (h == null) continue;              // a bad entry is dropped, not fatal
                if (h.equals(pick)) listed = true;
                else if (!hosts.contains(h)) hosts.add(h);
            }
        }
        // When the page sends the account's list, the choice must be on it: a chosen host the
        // account does not have is somebody else's intent, not the person's tap.
        if (addresses != null && !addresses.isEmpty() && !listed) return null;

        List<String> origins = new ArrayList<>();
        for (String h : hosts) origins.add("https://" + h);
        return new AddressChoice("https://" + pick + "/#kst=" + token, origins);
    }

    /** The page sends the account's addresses as one comma-separated extra. */
    static List<String> split(String csv) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String s : csv.split(",", -1)) {
            String t = s.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    /** The host lowercased when it passes the one-label rule, else null. */
    static String macHost(String host, String coordinatorHost) {
        if (host == null || coordinatorHost == null) return null;
        // ASCII first, THEN lowercase: Java lowercases the Kelvin sign (U+212A) to an ASCII k,
        // so lowercasing first would let a lookalike through.
        if (!isAscii(host) || !isAscii(coordinatorHost)) return null;
        String h = host.toLowerCase(Locale.ROOT);
        String coordinator = coordinatorHost.toLowerCase(Locale.ROOT);
        String domain = relayDomain(coordinator);
        if (domain == null || h.equals(coordinator)) return null;
        String suffix = "." + domain;
        if (!h.endsWith(suffix)) return null;
        return isHostLabel(h.substring(0, h.length() - suffix.length())) ? h : null;
    }

    /**
     * login.kosmosplus.com -> kosmosplus.com. Null when the host has fewer than three labels,
     * so a misconfigured origin refuses every address rather than accepting everything under a
     * top-level domain.
     */
    static String relayDomain(String coordinatorHost) {
        String[] labels = coordinatorHost.split("\\.", -1);
        if (labels.length < 3) return null;
        for (String l : labels) if (l.isEmpty()) return null;
        return coordinatorHost.substring(labels[0].length() + 1);
    }

    // RFC 1123 label: 1 to 63 of a-z, 0-9 and hyphen, not starting or ending with a hyphen.
    // A punycode label (xn--) is refused too: it is how a lookalike Unicode name arrives in ASCII.
    private static boolean isHostLabel(String label) {
        int n = label.length();
        if (n < 1 || n > 63 || label.charAt(0) == '-' || label.charAt(n - 1) == '-'
                || label.startsWith("xn--")) {
            return false;
        }
        for (int i = 0; i < n; i++) {
            char c = label.charAt(i);
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
        }
        return true;
    }

    private static boolean isAscii(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) > 0x7f) return false;
        return true;
    }
}
