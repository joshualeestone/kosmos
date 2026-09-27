package io.kosmos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

import org.junit.Test;

/**
 * #4151: the delegated-notification small icon must be a bitmap. androidx.browser passes it to the
 * browser through BitmapFactory.decodeResource, which returns null for a vector drawable, and the
 * push then shows the browser's icon instead of Kosmos's.
 */
public class IconResourceTest {

    private static final File RES = new File("src/main/res");
    private static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
    private static final int[] SIZES = {24, 36, 48, 72, 96};   // 24dp at each density

    private static String smallIconName() throws IOException {
        String manifest = new String(Files.readAllBytes(new File("src/main/AndroidManifest.xml").toPath()),
                StandardCharsets.UTF_8);
        Matcher m = Pattern.compile(
                "android\\.support\\.customtabs\\.trusted\\.SMALL_ICON\"\\s+android:resource=\"@drawable/([a-z0-9_]+)\"")
                .matcher(manifest);
        assertTrue("the manifest names the delegated-notification small icon", m.find());
        return m.group(1);
    }

    @Test
    public void theSmallIconIsNeverAVectorOrOtherXmlDrawable() throws IOException {
        String name = smallIconName();
        File[] folders = RES.listFiles((dir, n) -> n.startsWith("drawable"));
        assertNotNull("res/ is readable from the test's working directory", folders);
        assertTrue("found the drawable folders", folders.length > 0);
        for (File folder : folders) {
            assertFalse(folder.getName() + "/" + name + ".xml must not exist: a vector decodes to null",
                    new File(folder, name + ".xml").exists());
        }
    }

    @Test
    public void theSmallIconIsAWhiteSilhouettePngAtEveryDensity() throws IOException {
        String name = smallIconName();
        for (int i = 0; i < DENSITIES.length; i++) {
            File png = new File(RES, "drawable-" + DENSITIES[i] + "/" + name + ".png");
            assertTrue(png + " exists", png.isFile());
            Rgba image = Rgba.read(png);
            assertEquals(png + " width", SIZES[i], image.width);
            assertEquals(png + " height", SIZES[i], image.height);
            int opaque = 0;
            for (int y = 0; y < image.height; y++) {
                for (int x = 0; x < image.width; x++) {
                    int o = (y * image.width + x) * 4;
                    int alpha = image.pixels[o + 3] & 0xFF;
                    if (alpha == 0) continue;
                    opaque++;
                    for (int c = 0; c < 3; c++) {
                        assertEquals(png + " pixel " + x + "," + y + " is white", 0xFF, image.pixels[o + c] & 0xFF);
                    }
                }
            }
            int total = image.width * image.height;
            assertTrue(png + " is a silhouette, not empty or a filled square",
                    opaque > total / 10 && opaque < total * 9 / 10);
        }
    }

    /**
     * A minimal reader for the one PNG shape these icons use: 8-bit RGBA, not interlaced. The
     * Android unit-test classpath has no javax.imageio, and anything else fails the test.
     */
    private static final class Rgba {
        final int width;
        final int height;
        final byte[] pixels;

        private Rgba(int width, int height, byte[] pixels) {
            this.width = width;
            this.height = height;
            this.pixels = pixels;
        }

        static Rgba read(File file) throws IOException {
            ByteBuffer in = ByteBuffer.wrap(Files.readAllBytes(file.toPath()));
            assertEquals(file + " starts with the PNG signature", 0x89504E470D0A1A0AL, in.getLong());
            int width = 0;
            int height = 0;
            ByteArrayOutputStream idat = new ByteArrayOutputStream();
            while (in.remaining() >= 12) {
                int length = in.getInt();
                byte[] type = new byte[4];
                in.get(type);
                byte[] data = new byte[length];
                in.get(data);
                in.getInt();   // CRC
                String chunk = new String(type, StandardCharsets.US_ASCII);
                if (chunk.equals("IHDR")) {
                    ByteBuffer h = ByteBuffer.wrap(data);
                    width = h.getInt();
                    height = h.getInt();
                    assertEquals(file + " bit depth", 8, h.get());
                    assertEquals(file + " colour type is RGBA", 6, h.get());
                    h.get();
                    h.get();
                    assertEquals(file + " is not interlaced", 0, h.get());
                } else if (chunk.equals("IDAT")) {
                    idat.write(data);
                }
            }
            byte[] raw = inflate(idat.toByteArray(), height * (1 + width * 4));
            return new Rgba(width, height, unfilter(raw, width, height));
        }

        private static byte[] inflate(byte[] data, int size) throws IOException {
            Inflater inflater = new Inflater();
            inflater.setInput(data);
            byte[] out = new byte[size];
            try {
                int n = 0;
                while (n < size && !inflater.finished()) n += inflater.inflate(out, n, size - n);
                assertEquals("decompressed size", size, n);
            } catch (DataFormatException e) {
                throw new IOException(e);
            } finally {
                inflater.end();
            }
            return out;
        }

        private static byte[] unfilter(byte[] raw, int width, int height) {
            int stride = width * 4;
            byte[] out = new byte[height * stride];
            for (int y = 0; y < height; y++) {
                int filter = raw[y * (stride + 1)] & 0xFF;
                for (int x = 0; x < stride; x++) {
                    int v = raw[y * (stride + 1) + 1 + x] & 0xFF;
                    int a = x >= 4 ? out[y * stride + x - 4] & 0xFF : 0;
                    int b = y > 0 ? out[(y - 1) * stride + x] & 0xFF : 0;
                    int c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] & 0xFF : 0;
                    switch (filter) {
                        case 0: break;
                        case 1: v += a; break;
                        case 2: v += b; break;
                        case 3: v += (a + b) / 2; break;
                        case 4: {
                            int p = a + b - c;
                            int pa = Math.abs(p - a);
                            int pb = Math.abs(p - b);
                            int pc = Math.abs(p - c);
                            v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                            break;
                        }
                        default: throw new AssertionError("unknown PNG filter " + filter);
                    }
                    out[y * stride + x] = (byte) v;
                }
            }
            return out;
        }
    }
}
