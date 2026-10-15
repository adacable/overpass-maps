# Six store screenshots (1280x800): Chrome and Firefox, each with the popup over
# the map, the feature card, and the Street View mini-map.
# Usage: python3 scripts/store-screenshots/compose.py [raw dir] [out dir]
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
d = sys.argv[1] if len(sys.argv) > 1 else '.output/store-screenshots/raw'
out = sys.argv[2] if len(sys.argv) > 2 else '.output/store-screenshots'

def trim_popup(path):
    # The Firefox capture is the whole popup window: cut it below the content.
    im = Image.open(path).convert('RGB')
    bg = Image.new('RGB', im.size, im.getpixel((im.width - 2, im.height - 2)))
    box = ImageChops.difference(im, bg).getbbox()
    return im.crop((0, 0, im.width, min(im.height, box[3] + 14)))

def with_popup(base, pop):
    base = base.convert('RGBA'); pop = pop.convert('RGBA')
    w, h = pop.size
    x, y, r = base.width - w - 14, 8, 10
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
    shadow = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 4, x + w, y + h + 4), r, fill=(20, 26, 40, 110))
    base = Image.alpha_composite(base, shadow.filter(ImageFilter.GaussianBlur(10)))
    base.paste(pop, (x, y), mask)
    ImageDraw.Draw(base).rounded_rectangle((x, y, x + w - 1, y + h - 1), r, outline=(20, 26, 40, 45))
    return base

for browser, pre, popup in [('chrome', '', Image.open(f'{d}/search-popup.png')), ('firefox', 'ff-', trim_popup(f'{d}/ff-search-popup-raw.png'))]:
    shots = [
        ('1-search', with_popup(Image.open(f'{d}/{pre}search-map.png'), popup)),
        ('2-feature', Image.open(f'{d}/{pre}card-map.png')),
        ('3-streetview', Image.open(f'{d}/{pre}streetview-map.png')),
    ]
    for name, im in shots:
        im = im.convert('RGB')
        assert im.size == (1280, 800), (browser, name, im.size)
        im.save(f'{out}/{browser}-{name}.png')
        print(f'{browser}-{name}.png', im.size)
