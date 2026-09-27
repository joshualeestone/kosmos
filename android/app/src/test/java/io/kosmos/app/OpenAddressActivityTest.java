package io.kosmos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;

@RunWith(RobolectricTestRunner.class)
public class OpenAddressActivityTest {
    private static final String ADDRESS = "hers.kosmosplus.com";
    private static final String TOKEN = "KST1.eyJhIjoxfQ.c2ln-_";
    private static final String NONCE = "0123456789abcdef0123456789abcdef";

    @Test public void matchingNonceUsesTrustedWebActivity() {
        TestActivity activity = create(openIntent(NONCE), NONCE);

        assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN, activity.twaChoice.target);
        assertEquals(1, activity.twaChoice.trustedOrigins.size());
        assertNull(activity.customTabUrl);
        assertFalse(activity.isFinishing());
    }

    @Test public void mismatchedNonceUsesPlainCustomTab() {
        TestActivity activity = create(openIntent("fedcba9876543210fedcba9876543210"), NONCE);

        assertNull(activity.twaChoice);
        assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN,
                activity.customTabUrl.toString());
        assertTrue(activity.isFinishing());
    }

    @Test public void refusedIntentFinishesWithoutOpeningBrowser() {
        Intent refused = openIntent(NONCE).putExtra(OpenAddressActivity.EXTRA_ADDRESS,
                "evil.example.com");
        TestActivity activity = create(refused, NONCE);

        assertTrue(activity.isFinishing());
        assertNull(activity.twaChoice);
        assertNull(activity.customTabUrl);
    }

    @Test public void aTappedAgentOpensThatAgent() {
        Intent tap = openIntent(NONCE).putExtra(OpenAddressActivity.EXTRA_AGENT, "leo");
        TestActivity activity = create(tap, NONCE);

        assertEquals("https://hers.kosmosplus.com/?tab=detail&agent=leo#kst=" + TOKEN,
                activity.twaChoice.target);
    }

    @Test public void aBadAgentExtraStillOpensTheAddress() {
        Intent tap = openIntent(NONCE).putExtra(OpenAddressActivity.EXTRA_AGENT, "leo?tab=settings");
        TestActivity activity = create(tap, NONCE);

        assertEquals("https://hers.kosmosplus.com/#kst=" + TOKEN, activity.twaChoice.target);
    }

    private static Intent openIntent(String nonce) {
        return new Intent()
                .putExtra(OpenAddressActivity.EXTRA_ADDRESS, ADDRESS)
                .putExtra(OpenAddressActivity.EXTRA_ADDRESSES, ADDRESS)
                .putExtra(OpenAddressActivity.EXTRA_TOKEN, TOKEN)
                .putExtra(OpenAddressActivity.EXTRA_NONCE, nonce);
    }

    private static TestActivity create(Intent intent, String issuedNonce) {
        ActivityController<TestActivity> controller = Robolectric.buildActivity(
                TestActivity.class, intent);
        TestActivity activity = controller.get();
        activity.getSharedPreferences(KosmosLauncherActivity.PREFS, 0).edit()
                .putString(KosmosLauncherActivity.PREF_NONCE, issuedNonce).commit();
        controller.create();
        return activity;
    }

    public static class TestActivity extends OpenAddressActivity {
        AddressChoice twaChoice;
        Uri customTabUrl;

        @Override void launchTrustedWebActivity(AddressChoice choice) {
            twaChoice = choice;
        }

        @Override void openInCustomTab(Uri uri) {
            customTabUrl = uri;
        }
    }
}
