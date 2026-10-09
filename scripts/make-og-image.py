import math, pathlib
from playwright.sync_api import sync_playwright
# Immagine di anteprima dei link (Facebook, WhatsApp...): python3 scripts/make-og-image.py
# Font: npm i --no-save @fontsource/saira-condensed@5.1.0 @fontsource/source-sans-3@5.1.0 @fontsource/jetbrains-mono@5.1.0
ROOT = pathlib.Path(__file__).resolve().parent.parent
SP = ROOT / 'node_modules' / '.cache'
SP.mkdir(parents=True, exist_ok=True)
F = ROOT / 'node_modules/@fontsource'
logo = (ROOT / 'icons/icon.svg').read_text().strip().replace('<svg ', '<svg class="logo" width="150" height="150" ', 1)

# profilo stilizzato: tratti colorati per modalità e waypoint numerati
W, H, base = 1200, 250, 250
cols = {'eco': '#2FA37F', 'auto': '#4A7FCC', 'trail': '#E39A2B', 'turbo': '#DE4450'}
# tratti (lunghezza px, pendenza visiva, modalità): la modalità segue la pendenza come nel piano
SEG = [(140, 0.02, 'eco'), (170, 0.13, 'auto'), (150, 0.30, 'trail'), (90, 0.55, 'turbo'), (130, -0.28, 'turbo'),
       (130, 0.01, 'eco'), (150, 0.14, 'auto'), (120, 0.33, 'trail'), (190, -0.12, 'trail')]
knots, x, y = [(0, 14)], 0, 14
for L, g, m in SEG:
    x += L; y += L * g * 0.85; knots.append((x, y))
def ele(xq):
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if xq <= x1:
            u = (xq - x0) / (x1 - x0); u = u * u * (3 - 2 * u) * 0.35 + u * 0.65
            return y0 + (y1 - y0) * u
    return knots[-1][1]
runs, x = [], 0
for L, g, m in SEG:
    if runs and runs[-1][2] == m: runs[-1] = (runs[-1][0], x + L, m)
    else: runs.append((x, x + L, m))
    x += L
paths, marks = [], []
for i, (a, b, m) in enumerate(runs):
    pts = [(x, base - ele(x)) for x in range(a, b + 1, 4)] + [(b, base - ele(b))]
    line = 'L'.join('%.1f,%.1f' % p for p in pts)
    paths.append('<path d="M%d,%dL%sL%d,%dZ" fill="%s" fill-opacity=".35"/><path d="M%s" fill="none" stroke="%s" stroke-width="4" stroke-linejoin="round"/>' % (a, H, line, b, H, cols[m], line, cols[m]))
    if i:
        y = base - ele(a)
        marks.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="%s" stroke-width="2" stroke-dasharray="3 4"/><circle cx="%d" cy="%.1f" r="15" fill="%s"/><text x="%d" y="%.1f" text-anchor="middle" font-family="JetBrains Mono" font-weight="600" font-size="15" fill="#161A19">%d</text>' % (a, a, y - 46, y, cols[m], a, y - 60, cols[m], a, y - 55, i))
profile = '<svg viewBox="0 0 %d %d" width="%d" height="%d" style="display:block">%s%s</svg>' % (W, H, W, H, ''.join(paths), ''.join(marks))

html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Saira Condensed"; font-weight: 700; src: url("{(F/'saira-condensed/files/saira-condensed-latin-700-normal.woff2').as_uri()}"); }}
@font-face {{ font-family: "Saira Condensed"; font-weight: 600; src: url("{(F/'saira-condensed/files/saira-condensed-latin-600-normal.woff2').as_uri()}"); }}
@font-face {{ font-family: "Source Sans 3"; font-weight: 400; src: url("{(F/'source-sans-3/files/source-sans-3-latin-400-normal.woff2').as_uri()}"); }}
@font-face {{ font-family: "Source Sans 3"; font-weight: 600; src: url("{(F/'source-sans-3/files/source-sans-3-latin-600-normal.woff2').as_uri()}"); }}
@font-face {{ font-family: "JetBrains Mono"; font-weight: 600; src: url("{(F/'jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2').as_uri()}"); }}
html, body {{ margin: 0; }}
body {{ width: 1200px; height: 630px; background: #161A19; color: #ECEFED; font-family: "Source Sans 3"; position: relative; overflow: hidden; }}
.top {{ position: absolute; left: 72px; top: 52px; right: 72px; display: flex; gap: 40px; align-items: center; }}
.logo {{ flex: none; border-radius: 34px; box-shadow: 0 0 0 2px #2B3331; }}
h1 {{ margin: 0; font-family: "Saira Condensed"; font-weight: 700; font-size: 92px; line-height: .9; text-transform: uppercase; letter-spacing: -.005em; }}
.eyebrow {{ font-family: "JetBrains Mono"; font-weight: 600; font-size: 19px; letter-spacing: .1em; color: #98A29E; text-transform: uppercase; margin-bottom: 14px; }}
.sub {{ position: absolute; left: 72px; right: 72px; top: 286px; display: grid; gap: 6px; }}
.sub p {{ margin: 0; font-size: 31px; line-height: 1.2; }}
.sub p.en {{ color: #98A29E; font-size: 27px; }}
.modes {{ display: flex; gap: 10px; margin-top: 10px; }}
.modes span {{ font-family: "Saira Condensed"; font-weight: 700; font-size: 26px; letter-spacing: .03em; padding: 0 14px; border-left: 6px solid; }}
.prof {{ position: absolute; left: 0; right: 0; bottom: 0; }}
.sub p.url {{ font-family: "JetBrains Mono"; font-weight: 600; font-size: 19px; letter-spacing: .04em; color: #98A29E; margin-top: 6px; }}
</style></head><body>
<div class="top">{logo}<div><div class="eyebrow">DJI Avinox M2 · M2S · IT / EN</div><h1>Avinox<br>Mode Planner</h1></div></div>
<div class="sub">
  <p>Come impostare le modalità e quando cambiarle lungo il giro.</p>
  <p class="en">Mode settings and when to change them along your ride.</p>
  <p class="url">Gratis · Free · avinox-planner.pages.dev</p>
</div>
<div class="prof">{profile}</div>
</body></html>'''
(SP / 'og.html').write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    pg.goto((SP / 'og.html').as_uri())
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(ROOT / 'og-image.png'))
    b.close()
print('ok')
