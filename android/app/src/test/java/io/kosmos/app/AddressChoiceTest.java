package io.kosmos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    private static final String N = "0123456789abcdef0123456789abcdef";   // the issued nonce
    private static final List<String> HERS = Collections.singletonList("hers.kosmosplus.com");

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
            "h\u0435rs.kosmosplus.com",               // non-ASCII lookalike letter (Cyrillic e)
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
        // "\u212Aosmos" through as "kosmos".
        assertEquals("k", "\u212A".toLowerCase(java.util.Locale.ROOT));
        assertNull(host("\u212Aosmos.kosmosplus.com"));
    }

    @Test public void aMisconfiguredCoordinatorRefusesEverything() {
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", "kosmosplus.com"));   // two labels
        assertNull(AddressChoice.macHost("hers.com", "localhost"));
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", "login..kosmosplus.com"));
        assertNull(AddressChoice.macHost("hers.kosmosplus.com", null));
    }

    // ---- choosing the address: 0, 1 or several ----

    @Test public void noAddressOpensTheSignInPage() {
        assertNull(AddressChoice.choose(COORD, null, NONE, TOKEN, N, N));
        assertNull(AddressChoice.choose(COORD, "", NONE, TOKEN, N, N));
        assertNull(AddressChoice.choose(COORD, null, null, TOKEN, N, N));
    }

    @Test public void oneAddressOpensItAndTrustsOnlyIt() {
        AddressChoice c = AddressChoice.choose(COORD, "hers.kosmosplus.com",
                Collections.singletonList("hers.kosmosplus.com"), TOKEN, N, N);
        assertNotNull(c);
        assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN, c.target);
        assertEquals(Collections.singletonList("https://hers.kosmosplus.com"), c.trustedOrigins);
    }

    @Test public void aChoiceWithNoListIsRefused() {
        // The page always sends the account's list, so an intent without one is not the page.
        assertNull(AddressChoice.choose(COORD, "hers.kosmosplus.com", NONE, TOKEN, N, N));
        assertNull(AddressChoice.choose(COORD, "hers.kosmosplus.com", null, TOKEN, N, N));
    }

    @Test public void severalAddressesOpenTheChosenOneAndTrustAllValidOnes() {
        AddressChoice c = AddressChoice.choose(COORD, "studio.kosmosplus.com",
                Arrays.asList("home.kosmosplus.com", "studio.kosmosplus.com",
                        "evil.example.com", "Home.kosmosplus.com", "xn--hrs-8cd.kosmosplus.com"),
                TOKEN, N, N);
        assertNotNull(c);
        assertEquals("https://studio.kosmosplus.com/#kst=" + TOKEN, c.target);
        // The chosen one first; the bad entries dropped; the duplicate (by case) once.
        assertEquals(Arrays.asList("https://studio.kosmosplus.com", "https://home.kosmosplus.com"),
                c.trustedOrigins);
    }

    @Test public void aChoiceNotOnTheAccountIsRefused() {
        assertNull(AddressChoice.choose(COORD, "someone-else.kosmosplus.com",
                Arrays.asList("home.kosmosplus.com", "studio.kosmosplus.com"), TOKEN, N, N));
    }

    @Test public void aForeignChoiceIsRefusedEvenWhenTheListIsGood() {
        assertNull(AddressChoice.choose(COORD, "evil.example.com",
                Collections.singletonList("home.kosmosplus.com"), TOKEN, N, N));
        assertNull(AddressChoice.choose(COORD, "login.kosmosplus.com",
                Collections.singletonList("login.kosmosplus.com"), TOKEN, N, N));
    }

    // ---- the nonce: full screen only for this app's own sign-in page ----

    @Test public void withoutThisAppsNonceTheAddressIsNotFullScreen() {
        String[][] cases = {
            { N, null },                                  // intent carried none (another page or app)
            { N, "" },
            { N, "fedcba9876543210fedcba9876543210" },    // someone else's value
            { null, N },                                  // this app issued none (older launch)
            { N, N.toUpperCase(java.util.Locale.ROOT) },  // wrong shape
            { N, N + "0" },
        };
        for (String[] c : cases) {
            AddressChoice ch = AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, TOKEN, c[0], c[1]);
            assertNotNull(ch);
            assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN, ch.target);
            assertFalse("full screen without a matching nonce: " + c[1], ch.fullScreen);
            assertEquals("trusted without a matching nonce: " + c[1], NONE, ch.trustedOrigins);
        }
    }

    @Test public void theMatchingNonceTrustsTheAddress() {
        AddressChoice ch = AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, TOKEN, N, N);
        assertTrue(ch.fullScreen);
        assertEquals(Collections.singletonList("https://hers.kosmosplus.com"), ch.trustedOrigins);
    }

    @Test public void aFreshNonceIs32HexAndMatchesOnlyItself() {
        String a = HandoffNonce.fresh();
        String b = HandoffNonce.fresh();
        assertEquals(true, a.matches("[0-9a-f]{32}"));
        assertEquals(true, HandoffNonce.matches(a, a));
        assertEquals(false, HandoffNonce.matches(a, b));
    }

    // ---- the launcher's own URL: only https on the coordinator itself ----

    @Test public void theLauncherTakesOnlyHttpsOnTheCoordinator() {
        assertTrue(AddressChoice.isSignInUrl("https", COORD, COORD));
        assertTrue(AddressChoice.isSignInUrl("HTTPS", "LOGIN.kosmosplus.com", COORD));
        String[][] refused = {
            { "http", COORD },                           // wrong scheme
            { "intent", COORD },
            { null, COORD },
            { "https", "hers.kosmosplus.com" },          // a Mac, not the coordinator
            { "https", "login.kosmosplus.com.evil.com" },
            { "https", "evil.com" },
            { "https", "" },
            { "https", null },
        };
        for (String[] r : refused) {
            assertFalse("launcher should refuse " + r[0] + "://" + r[1],
                    AddressChoice.isSignInUrl(r[0], r[1], COORD));
        }
        assertFalse(AddressChoice.isSignInUrl("https", "", ""));   // misconfigured coordinator
        assertFalse(AddressChoice.isSignInUrl("https", COORD, null));
    }

    // ---- the handoff token ----

    @Test public void aMissingOrUnsafeTokenIsRefused() {
        String[] bad = { null, "", "a b", "a#b", "a/b", "a?b=c", "a&b", "%41", "a\u00e9",
                repeat('a', 4097) };
        for (String t : bad) {
            assertNull("should refuse token: " + t,
                    AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, t, N, N));
        }
        assertNotNull(AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, repeat('a', 4096), N, N));
    }

    // ---- the agent a notification tap was about (#4171). The session cases mirror the iOS
    // app's (ios/LogicTests/main.swift, "tap deep link to the agent") case for case. ----

    private static final String HOME = "https://hers.kosmosplus.com/#kst=" + TOKEN;

    private static String withAgent(String agent) {
        return AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, TOKEN, N, N, agent).target;
    }

    @Test public void aValidAgentOpensThatAgentBeforeTheTokenFragment() {
        assertEquals("https://hers.kosmosplus.com/?tab=detail&agent=leo#kst=" + TOKEN,
                withAgent("leo"));
        assertEquals("https://hers.kosmosplus.com/?tab=detail&agent=release-notes_2#kst=" + TOKEN,
                withAgent("release-notes_2"));
        assertEquals("a 1-character session is accepted",
                "https://hers.kosmosplus.com/?tab=detail&agent=a#kst=" + TOKEN, withAgent("a"));
        assertEquals("a 64-character session is accepted (control)",
                "https://hers.kosmosplus.com/?tab=detail&agent=" + repeat('a', 64) + "#kst=" + TOKEN,
                withAgent(repeat('a', 64)));
    }

    @Test public void noAgentOrABadOneOpensTheBoardHomeAndNeverRefusesTheAddress() {
        assertEquals(HOME, withAgent(null));
        assertEquals("the six-argument form is unchanged", HOME,
                AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, TOKEN, N, N).target);
        String[] bad = { "", "Leo", "leo.x", "a/b", "../x", "leo?tab=settings", "leo&agent=x",
                "leo#x", "http://evil", "leo%2Fx", "le o", "l\u0435o", "-leo", "_leo", repeat('a', 65) };
        for (String a : bad) {
            assertEquals("should drop agent: " + a, HOME, withAgent(a));
        }
    }

    @Test public void theAgentFollowsTheChoiceIntoACustomTab() {
        AddressChoice c = AddressChoice.choose(COORD, "hers.kosmosplus.com", HERS, TOKEN, N,
                "fedcba9876543210fedcba9876543210", "leo");
        assertFalse(c.fullScreen);
        assertEquals("https://hers.kosmosplus.com/?tab=detail&agent=leo#kst=" + TOKEN, c.target);
    }

    @Test public void aGoodAgentCannotRescueABadAddress() {
        assertNull(AddressChoice.choose(COORD, "evil.example.com", HERS, TOKEN, N, N, "leo"));
    }

    @Test public void theAgentRuleIsTheServiceWorkersTapSession() throws IOException {
        // Two derivations of one fact drift (CLAUDE.md): pin this rule to web/sw.js's TAP_SESSION.
        String sw = new String(Files.readAllBytes(new File("../../web/sw.js").toPath()),
                StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("const TAP_SESSION = /\\^(.+)\\$/;").matcher(sw);
        assertTrue("web/sw.js declares TAP_SESSION as an anchored regex", m.find());
        assertEquals(m.group(1), AddressChoice.AGENT_SESSION.pattern());
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
