package io.kosmos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class KosmosLauncherActivityTest {

    @Test public void foreignHostIsReplacedByConfiguredSignInPage() {
        Uri launched = launch("https://hers.kosmosplus.com/private?x=1");

        assertEquals("https", launched.getScheme());
        assertEquals("login.kosmosplus.com", launched.getHost());
        assertEquals("/", launched.getPath());
    }

    @Test public void foreignSchemeIsReplacedByConfiguredSignInPage() {
        Uri launched = launch("http://login.kosmosplus.com/private?x=1");

        assertEquals("https", launched.getScheme());
        assertEquals("login.kosmosplus.com", launched.getHost());
        assertEquals("/", launched.getPath());
    }

    @Test public void acceptedUrlIsRebuiltFromConfiguredHostAndKeepsPathAndQuery() {
        Uri launched = launch(
                "https://attacker@LOGIN.KOSMOSPLUS.COM:444/signin/step?next=devices");

        assertEquals("https", launched.getScheme());
        assertEquals("login.kosmosplus.com", launched.getEncodedAuthority());
        assertNull(launched.getUserInfo());
        assertEquals(-1, launched.getPort());
        assertEquals("/signin/step", launched.getEncodedPath());
        assertEquals("next=devices", launched.getEncodedQuery());
    }

    @Test public void launchMintsAndStoresNonceInFragment() {
        KosmosLauncherActivity activity = activity("https://login.kosmosplus.com/signin");
        Uri launched = activity.getLaunchingUrl();
        String nonce = launched.getFragment().substring((HandoffNonce.FRAGMENT_KEY + "=").length());

        assertTrue(launched.getFragment().startsWith(HandoffNonce.FRAGMENT_KEY + "="));
        assertTrue(nonce.matches("[0-9a-f]{32}"));
        assertEquals(nonce, activity.getSharedPreferences(KosmosLauncherActivity.PREFS,
                Context.MODE_PRIVATE).getString(KosmosLauncherActivity.PREF_NONCE, null));
    }

    private static Uri launch(String url) {
        return activity(url).getLaunchingUrl();
    }

    private static KosmosLauncherActivity activity(String url) {
        return Robolectric.buildActivity(KosmosLauncherActivity.class,
                new Intent(Intent.ACTION_VIEW, Uri.parse(url))).get();
    }
}
