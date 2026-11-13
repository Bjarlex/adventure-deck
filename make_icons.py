# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "pillow>=10",
# ]
# ///
"""Draw the app icons into icons/ (run once; the PNGs are committed)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "icons"
OUT.mkdir(exist_ok=True)
S = 1024  # draw large, then downscale for smooth edges

NAVY, TEAL, OCHRE, RED, CREAM = "#16324f", "#1f7a74", "#e0a526", "#c8473b", "#f6efe2"


def card(size, angle, fill, offset):
    """A rounded playing card, rotated, as an RGBA layer."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    w, h = size
    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(c).rounded_rectangle((0, 0, w - 1, h - 1), radius=56, fill=fill, outline=CREAM, width=18)
    c = c.rotate(angle, expand=True, resample=Image.BICUBIC)
    layer.alpha_composite(c, (S // 2 - c.width // 2 + offset[0], S // 2 - c.height // 2 + offset[1]))
    return layer


def draw(pad=0):
    img = Image.new("RGBA", (S, S), NAVY)
    scale = 1 - pad
    cw, ch = int(400 * scale), int(560 * scale)
    img.alpha_composite(card((cw, ch), 14, TEAL, (int(-110 * scale), 10)))
    img.alpha_composite(card((cw, ch), -10, OCHRE, (int(110 * scale), -10)))
    front = card((cw, ch), 0, CREAM, (0, 30))
    img.alpha_composite(front)
    d = ImageDraw.Draw(img)
    # Map pin on the front card
    cx, cy, r = S // 2, S // 2 - int(30 * scale), int(105 * scale)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=RED)
    d.polygon([(cx - int(r * 0.77), cy + int(r * 0.64)), (cx + int(r * 0.77), cy + int(r * 0.64)), (cx, cy + int(r * 2.1))], fill=RED)
    d.ellipse((cx - r // 2.4, cy - r // 2.4, cx + r // 2.4, cy + r // 2.4), fill=CREAM)
    # Little waves under the pin (the harbour)
    for i, y in enumerate((cy + int(r * 2.5), cy + int(r * 2.95))):
        x0 = cx - int(130 * scale)
        pts = [(x0 + k * int(26 * scale), y + (12 if k % 2 else -12) * scale) for k in range(11)]
        d.line(pts, fill=TEAL, width=int(16 * scale), joint="curve")
    return img.convert("RGB")


plain = draw()
for size in (180, 192, 512):
    plain.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
draw(pad=0.22).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png", optimize=True)
print("icons written to", OUT)
