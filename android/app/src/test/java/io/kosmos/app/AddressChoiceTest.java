package io.kosmos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

/**
 * The address rule for kosmos #2854. The host table mirrors the iOS app's
 * (ios/LogicTests/main.swift, PushBridge tapURL cases) case for case, so the three clients
 * (iOS, the board's sw.js, this app) refuse the same hosts.
 */
public class AddressChoiceTest {

    private static final String COORD = "login.kosmosplus.com";
    private static final String TOKEN = "KST1.eyJhIjoxfQ.c2ln-_";
    private static final List<String> NONE = Collections.emptyList();

    private static String host(String h) {
        return AddressChoice.macHost(h, COORD);
    }

    // ---- the one-label rule (same table as iOS) ----

    @Test public void aMacAddressIsAccepted() {
        assertEquals("hers.kosmosplus.com", host("hers.kosmosplus.com"));
    }

    @Test public void caseIsNormalised() {
        assertEquals("hers.kosmosplus.com", host("Hers.KosmosPlus.com"));
    }

    @Test public void hyphensAndDigitsInsideALabelAreAccepted() {
        assertEquals("my-mac-2.kosmosplus.com", host("my-mac-2.kosmosplus.com"));
    }

    @Test public void a63CharLabelIsAcceptedAnd64IsRefused() {
        assertNotNull(host(repeat('a', 63) + ".kosmosplus.com"));
        assertNull(host(repeat('a', 64) + ".kosmosplus.com"));
    }

    @Test public void foreignAndMalformedHostsAreRefused() {
        String[] refused = {
            "evil.example.com",                       // another domain
            "hers.kosmosplus.com.evil.example",       // suffix lookalike
            "evilkosmosplus.com",                     // glued lookalike
            "evil-kosmosplus.com",                    // hyphen-glued lookalike
            "hers.kosmosplus.com.evil.com",           // relay domain under another
            "kosmosplus.com",                         // bare relay domain
            ".kosmosplus.com",                        // empty label
            "a.b.kosmosplus.com",                     // two labels deep
            "hers.kosmosplus.com/steal",              // a path
            "hers.kosmosplus.com:8443",               // a port
            "https://hers.kosmosplus.com",            // a full URL
            "u@hers.kosmosplus.com",                  // userinfo
            "-hers.kosmosplus.com",                   // leading hyphen
            "hers-.kosmosplus.com",                   // trailing hyphen
            "hеrs.kosmosplus.com",               // non-ASCII lookalike letter (Cyrillic e)
            "xn--hrs-8cd.kosmosplus.com",             // punycode label
            "hers.kosmosplus.com.",                   // trailing dot
            "javascript:alert(1)//.kosmosplus.com",   // script scheme smuggled in the label
            "hers.kosmosplus.com#x",                  // a fragment
            "hers kosmosplus.com",                    // whitespace
            "",                                       // empty
            "login.kosmosplus.com",                   // the coordinator is not a Mac
            "LOGIN.kosmosplus.com",                   // ... in any case
        };
        for (String h : refused) assertNull("should refuse: " + h, host(h));
        assertNull(host(null));
    }

    @Test public void theKelvinSignIsRefusedBeforeLowercasing() {
        // Java lowercases U+212A to an ASCII 'k'; checking ASCII after lowercasing would let
        // "Kosmos" through as "kosmos".
        assertEquals("k", "K".toLowerCase(java.util.Locale.ROOT));
        assertNull(host("Kosmos.kosmosplus.com"));
    }

    @Test public void aMisconfiguredCoordinatorRefusesEverything() {
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", "kosmosplus.com"));   // two labels
        assertNull(AddressChoice.macHost("hers.com", "localhost"));
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", "login..kosmosplus.com"));
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", null));
    }

    // ---- choosing the address: 0, 1 or several ----

    @Test public void noAddressOpensTheSignInPage() {
        assertNull(AddressChoice.choose(COORD, null, NONE, TOKEN));
        assertNull(AddressChoice.choose(COORD, "", NONE, TOKEN));
        assertNull(AddressChoice.choose(COORD, null, null, TOKEN));
    }

    @Test public void oneAddressOpensItAndTrustsOnlyIt() {
        AddressChoice c = AddressChoice.choose(COORD, "hers.kosmosplus.com",
                Collections.singletonList("hers.kosmosplus.com"), TOKEN);
        assertNotNull(c);
        assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN, c.target);
        assertEquals(Collections.singletonList("https://hers.kosmosplus.com"), c.trustedOrigins);
    }

    @Test public void oneAddressWithNoListStillOpens() {
        AddressChoice c = AddressChoice.choose(COORD, "hers.kosmosplus.com", NONE, TOKEN);
        assertNotNull(c);
        assertEquals(Collections.singletonList("https://hers.kosmosplus.com"), c.trustedOrigins);
    }

    @Test public void severalAddressesOpenTheChosenOneAndTrustAllValidOnes() {
        AddressChoice c = AddressChoice.choose(COORD, "studio.kosmosplus.com",
                Arrays.asList("home.kosmosplus.com", "studio.kosmosplus.com",
                        "evil.example.com", "Home.kosmosplus.com", "xn--hrs-8cd.kosmosplus.com"),
                TOKEN);
        assertNotNull(c);
        assertEquals("https://studio.kosmosplus.com/#kst=" + TOKEN, c.target);
        // The chosen one first; the bad entries dropped; the duplicate (by case) once.
        assertEquals(Arrays.asList("https://studio.kosmosplus.com", "https://home.kosmosplus.com"),
                c.trustedOrigins);
    }

    @Test public void aChoiceNotOnTheAccountIsRefused() {
        assertNull(AddressChoice.choose(COORD, "someone-else.kosmosplus.com",
                Arrays.asList("home.kosmosplus.com", "studio.kosmosplus.com"), TOKEN));
    }

    @Test public void aForeignChoiceIsRefusedEvenWhenTheListIsGood() {
        assertNull(AddressChoice.choose(COORD, "evil.example.com",
                Collections.singletonList("home.kosmosplus.com"), TOKEN));
        assertNull(AddressChoice.choose(COORD, "login.kosmosplus.com",
                Collections.singletonList("login.kosmosplus.com"), TOKEN));
    }

    // ---- the handoff token ----

    @Test public void aMissingOrUnsafeTokenIsRefused() {
        String[] bad = { null, "", "a b", "a#b", "a/b", "a?b=c", "a&b", "%41", "aé",
                repeat('a', 4097) };
        for (String t : bad) {
            assertNull("should refuse token: " + t,
                    AddressChoice.choose(COORD, "hers.kosmosplus.com", NONE, t));
        }
        assertNotNull(AddressChoice.choose(COORD, "hers.kosmosplus.com", NONE, repeat('a', 4096)));
    }

    // ---- the page's comma list ----

    @Test public void theAddressListSplitsOnCommasAndDropsBlanks() {
        assertEquals(Arrays.asList("a.kosmosplus.com", "b.kosmosplus.com"),
                AddressChoice.split(" a.kosmosplus.com,,b.kosmosplus.com , "));
        assertEquals(NONE, AddressChoice.split(null));
        assertEquals(NONE, AddressChoice.split(""));
    }

    private static String repeat(char c, int n) {
        char[] a = new char[n];
        Arrays.fill(a, c);
        return new String(a);
    }
}
