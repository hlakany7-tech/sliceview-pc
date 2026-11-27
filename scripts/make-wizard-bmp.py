# Draws the installer's welcome/finish side image (164x314, 24-bit BMP) from the app icon.
# Run: python3 scripts/make-wizard-bmp.py   (needs Pillow; the result is committed, so builds do not need it)
from PIL import Image, ImageDraw, ImageFont
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 164, 314
img = Image.new('RGB', (W, H), (10, 14, 16))
d = ImageDraw.Draw(img)
for y in range(H):  # soft vertical shade
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(10 + 8 * t), int(14 + 12 * t), int(16 + 16 * t)))
icon = Image.open(os.path.join(root, 'icon-512.png')).convert('RGBA').resize((104, 104), Image.LANCZOS)
img.paste(icon, ((W - 104) // 2, 70), icon)
def font(size, bold=False):
    for f in (['DejaVuSans-Bold.ttf'] if bold else ['DejaVuSans.ttf']):
        for base in ('/usr/share/fonts/truetype/dejavu/',):
            p = base + f
            if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()
def center(text, y, f, fill):
    w = d.textlength(text, font=f); d.text(((W - w) / 2, y), text, font=f, fill=fill)
center('Sliceview', 196, font(20, True), (227, 234, 237))
center('DICOM viewer', 224, font(11), (141, 156, 164))
d.line([(52, 250), (112, 250)], fill=(140, 196, 255), width=2)
img.save(os.path.join(root, 'build', 'installer', 'wizard.bmp'))
print('build/installer/wizard.bmp written')
