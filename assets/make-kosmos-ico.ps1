# Generate assets/kosmos.ico, the Windows launcher's icon, from the rounded master.
#
#   powershell -ExecutionPolicy Bypass -File assets/make-kosmos-ico.ps1 [-Out <path>]
#
# WHY FROM Kosmos-1024-shaped.png. That is the master the macOS .icns and the web
# icons are rendered from (.claude/plans/app-icon-20260813T2110.md), so the Windows
# icon is the same gold tile rather than a third interpretation of the artwork.
#
# WHY IT IS CROPPED. The shaped master sits on the macOS icon grid: an 824px tile
# with a transparent margin for the Dock's shadow. Windows does not pad icons that
# way, so at 16px that margin would spend a fifth of the pixels on nothing. The
# crop is DERIVED from the master's own alpha (the tile is every pixel at least
# half opaque; the shadow is fainter), never typed in, so a new master with a
# different grid crops correctly with no edit here.
#
# WHY THESE FOUR SIZES. 16 (title bar, small icons), 32 (desktop at 100%, Alt-Tab),
# 48 (Explorer medium icons) and 256 (large icons, and every size above 48 at high
# DPI, scaled down by Windows). 16/32/48 are 32-bit DIB entries, which every reader
# of .ico understands; 256 is PNG-compressed, the standard form at that size.
#
# WINDOWS-ONLY, like tools/windows/verify-launcher.ps1: it uses System.Drawing (GDI+).
# Two runs on one machine produce identical bytes. The committed .ico is what the
# launcher build (/win32icon:) and tools.win-launcher-native.test.js read.

param([string]$Out)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$master = Join-Path $here 'Kosmos-1024-shaped.png'
if (-not $Out) { $Out = Join-Path $here 'kosmos.ico' }
# .NET file APIs resolve a relative path against the PROCESS directory, not
# PowerShell's current location, so resolve it here first.
$Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
if (-not (Test-Path -LiteralPath $master)) { Write-Error "missing the icon master: $master"; exit 2 }

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class KosmosIcoMaker
{
    public static readonly int[] IconSizes = { 16, 32, 48, 256 };

    // The tile is every pixel at least half opaque. The master's soft shadow is
    // fainter than this everywhere, so it does not widen the crop.
    const int TileAlphaThreshold = 128;

    // Breathing room on each side of the tile, as a fraction of its width, so the
    // rounded corners do not touch the icon's edge at 256px.
    const double MarginFractionPerSide = 0.02;

    // Entries this size and larger are stored as PNG; smaller ones as DIBs.
    const int SmallestPngEntry = 256;

    public static void Make(string masterPath, string outPath)
    {
        using (Bitmap master = new Bitmap(masterPath))
        {
            Rectangle crop = SquareAroundTile(master);
            byte[][] entries = new byte[IconSizes.Length][];
            for (int i = 0; i < IconSizes.Length; i++)
            {
                using (Bitmap sized = Render(master, crop, IconSizes[i]))
                {
                    entries[i] = IconSizes[i] >= SmallestPngEntry ? PngBytes(sized) : DibBytes(sized);
                }
            }
            WriteIco(outPath, entries);
        }
    }

    static byte[] ArgbPixels(Bitmap bitmap)
    {
        Rectangle all = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(all, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            // Format32bppArgb is four bytes a pixel with no row padding, laid out
            // B, G, R, A in memory: exactly the order an icon DIB stores.
            byte[] pixels = new byte[bitmap.Width * bitmap.Height * 4];
            for (int y = 0; y < bitmap.Height; y++)
            {
                Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), pixels, y * bitmap.Width * 4, bitmap.Width * 4);
            }
            return pixels;
        }
        finally { bitmap.UnlockBits(data); }
    }

    static Rectangle SquareAroundTile(Bitmap master)
    {
        byte[] pixels = ArgbPixels(master);
        int minX = master.Width, minY = master.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < master.Height; y++)
        {
            for (int x = 0; x < master.Width; x++)
            {
                if (pixels[(y * master.Width + x) * 4 + 3] < TileAlphaThreshold) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) throw new InvalidOperationException("the icon master has no opaque tile to crop to");
        int tileWidth = maxX - minX + 1, tileHeight = maxY - minY + 1;
        int side = (int)Math.Round(Math.Max(tileWidth, tileHeight) * (1 + 2 * MarginFractionPerSide));
        int centreX2 = minX + maxX + 1, centreY2 = minY + maxY + 1;
        return new Rectangle((centreX2 - side) / 2, (centreY2 - side) / 2, side, side);
    }

    static Bitmap Render(Bitmap master, Rectangle crop, int size)
    {
        Bitmap sized = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(sized))
        using (ImageAttributes edges = new ImageAttributes())
        {
            g.Clear(Color.Transparent);
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;
            // Without this GDI+ blends the transparent void past the crop's edge
            // into the outermost pixels, leaving a faint dark rim.
            edges.SetWrapMode(WrapMode.TileFlipXY);
            g.DrawImage(master, new Rectangle(0, 0, size, size), crop.X, crop.Y, crop.Width, crop.Height, GraphicsUnit.Pixel, edges);
        }
        return sized;
    }

    static byte[] PngBytes(Bitmap sized)
    {
        using (MemoryStream png = new MemoryStream())
        {
            sized.Save(png, ImageFormat.Png);
            return png.ToArray();
        }
    }

    // A 32-bit icon DIB: a BITMAPINFOHEADER whose height counts the colour rows
    // and the AND-mask rows, then the colour rows bottom-up, then the 1-bit mask
    // (set where the pixel is fully transparent), each mask row padded to 4 bytes.
    static byte[] DibBytes(Bitmap sized)
    {
        int w = sized.Width, h = sized.Height;
        byte[] pixels = ArgbPixels(sized);
        int maskStride = ((w + 31) / 32) * 4;
        using (MemoryStream dib = new MemoryStream())
        using (BinaryWriter bw = new BinaryWriter(dib))
        {
            bw.Write(40); bw.Write(w); bw.Write(h * 2);
            bw.Write((short)1); bw.Write((short)32);
            bw.Write(0); bw.Write(w * h * 4 + maskStride * h);
            bw.Write(0); bw.Write(0); bw.Write(0); bw.Write(0);
            for (int y = h - 1; y >= 0; y--) bw.Write(pixels, y * w * 4, w * 4);
            for (int y = h - 1; y >= 0; y--)
            {
                byte[] row = new byte[maskStride];
                for (int x = 0; x < w; x++)
                {
                    if (pixels[(y * w + x) * 4 + 3] == 0) row[x >> 3] |= (byte)(0x80 >> (x & 7));
                }
                bw.Write(row);
            }
            bw.Flush();
            return dib.ToArray();
        }
    }

    static void WriteIco(string outPath, byte[][] entries)
    {
        using (FileStream file = new FileStream(outPath, FileMode.Create, FileAccess.Write))
        using (BinaryWriter bw = new BinaryWriter(file))
        {
            bw.Write((short)0); bw.Write((short)1); bw.Write((short)entries.Length);
            int offset = 6 + 16 * entries.Length;
            for (int i = 0; i < entries.Length; i++)
            {
                // An ICONDIRENTRY stores 256 as 0: the field is one byte.
                byte dimension = (byte)(IconSizes[i] >= 256 ? 0 : IconSizes[i]);
                bw.Write(dimension); bw.Write(dimension);
                bw.Write((byte)0); bw.Write((byte)0);
                bw.Write((short)1); bw.Write((short)32);
                bw.Write(entries[i].Length); bw.Write(offset);
                offset += entries[i].Length;
            }
            foreach (byte[] entry in entries) bw.Write(entry);
        }
    }
}
'@

[KosmosIcoMaker]::Make($master, $Out)
$bytes = (Get-Item -LiteralPath $Out).Length
Write-Host ("wrote " + $Out + " (" + $bytes + " bytes; " + ([KosmosIcoMaker]::IconSizes -join ', ') + " px)")
