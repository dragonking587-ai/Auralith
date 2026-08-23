#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path("src-tauri/icons")
out.mkdir(parents=True, exist_ok=True)


def make(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (9, 9, 11, 255))
    d = ImageDraw.Draw(img)
    pad = max(2, size // 16)
    d.rounded_rectangle((pad, pad, size - pad - 1, size - pad - 1), radius=size // 6, fill=(18, 16, 20, 255), outline=(232, 196, 160, 255), width=max(1, size // 32))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", size // 2)
    except OSError:
        font = ImageFont.load_default()
    text = "A"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2, (size - th) / 2 - size * 0.06), text, font=font, fill=(244, 244, 241, 255))
    return img


for s in (32, 128, 256):
    make(s).save(out / f"{s}x{s}.png")
make(128).save(out / "128x128@2x.png")
imgs = [make(s) for s in (16, 32, 48, 64, 128, 256)]
imgs[0].save(out / "icon.ico", sizes=[(i.width, i.height) for i in imgs], format="ICO")
print("wrote", out)
