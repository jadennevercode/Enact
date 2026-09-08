"""Build outlined SVG identity assets. Requires fonttools[woff]."""

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)
GREEN = "#86BC25"
TOP = "M12 28L60 16L108 28L60 40Z"
MIDDLE = "M12 60L60 48L108 60L60 72Z"
BOTTOM = "M12 92L60 80L108 92L60 104Z"


def mark(ink, accent):
    return (f'<path fill="{ink}" d="{TOP}"/>'
            f'<path fill="{accent}" d="{MIDDLE}"/>'
            f'<path fill="{ink}" d="{BOTTOM}"/>')


def svg(name, width, height, body, description):
    content = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" aria-label="Enact">\n'
        f'  <title>Enact — Three Diamonds</title>\n  <desc>{description}</desc>\n'
        f'  {body}\n</svg>\n'
    )
    (OUT / name).write_text(content)


font = instantiateVariableFont(TTFont(ROOT / "fonts/open-sans-latin.woff2"), {"wght": 600})
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
scale = 90 / font["OS/2"].sCapHeight
x = 144
paths = []
for char in "Enact":
    name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 105)))
    paths.append(pen.getCommands())
    x += (font["hmtx"][name][0] - 32) * scale
width = round(x + 14)

for variant, ink, accent in [
    ("light", "#000000", GREEN),
    ("dark", "#FFFFFF", GREEN),
    ("black", "#000000", "#000000"),
    ("white", "#FFFFFF", "#FFFFFF"),
]:
    svg(f"enact-mark-{variant}.svg", 120, 120, mark(ink, accent),
        "Three horizontal diamonds stacked vertically. The central diamond carries the accent color.")
    letters = "".join(f'<path d="{d}"/>' for d in paths)
    svg(f"enact-lockup-{variant}.svg", width, 120,
        mark(ink, accent) + f'<g fill="{ink}">{letters}</g>',
        "Enact identity with an outlined Open Sans Semibold wordmark. No font dependency.")

for variant, bg, ink in [("dark", "#000000", "#FFFFFF"), ("light", "#FFFFFF", "#000000")]:
    svg(f"enact-app-{variant}.svg", 1024, 1024,
        f'<path fill="{bg}" d="M0 0H1024V1024H0Z"/>'
        f'<g transform="translate(192 192) scale(5.3333333333)">{mark(ink, GREEN)}</g>',
        "Square app icon master with safe inset. The platform applies its own mask.")

print(f"Built 10 SVG assets; outlined lockup: {width} × 120.")
