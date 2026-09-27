package io.kosmos.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which of the person's own addresses the app opens, and whether full screen (kosmos #2854).
 *
 * The sign-in page (login.kosmosplus.com) is the only thing holding the session, so it hands
 * the app four values when the person taps "Open my Kosmos": the address they chose, every
 * address on their account (/v1/account/me `addresses`), the short-lived handoff token, and the
 * nonce this app put in the page's launch URL (HandoffNonce).
 *
 * Anything can fire that intent: a web page in Chrome after a tap, or another installed app.
 * So every host is checked with the same one-label rule as the iOS app
 * (PushBridgeLogic.isMacHost) and the board's sw.js, and fullScreen is true only when the nonce
 * matches the one this app issued.
 *
 * Pure Java with no Android types, so the rule runs as a plain JVM unit test.
 */
final class AddressChoice {

    /** The URL to open: https://name.kosmosplus.com/#kst=token. */
    final String target;
    /**
     * Whether the intent carried this app's nonce. Every Mac's assetlinks.json vouches for this
     * app, so a TWA at ANY Mac address verifies: only a nonce-bound choice may open as a TWA.
     */
    final boolean fullScreen;
    /**
     * Origins for setAdditionalTrustedOrigins: the chosen one first, then the rest. Empty when
     * fullScreen is false.
     */
    final List<String> trustedOrigins;

    private AddressChoice(String target, boolean fullScreen, List<String> trustedOrigins) {
        this.target = target;
        this.fullScreen = fullScreen;
        this.trustedOrigins = Collections.unmodifiableList(trustedOrigins);
    }

    /** Every address is opened over https. */
    private static final String HTTPS = "https://";
    /** Where the board reads the handoff token from (the board's #kst= fragment reader). */
    private static final String KST_FRAGMENT = "/#kst=";

    // KST1.<base64url>.<base64url> (kosmos-relay crates/proto token.rs): the only characters a
    // handoff token has, so nothing else can ride into the URL through it.
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._-]{1,4096}");

    /**
     * Null means "do not open an address": the intent is ignored. That covers
     * no choice at all (an account with no Mac), a missing or malformed token, a chosen host that
     * fails the rule, and a chosen host missing from the account's list. The list is a shape
     * check, not authentication: a forged intent can list its own host. The nonce decides
     * fullScreen.
     *
     * @param coordinatorHost the verified front door, e.g. login.kosmosplus.com
     * @param chosen the address the person tapped, a bare host
     * @param addresses every address on the account
     * @param token the handoff token for the chosen address
     * @param issuedNonce the nonce this app last put in the page's launch URL, or null
     * @param givenNonce the nonce the intent carried, or null
     */
    static AddressChoice choose(String coordinatorHost, String chosen, List<String> addresses,
                                String token, String issuedNonce, String givenNonce) {
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
        if (!listed) return null;

        boolean fullScreen = HandoffNonce.matches(issuedNonce, givenNonce);
        List<String> origins = new ArrayList<>();
        if (fullScreen) {
            for (String h : hosts) origins.add(HTTPS + h);
        }
        return new AddressChoice(HTTPS + pick + KST_FRAGMENT + token, fullScreen, origins);
    }

    /**
     * Whether KosmosLauncherActivity may launch this URL (after rebuilding it on coordinatorHost):
     * https and exactly the coordinator's host. Anything else is replaced by the sign-in page.
     */
    static boolean isSignInUrl(String scheme, String host, String coordinatorHost) {
        return "https".equalsIgnoreCase(scheme) && host != null && coordinatorHost != null
                && !coordinatorHost.isEmpty() && coordinatorHost.equalsIgnoreCase(host);
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
