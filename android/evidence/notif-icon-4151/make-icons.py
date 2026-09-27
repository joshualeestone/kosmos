#!/usr/bin/env python3
"""#4151: renders res/drawable-<density>/ic_notification.png, the delegated-notification small icon.

The shape is the old vector's (a planet of radius 4.5 and a 9.5 x 3.5 orbit ring, stroke 1.5, on a
24 x 24 viewport), drawn white on transparent at 24dp for each density, 16x supersampled.

  python3 android/evidence/notif-icon-4151/make-icons.py

Needs Pillow (`python3 -m pip install Pillow`).
"""
import os

from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'app', 'src', 'main', 'res')
SS = 16

for density, px in (('mdpi', 24), ('hdpi', 36), ('xhdpi', 48), ('xxhdpi', 72), ('xxxhdpi', 96)):
    size = px * SS
    u = size / 24.0
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([(12 - 4.5) * u, (12 - 4.5) * u, (12 + 4.5) * u, (12 + 4.5) * u], fill=255)
    w = 1.5 * u
    draw.ellipse([(12 - 9.5) * u - w / 2, (12 - 3.5) * u - w / 2, (12 + 9.5) * u + w / 2, (12 + 3.5) * u + w / 2],
                 outline=255, width=round(w))
    icon = Image.new('RGBA', (px, px), (255, 255, 255, 0))
    icon.putalpha(mask.resize((px, px), Image.LANCZOS))
    folder = os.path.join(RES, 'drawable-' + density)
    os.makedirs(folder, exist_ok=True)
    icon.save(os.path.join(folder, 'ic_notification.png'), optimize=True)
