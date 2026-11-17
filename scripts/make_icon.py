"""TouchLab icon: a little TouchDesigner-style operator network on a graphite tile.

Three operator nodes (green CHOP with a hand skeleton, purple TOP with quadtree squares,
blue SOP with particles) joined by glowing cyan-to-magenta wires. Small sizes (16-32 px)
get their own simplified art so the icon still reads on the taskbar.
"""
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "public"
ASSETS.mkdir(exist_ok=True)
PUBLIC.mkdir(exist_ok=True)

S = 1024
K = S / 256  # design in a 256 grid

CYAN = (41, 230, 255)
MAGENTA = (255, 61, 242)
CHOP = (79, 191, 106)
TOP = (155, 107, 255)
SOP = (63, 169, 255)


def P(x, y):
    return (round(x * K), round(y * K))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def background(size, radius_frac=0.22, dots=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        d.line((0, y, size, y), fill=lerp((30, 34, 46, 255), (9, 10, 15, 255), t))
    # faint radial lift behind the network
    lift = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(lift).ellipse((size * 0.1, size * 0.05, size * 0.95, size * 0.9), fill=(70, 60, 130, 70))
    lift = lift.filter(ImageFilter.GaussianBlur(size * 0.12))
    img = Image.alpha_composite(img, lift)
    if dots:
        d = ImageDraw.Draw(img)
        step = size / 16
        r = max(1, size / 420)
        for i in range(1, 16):
            for j in range(1, 16):
                cx, cy = i * step, j * step
                d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 26))
    mask = rounded_mask(size, round(size * radius_frac))
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return img, mask


def bezier(p0, p1, p2, p3, n=200):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]
        pts.append((x, y, t))
    return pts


def draw_wire(layer, a, b, width, alpha=255):
    """Gradient wire from a to b drawn as overlapping round dabs."""
    d = ImageDraw.Draw(layer)
    dx = abs(b[0] - a[0]) * 0.55
    pts = bezier(a, (a[0] + dx, a[1]), (b[0] - dx, b[1]), b, n=420)
    r = width / 2
    for x, y, t in pts:
        c = lerp(CYAN, MAGENTA, t) + (alpha,)
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)


def node(img, box, color, kind):
    """TouchDesigner-like operator tile: colored header strip, dark viewer with a thumbnail."""
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(img)
    rad = round(9 * K)
    # drop shadow
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 6 * K, y0 + 10 * K, x1 + 6 * K, y1 + 10 * K), radius=rad, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(10 * K))
    img.alpha_composite(sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=rad, fill=(28, 30, 36, 255), outline=color + (255,), width=round(3.2 * K))
    # header
    hh = round(11 * K)
    d.rounded_rectangle((x0 + 3 * K, y0 + 3 * K, x1 - 3 * K, y0 + hh), radius=round(6 * K), fill=color + (255,))
    # viewer
    vx0, vy0, vx1, vy1 = x0 + 7 * K, y0 + hh + 4 * K, x1 - 7 * K, y1 - 7 * K
    d.rectangle((vx0, vy0, vx1, vy1), fill=(8, 9, 12, 255))
    w, h = vx1 - vx0, vy1 - vy0
    if kind == "hand":
        # 21-point hand skeleton
        pts = [(0, 0), (-0.3, -0.2), (-0.55, -0.45), (-0.75, -0.65), (-0.92, -0.82),
               (-0.32, -0.95), (-0.38, -1.35), (-0.41, -1.6), (-0.43, -1.82),
               (0, -1), (0, -1.45), (0, -1.72), (0, -1.95),
               (0.28, -0.93), (0.32, -1.33), (0.34, -1.57), (0.36, -1.77),
               (0.52, -0.82), (0.6, -1.1), (0.64, -1.3), (0.67, -1.47)]
        edges = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10), (10, 11), (11, 12),
                 (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17)]
        sc = h * 0.42
        ox, oy = vx0 + w * 0.55, vy1 - h * 0.1
        q = [(ox + px * sc, oy + py * sc) for px, py in pts]
        for a, b in edges:
            d.line((q[a], q[b]), fill=(160, 255, 190, 255), width=round(2.2 * K))
        r = 2.4 * K
        for x, y in q:
            d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 255))
    elif kind == "quad":
        def sub(x, y, s, depth, seed):
            d.rectangle((x, y, x + s, y + s), outline=(235, 230, 255, 255), width=max(1, round((2.2 - depth * 0.45) * K)))
            if depth < 3 and (seed * 7 + depth * 3) % 5 not in (1,):
                hs = s / 2
                for i, (dx, dy) in enumerate(((0, 0), (hs, 0), (0, hs), (hs, hs))):
                    if (seed + i * 3 + depth) % 4 != 0 or depth == 0:
                        sub(x + dx, y + dy, hs, depth + 1, seed * 3 + i)
        s = min(w, h) * 0.92
        sub(vx0 + (w - s) / 2, vy0 + (h - s) / 2, s, 0, 2)
    elif kind == "dots":
        import random
        rnd = random.Random(7)
        for _ in range(170):
            a = rnd.random() * math.tau
            rr = (rnd.random() ** 0.6) * 0.46
            x = vx0 + w * (0.5 + math.cos(a) * rr)
            y = vy0 + h * (0.5 + math.sin(a) * rr * 0.9)
            r = (0.8 + rnd.random() * 1.6) * K
            c = lerp((120, 200, 255), (255, 255, 255), rnd.random())
            d.ellipse((x - r, y - r, x + r, y + r), fill=c + (255,))
    # connector nubs
    my = (y0 + y1) / 2
    for cx in (x0, x1):
        d.ellipse((cx - 4.5 * K, my - 4.5 * K, cx + 4.5 * K, my + 4.5 * K), fill=(230, 232, 240, 255))


def big_icon():
    img, mask = background(S)
    A = (P(26, 40)[0], P(26, 40)[1], P(104, 112)[0], P(104, 112)[1])   # CHOP, top-left
    C = (P(26, 144)[0], P(26, 144)[1], P(104, 216)[0], P(104, 216)[1])  # SOP, bottom-left
    B = (P(148, 88)[0], P(148, 88)[1], P(232, 168)[0], P(232, 168)[1])  # TOP, right
    a_out = (A[2], (A[1] + A[3]) / 2)
    c_out = (C[2], (C[1] + C[3]) / 2)
    b_in = (B[0], (B[1] + B[3]) / 2)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_wire(glow, a_out, b_in, 26 * K, 200)
    draw_wire(glow, c_out, b_in, 26 * K, 200)
    glow = glow.filter(ImageFilter.GaussianBlur(9 * K))
    img.alpha_composite(glow)
    core = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_wire(core, a_out, b_in, 7.5 * K)
    draw_wire(core, c_out, b_in, 7.5 * K)
    hot = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hot)
    for a in (a_out, c_out):
        dx = abs(b_in[0] - a[0]) * 0.55
        for x, y, t in bezier(a, (a[0] + dx, a[1]), (b_in[0] - dx, b_in[1]), b_in, n=420):
            r = 1.6 * K
            hd.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 210))
    img.alpha_composite(core)
    img.alpha_composite(hot)
    node(img, A, CHOP, "hand")
    node(img, C, SOP, "dots")
    node(img, B, TOP, "quad")
    d = ImageDraw.Draw(img)
    # REC dot with glow
    rec = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rec).ellipse((P(206, 30), P(230, 54)), fill=(255, 59, 74, 230))
    img.alpha_composite(rec.filter(ImageFilter.GaussianBlur(8 * K)))
    d.ellipse((P(209, 33), P(227, 51)), fill=(255, 70, 86, 255))
    d.ellipse((P(212, 36), P(218, 42)), fill=(255, 190, 196, 255))
    # rim highlight + outline
    d.rounded_rectangle((P(2, 2), P(253, 253)), radius=round(54 * K), outline=(255, 255, 255, 40), width=round(1.6 * K))
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return img


def small_icon(size):
    """Simplified art for 16/24/32 px: one purple node + glowing wire into it + REC dot."""
    s = size * 8
    img, mask = background(s, radius_frac=0.2, dots=False)
    k = s / 32
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    a = (3 * k, 9 * k)
    b = (15 * k, 18 * k)
    draw_wire(glow, a, b, 6 * k, 230)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(2 * k)))
    core = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw_wire(core, a, b, 2.6 * k)
    img.alpha_composite(core)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((15 * k, 10 * k, 29 * k, 27 * k), radius=round(3 * k), fill=(28, 30, 36, 255), outline=TOP + (255,), width=round(1.6 * k))
    d.rectangle((16.5 * k, 11.5 * k, 27.5 * k, 14 * k), fill=TOP + (255,))
    d.rectangle((17.5 * k, 16 * k, 26.5 * k, 25.5 * k), outline=(235, 230, 255, 255), width=max(1, round(1.1 * k)))
    d.line((22 * k, 16 * k, 22 * k, 25.5 * k), fill=(235, 230, 255, 255), width=max(1, round(1 * k)))
    d.line((17.5 * k, 20.75 * k, 26.5 * k, 20.75 * k), fill=(235, 230, 255, 255), width=max(1, round(1 * k)))
    d.ellipse((22.5 * k, 2.5 * k, 28.5 * k, 8.5 * k), fill=(255, 59, 74, 255))
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return img.resize((size, size), Image.Resampling.LANCZOS)


big = big_icon()
big.resize((256, 256), Image.Resampling.LANCZOS).save(ASSETS / "touchlab-icon.png")
big.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS / "touchlab-icon-512.png")
big.resize((64, 64), Image.Resampling.LANCZOS).save(PUBLIC / "favicon.png")
# Pillow only resizes from the LAST appended image for sizes it wasn't given, so pass every size.
frames = [small_icon(n) for n in (16, 24, 32)] + [big.resize((n, n), Image.Resampling.LANCZOS) for n in (48, 64, 128)]
big.resize((256, 256), Image.Resampling.LANCZOS).save(
    ASSETS / "touchlab.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    append_images=frames,
)
print(ASSETS / "touchlab.ico")
