package io.kosmos.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.regex.Pattern;

/**
 * The value that ties an "open this address" intent to this app's own sign-in page (#2854).
 *
 * KosmosLauncherActivity puts a fresh one in the fragment of the URL it launches the sign-in
 * page with, and keeps it. Only that page ever sees it, so an intent that carries it back came
 * from the page this app opened, not from another web page or app, and only then does
 * OpenAddressActivity trust the address full screen.
 */
final class HandoffNonce {

    /** The fragment key on the launch URL; the sign-in page reads the same name. */
    static final String FRAGMENT_KEY = "kosmos-app";

    // 128 random bits as 32 lowercase hex characters.
    private static final Pattern SHAPE = Pattern.compile("[0-9a-f]{32}");
    private static final SecureRandom RANDOM = new SecureRandom();

    private HandoffNonce() {}

    static String fresh() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        StringBuilder sb = new StringBuilder(32);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    /** True only for two well-formed, equal nonces; compared in constant time. */
    static boolean matches(String issued, String given) {
        if (issued == null || given == null) return false;
        if (!SHAPE.matcher(issued).matches() || !SHAPE.matcher(given).matches()) return false;
        return MessageDigest.isEqual(issued.getBytes(StandardCharsets.US_ASCII),
                given.getBytes(StandardCharsets.US_ASCII));
    }
}
