import math, pathlib
from playwright.sync_api import sync_playwright
d = pathlib.Path(__file__).resolve().parent.parent / 'icons'  # rigenera le icone: python3 scripts/make-icons.py (serve Playwright)
t = math.tan(math.radians(12))
BG, FG = '#161A19', '#ECEFED'
COLS = ['#2FA37F', '#4A7FCC', '#E39A2B', '#DE4450']   # ECO, AUTO, TRAIL, TURBO

def mark():
    """Quattro barre inclinate che salgono come un profilo, e il waypoint sopra l'ultima."""
    w, gap, bottom, x0 = 58, 22, 404, 92
    heights = [96, 150, 204, 258]
    out, last = [], None
    for i, h in enumerate(heights):
        x = x0 + i * (w + gap); s = h * t
        pts = [(x, bottom), (x + w, bottom), (x + w + s, bottom - h), (x + s, bottom - h)]
        out.append('<polygon fill="%s" points="%s"/>' % (COLS[i], ' '.join('%.1f,%.1f' % p for p in pts)))
        last = pts
    mx = (last[2][0] + last[3][0]) / 2; ty = last[2][1]; py = ty - 66; r = 30
    out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 11"/>' % (mx, py + r + 8, mx, ty - 8, FG))
    out.append('<circle cx="%.1f" cy="%.1f" r="%d" fill="%s"/>' % (mx, py, r, FG))
    out.append('<circle cx="%.1f" cy="%.1f" r="12.6" fill="%s"/>' % (mx, py, BG))
    return '\n    '.join(out)

def svg(rounded, scale, dx, dy):
    rx = ' rx="112"' if rounded else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n'
            '  <rect width="512" height="512"%s fill="%s"/>\n'
            '  <g transform="translate(%g %g) scale(%g)">\n    %s\n  </g>\n</svg>\n') % (rx, BG, dx, dy, scale, mark())

icon = svg(True, 1, -22, 14)
# maskable: contenuto nel cerchio sicuro (80%), sfondo pieno
s = 0.74
mask = svg(False, s, 256 - 256 * s - 18 * s, 256 - 256 * s + 14 * s)
(d / 'icon.svg').write_text(icon)
(d / 'icon-maskable.svg').write_text(mask)

with sync_playwright() as p:
    b = p.chromium.launch()
    def render(src, size, out, transparent=True):
        pg = b.new_page(viewport={'width': size, 'height': size})
        pg.set_content('<html><body style="margin:0;background:transparent">' + src.replace('<svg ', '<svg width="%d" height="%d" ' % (size, size), 1) + '</body></html>')
        pg.screenshot(path=str(d / out), omit_background=transparent)
        pg.close()
    render(icon, 512, 'icon-512.png'); render(icon, 192, 'icon-192.png'); render(icon, 32, 'favicon-32.png')
    render(mask, 512, 'icon-maskable-512.png', transparent=False)
    k = 0.9   # iOS arrotonda da sé gli angoli: basta un margine più piccolo della maskable
    apple = svg(False, k, 256 - 256 * k - 20 * k, 256 - 256 * k + 14 * k)
    render(apple, 180, 'apple-touch-icon.png', transparent=False)
    b.close()
