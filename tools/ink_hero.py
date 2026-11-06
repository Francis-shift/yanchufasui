"""
水墨立绘：从人物概念图出。抠出人，只留腰带往上；白衣留纸色，头发和衣纹是浓墨，衣服的明暗是一层淡墨，
原来的颜色留一点（淡彩），胳膊和下半身化进飞白里，不是一刀裁齐。
用法：python -X utf8 tools/ink_hero.py <概念图> <输出 webp>
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from ink_art import fbm, smooth, streaks

PAPER = np.array([0.80, 0.885, 0.925], np.float32)    # BGR：宣纸的米色
INK = np.array([0.035, 0.04, 0.045], np.float32)
BOX = (232, 0, 792, 740)                              # 取景：头顶到胸口，胳膊化掉


def matte(img):
    """抠人：背景是一片又平又灰的，衣服再灰也有布纹。又灰又平、连着画面四边的才算背景，别的都是人"""
    H, W = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[..., 1]
    mean = cv2.blur(g, (7, 7))
    std = np.sqrt(np.maximum(cv2.blur(g * g, (7, 7)) - mean * mean, 0))
    flat = ((np.abs(mean - 179) < 9) & (std < 1.25) & (sat < 12)).astype(np.uint8)
    flat = cv2.morphologyEx(flat, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    n, lab = cv2.connectedComponents(flat)
    rim = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    bg = np.isin(lab, [i for i in rim if i])
    fg = (~bg).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
    m = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    solid = np.zeros((H, W), np.uint8)
    cv2.drawContours(solid, cnts, -1, 1, -1)
    # 判平的窗口会往外蹭一圈，发丝边上尤其多：从外面一点点往里吃，吃到不是背景那个灰为止
    gray = ((np.abs(g - 179) < 11) & (sat < 15)).astype(np.uint8)
    out = 1 - solid
    for _ in range(36):
        out = cv2.dilate(out, np.ones((3, 3), np.uint8)) & (out | gray)
    return cv2.GaussianBlur((1 - out).astype(np.float32), (0, 0), 1.0)


def xdog(g, sigma=1.1, k=1.6, tau=0.985, phi=26, eps=0.62):
    """线：两层模糊相减，亮处留白，边上压出黑线，比描边更像笔画，粗细有变化"""
    a = cv2.GaussianBlur(g, (0, 0), sigma)
    b = cv2.GaussianBlur(g, (0, 0), sigma * k)
    d = a - tau * b + 0.5
    return 1 - np.clip(1 + np.tanh(phi * (d - eps)), 0, 1)


def build(path):
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    m = matte(img)
    x0, y0, x1, y1 = BOX
    img, m = img[y0:y1, x0:x1], m[y0:y1, x0:x1]
    s = 1.6
    img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_LANCZOS4)
    m = cv2.resize(m, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    H, W = m.shape
    rng = np.random.default_rng(1106)
    flat = cv2.bilateralFilter(img, 9, 34, 7)
    flat = cv2.bilateralFilter(flat, 9, 34, 7).astype(np.float32) / 255
    g = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)

    # 线：细线（五官、绣纹、衣褶）和粗线（大轮廓）叠在一起
    thin = xdog(g, 1.0, 1.6, 0.99, 42, 0.5)
    wide = xdog(cv2.GaussianBlur(g, (0, 0), 1.6), 3.0, 1.5, 0.985, 18, 0.495)
    lines = np.maximum(thin, wide)
    # 轮廓再压一道浓墨，粗细靠噪声抖
    rim = m - cv2.erode(m, np.ones((9, 9), np.uint8))
    rim = cv2.GaussianBlur(rim, (0, 0), 2.2) * (0.5 + smooth(0.3, 0.7, fbm(H, W, 120, rng, 3))) * 2.2
    # 面：明暗压成几档淡墨；头发、靴子这种本来就黑的直接是浓墨
    wash = np.clip((0.9 - g) / 0.55, 0, 1) ** 1.1
    wash = np.floor(wash * 5 + 0.5 * fbm(H, W, 40, rng, 3)) / 5 * 0.6 + wash * 0.4
    solid = 1 - smooth(0.2, 0.34, g)
    ink = np.clip(np.maximum.reduce([lines, wash * 0.74, solid, np.clip(rim, 0, 1)]), 0, 1)[..., None]
    # 淡彩：原来的颜色提一点，只留在没被墨盖住的地方
    gray = g[..., None]
    pale = PAPER * (0.5 + 0.56 * gray) + (flat - gray) * 0.6
    rgb = pale * (1 - ink) + INK * ink

    # 化开：下半身、胳膊顺着笔势散掉
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    S = streaks(H, W, rng)
    dx = np.abs(x / W - 0.5) * 2
    fall = smooth(0.5, 0.84, y / H + 0.14 * (fbm(H, W, 150, rng, 3) - 0.5) + 0.34 * dx ** 3)       # 越往下越干
    side = smooth(0.46, 0.92, dx + 0.14 * (fbm(H, W, 130, rng, 3) - 0.5) + 0.4 * (y / H) ** 2)     # 越往两边越干
    dry = np.clip(np.maximum(fall, side), 0, 1)
    keep = smooth(dry - 0.03, dry + 0.05, S * 0.96 + 0.02)
    keep[dry > 0.985] = 0
    return np.dstack([np.clip(rgb, 0, 1), m * keep])


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    art = build(src)
    h, w = art.shape[:2]
    k = 1200 / h
    art = cv2.resize(art, (int(w * k), 1200), interpolation=cv2.INTER_AREA)
    res = (np.clip(art, 0, 1) * 255 + 0.5).astype(np.uint8)
    cv2.imencode('.webp', res, [cv2.IMWRITE_WEBP_QUALITY, 78])[1].tofile(out)
    print(res.shape)
