"""
水墨素材（画框的几笔、收束那一笔）：照毛笔的样子一根根毫走出来，不是描一条粗线。
毫聚成一缕一缕，每缕沾墨的多少不一样，走得越远墨越干，沾不到的地方露出纸，就是飞白。
起笔按下去、中段提着走、收笔出锋：笔宽跟着压力变，毫尖参差，尾巴自己散开。
出来是带透明的 webp，放 public/frame/。用法：python -X utf8 tools/ink_art.py <输出目录> [名字...]
"""
import math
import sys
from pathlib import Path

import cv2
import numpy as np


def noise(h, w, cell, rng):
    """一层平滑噪声：小图放大，cell 是一个起伏多少像素"""
    a = rng.random((max(2, h // cell + 2), max(2, w // cell + 2))).astype(np.float32)
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_CUBIC)


def fbm(h, w, cell, rng, oct=4):
    out, amp, tot = np.zeros((h, w), np.float32), 1.0, 0.0
    for _ in range(oct):
        out += noise(h, w, max(2, cell), rng) * amp
        tot += amp
        amp *= 0.5
        cell //= 2
    return out / tot


def curve(pts, n):
    """过这几个点的平滑线（Catmull-Rom），按弧长等分成 n 个点"""
    p = np.array([pts[0]] + list(pts) + [pts[-1]], np.float64)
    out = []
    for i in range(1, len(p) - 2):
        for t in np.linspace(0, 1, 60, endpoint=False):
            a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3))
    out.append(p[-2])
    out = np.array(out)
    s = np.r_[0, np.cumsum(np.hypot(*np.diff(out, axis=0).T))]
    u = np.linspace(0, s[-1], n)
    return np.stack([np.interp(u, s, out[:, 0]), np.interp(u, s, out[:, 1])], 1)


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def streaks(n, m, rng):
    """毫聚成一缕一缕：横向变化快、顺着笔走的方向很长。排成 0～1 均匀分布，于是"干到 T"就正好有 T 这么多地方没沾到墨"""
    s = np.zeros((n, m), np.float32)
    for cols, rows, w in [(6, 3, 0.34), (17, 5, 0.28), (48, 8, 0.22), (170, 12, 0.16)]:
        s += w * cv2.resize(rng.random((rows, cols)).astype(np.float32), (m, n), interpolation=cv2.INTER_CUBIC)
    q = np.quantile(s[::5, ::5], np.linspace(0, 1, 512))
    return np.interp(s, q, np.linspace(0, 1, 512)).astype(np.float32)


def brush(H, W, pts, width, press, rng, dry=0.8, tail=0.22, power=1.5, grain=0.26):
    """
    走一笔，返回落在纸上的墨（0～1）。在"笔的坐标"里算（u 顺着笔走，v 横着笔），再贴回画面：
    S 是每一缕毫沾到纸的难易，T(u) 是走到这里墨干到什么程度，S 过不了 T 的地方就是飞白；
    pts：笔走过的点；width：最粗时半宽；press(u)：这一处压多重；dry：走到头有几成露纸；tail：尾巴毫尖参差多长（占全长几成）；
    grain：沾墨少的那几缕淡多少，湿的地方也看得见笔毫，不是一片死黑
    """
    length = float(np.sum(np.hypot(*np.diff(np.array(pts, np.float64), axis=0).T)))
    n, m = int(length * 1.7), int(width * 3.6)
    c = curve(pts, n).astype(np.float32)
    tan = np.gradient(c, axis=0)
    tan /= np.maximum(np.hypot(tan[:, 0], tan[:, 1]), 1e-6)[:, None]
    nor = np.stack([-tan[:, 1], tan[:, 0]], 1)
    u = np.linspace(0, 1, n, dtype=np.float32)[:, None]
    v = np.linspace(-1, 1, m, dtype=np.float32)[None, :]
    S = streaks(n, m, rng)
    S = S + (rng.random((n, m)).astype(np.float32) - 0.5) * 0.09      # 纸的颗粒把飞白的边咬毛
    T = dry * u ** power + 0.34 * np.abs(v) ** 3.5 * (0.3 + u)        # 外圈的毫干得快
    a = smooth(T - 0.015, T + 0.05, S) * (1 - grain * (1 - smooth(0.1, 0.62, S)))
    tip = cv2.resize(rng.random((1, max(8, m // 4))).astype(np.float32), (m, 1), interpolation=cv2.INTER_LINEAR)
    end = 1 - tail * tip ** 1.4 * (0.35 + 0.65 * np.abs(v))           # 毫尖参差，收笔不是齐的
    a *= np.clip((end - u) / 0.012, 0, 1)
    p = cv2.GaussianBlur(np.array([press(float(x)) for x in u[:, 0]], np.float32)[:, None], (1, 0), 0, sigmaY=n * 0.018)
    up = cv2.resize(rng.random((max(6, n // 160), 1)).astype(np.float32), (1, n), interpolation=cv2.INTER_CUBIC) - 0.5
    lo = cv2.resize(rng.random((max(6, n // 160), 1)).astype(np.float32), (1, n), interpolation=cv2.INTER_CUBIC) - 0.5
    wob = np.where(v > 0, 1 + 0.16 * up, 1 + 0.16 * lo)               # 两边各抖各的
    r = width * p * wob
    x = c[:, 0:1] + nor[:, 0:1] * v * r
    y = c[:, 1:2] + nor[:, 1:2] * v * r
    xi, yi = np.round(x).astype(np.int32), np.round(y).astype(np.int32)
    keep = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H) & (a > 0.02)
    ink = np.zeros((H, W), np.float32)
    np.maximum.at(ink, (yi[keep], xi[keep]), a[keep])
    return cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))   # 弯的地方点贴得稀，补上


def finish(ink, rng, bleed=1.0):
    """毫走出来的墨铺到纸上：边稍微化开一点，浓的地方往外洇，墨色有浓淡"""
    H, W = ink.shape
    body = cv2.GaussianBlur(ink, (0, 0), 0.75)
    tone = 0.9 + 0.1 * fbm(H, W, 160, rng, 3)
    drift = fbm(H, W, 70, rng, 4)
    soak = cv2.GaussianBlur(ink, (0, 0), 7)
    feather = smooth(0.22, 1.0, soak * (0.5 + 1.1 * drift)) * 0.34 * bleed
    return np.clip(np.maximum(body * tone, feather), 0, 1)


def splatter(H, W, around, count, spread, size, rng, drag=None):
    """甩出去的墨点：大多是细沫，偶尔一滴大的；drag 给方向就顺着甩，越远越稀"""
    a = np.zeros((H, W), np.uint8)
    for _ in range(count):
        cx, cy = around[rng.integers(len(around))]
        d = spread * rng.random() ** 1.8
        th = rng.random() * math.tau
        if drag is not None:
            th = math.atan2(drag[1], drag[0]) + (rng.random() - 0.5) * 0.7
        x, y = cx + math.cos(th) * d, cy + math.sin(th) * d
        r = 0.6 + size * rng.random() ** 5
        cv2.circle(a, (int(x * 8), int(y * 8)), int(r * 8), 255, -1, cv2.LINE_AA, 3)
    return np.clip(cv2.GaussianBlur(a.astype(np.float32) / 255, (0, 0), 0.6) * 1.3, 0, 1)


def to_rgba(alpha, ink=(10, 9, 9)):
    h, w = alpha.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = ink           # 存的是 BGR，黑墨三个差不多
    out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return out


def line(*keys):
    """压力曲线：(位置, 压力) 几个点连起来"""
    xs, ys = zip(*keys)
    return lambda x: float(np.interp(x, xs, ys))


def slash(rng):
    """收束那一笔：起笔落在画面里，尖着入、一顿，提着笔一路扫到右上，弯一点，越走越干，出锋时全散开"""
    H, W = 900, 1600
    pts = [(118, 792), (176, 712), (330, 668), (640, 560), (1000, 400), (1320, 262), (1570, 150)]
    ink = brush(H, W, pts, 92, line((0, 0.2), (0.035, 0.72), (0.085, 1), (0.2, 0.74), (0.5, 0.52), (0.74, 0.6), (0.9, 0.4), (1, 0.12)), rng, dry=0.78, tail=0.3, power=1.7, grain=0.34)
    a = finish(ink, rng, bleed=0.9)
    a = np.maximum(a, splatter(H, W, [(1240, 300), (1420, 220), (1530, 170)], 130, 300, 3.8, rng, drag=(1, -0.42)))
    return np.maximum(a, splatter(H, W, [(180, 710), (270, 680)], 40, 120, 2.6, rng))


def left(rng):
    """左边一道竖笔：大字压在上面，从上往下走，到底扫开"""
    H, W = 900, 420
    pts = [(170, -50), (186, 130), (160, 400), (176, 660), (120, 950)]
    ink = brush(H, W, pts, 116, line((0, 1), (0.28, 0.86), (0.55, 0.78), (0.8, 0.62), (1, 0.3)), rng, dry=0.82, tail=0.26, power=1.8)
    a = finish(ink, rng)
    return np.maximum(a, splatter(H, W, [(260, 300), (250, 620), (150, 860)], 90, 150, 3.4, rng))


def bottom(rng):
    """底边一道横笔：从左往右走，走到大半就干了"""
    H, W = 320, 1600
    pts = [(-40, 250), (340, 228), (800, 256), (1220, 226), (1640, 262)]
    ink = brush(H, W, pts, 70, line((0, 1), (0.3, 0.8), (0.6, 0.62), (0.85, 0.5), (1, 0.16)), rng, dry=0.94, tail=0.34, power=1.3)
    a = finish(ink, rng, bleed=0.8)
    return np.maximum(a, splatter(H, W, [(1160, 226), (1340, 240)], 70, 240, 2.8, rng, drag=(1, -0.1)))


def top(rng):
    """顶上一道：从右上往左斜着带一笔，细、快、干"""
    H, W = 260, 1100
    pts = [(1160, 42), (820, 78), (460, 62), (40, 104)]
    ink = brush(H, W, pts, 46, line((0, 1), (0.4, 0.7), (0.8, 0.46), (1, 0.12)), rng, dry=0.96, tail=0.36, power=1.1)
    return finish(ink, rng, bleed=0.6)


def splash(rng):
    """左下角一大片：立绘背后的底，横着来回扫了几笔的泼墨，从左边扫出来"""
    H, W = 900, 760
    a = np.zeros((H, W), np.float32)
    for pts, wd, dry in [
        ([(830, 210), (520, 250), (210, 320)], 140, 0.86),
        ([(810, 500), (470, 470), (120, 560)], 170, 0.8),
        ([(840, 790), (520, 740), (250, 810)], 140, 0.9),
    ]:
        ink = brush(H, W, pts, wd, line((0, 1), (0.6, 0.86), (1, 0.34)), rng, dry=dry, tail=0.3, power=1.5)
        a = np.maximum(a, finish(ink, rng, bleed=1.3))
    a = np.maximum(a, splatter(H, W, [(240, 330), (160, 560), (300, 800)], 110, 170, 3.6, rng))
    return a[:, ::-1]


def tint(rng):
    """元素色化在墨边上的一团：运行时当遮罩，上什么颜色由元素定"""
    H, W = 512, 512
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.hypot(x - W / 2, y - H / 2) / (W / 2)
    n = fbm(H, W, 170, rng, 5)
    a = np.clip((1.02 - d * (0.72 + 0.75 * n)) * 1.9, 0, 1)
    edge = np.clip(1 - np.abs(a - 0.55) * 4, 0, 1) * 0.3
    return np.clip(a * 0.72 + edge, 0, 1)


ART = {'slash': slash, 'left': left, 'bottom': bottom, 'top': top, 'splash': splash, 'tint': tint}


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[2:] or ART:
        rng = np.random.default_rng(sum(map(ord, name)) * 1106)
        a = ART[name](rng)
        rgba = to_rgba(a)
        q = 60 if name == 'tint' else 72
        p = out / f'{name}.webp'
        cv2.imwrite(str(p), rgba, [cv2.IMWRITE_WEBP_QUALITY, q])
        print(name, a.shape, p.stat().st_size // 1024, 'KB')
