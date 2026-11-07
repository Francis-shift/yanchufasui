"""
技能画框图：把九张平灰底的 16:9 水墨图抠成带透明的 webp，放 public/frame/skill-*.webp。
底是平的灰，略有渐变：先估一张低频的底；又平又贴近底色、连着画面四边或成片的才算背景（衣服上的灰有浓淡，圈在龙身中间的那块底又要抠掉，所以不能只看连不连边）。
背景里的淡墨按"这个颜色是多少墨盖在灰底上"反算透明度，烟和飞白才是半透明的，不留灰边；主体里面一律不透明。
有的白袍画成了和底一样的灰，轮廓线又淡，颜色分不开：这种在 KEEP 里沿轮廓描一圈（占画面宽高的比例），圈里的都算主体。
用法：python -X utf8 tools/ink_skill.py <素材目录> <输出目录> [名字...]
"""
import sys
from pathlib import Path

import cv2
import numpy as np

SKILLS = {
    'ice': '左下冰龙霜华边饰.png', 'fire': '灰底火龙墨韵.png', 'wind': '翡翠苍龙与云涡 ink.png', 'earth': '墨岩怒龙破土而出.png',
    'thunder': '雷云金龙 ink wash.png', 'guard': '墨龙环抱的静修侠客.png', 'twin': '墨龙环绕白衣修士.png',
    'avatar': '墨影金眸修行者.png', 'domain': '墨韵仙姿·云海玄衣.png',
}
OUT = (1600, 900)
KEEP = {
    'guard': [(0.124, 0.645), (0.09, 0.668), (0.07, 0.695), (0.052, 0.74), (0.044, 0.785), (0.04, 0.81), (0.05, 0.85), (0.07, 0.872), (0.09, 0.885), (0.105, 0.89),
              (0.12, 0.908), (0.145, 0.915), (0.17, 0.905), (0.195, 0.885), (0.22, 0.865), (0.24, 0.84), (0.255, 0.81), (0.262, 0.79), (0.25, 0.755), (0.23, 0.715),
              (0.205, 0.68), (0.18, 0.66), (0.172, 0.63), (0.14, 0.63)],
}


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def backdrop(img):
    """低频的底：右上大片的中位数定个大概，贴近它的点做一次归一化模糊，画面哪都有值"""
    H, W = img.shape[:2]
    s = cv2.resize(img, (W // 16, H // 16), interpolation=cv2.INTER_AREA)
    med = np.median(s[: s.shape[0] // 2, s.shape[1] // 2:].reshape(-1, 3), axis=0)
    near = (np.abs(s - med).max(2) < 0.07).astype(np.float32)
    k = (0, 0)
    num = cv2.GaussianBlur(s * near[..., None], k, 22)
    den = np.maximum(cv2.GaussianBlur(near, k, 22), 1e-4)[..., None]
    return cv2.resize(num / den, (W, H), interpolation=cv2.INTER_CUBIC)


def ground(d):
    """哪些是背景：d 很小、成片（或连着四边）的是种子；再顺着 d 稍大的地方长一圈"""
    H, W = d.shape
    seed = cv2.morphologyEx((d < 0.016).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(seed, connectivity=4)
    keep = st[:, cv2.CC_STAT_AREA] >= 260
    keep[0] = False
    rim = np.unique(np.r_[lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    keep[rim[rim > 0]] = True
    core = keep[lab]
    n, lab = cv2.connectedComponents((d < 0.04).astype(np.uint8), connectivity=4)
    hit = np.zeros(n, bool)
    hit[np.unique(lab[core])] = True
    hit[0] = False
    return hit[lab]


def matte(path, keep=()):
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR).astype(np.float32) / 255
    bg = backdrop(img)
    d = np.abs(img - bg).max(2)
    out = ground(d)
    if keep:
        ring = np.zeros(d.shape, np.uint8)
        cv2.fillPoly(ring, [(np.array(keep) * d.shape[::-1]).astype(np.int32)], 1)
        out &= ring == 0
    dark = ((bg - img) / np.maximum(bg, 1e-3)).max(2)
    light = ((img - bg) / np.maximum(1 - bg, 1e-3)).max(2)
    soft = np.clip(np.maximum(dark, light) * 1.1, 0, 1) * smooth(0.02, 0.06, d)
    solid = cv2.erode((~out).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
    solid = cv2.GaussianBlur(solid, (0, 0), 0.8)
    alpha = np.maximum(soft, solid)
    a = np.maximum(alpha, 0.02)[..., None]
    rgb = np.clip(bg + (img - bg) / a, 0, 1)                    # 把盖在灰底上的颜色还原回来
    rgb = np.where(alpha[..., None] > 0.98, img, rgb)
    return rgb, alpha


if __name__ == '__main__':
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[3:] or SKILLS:
        rgb, alpha = matte(src / SKILLS[name], KEEP.get(name, ()))
        res = np.dstack([rgb, alpha])
        res[..., :3] *= alpha[..., None]                        # 缩图时不让透明处的颜色渗进来
        res = cv2.resize(res, OUT, interpolation=cv2.INTER_AREA)
        a = np.maximum(res[..., 3:], 1e-3)
        res[..., :3] = np.clip(res[..., :3] / a, 0, 1)
        png = (np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8)
        p = out / f'skill-{name}.webp'
        cv2.imencode('.webp', png, [cv2.IMWRITE_WEBP_QUALITY, 80])[1].tofile(p)
        print(name, p.stat().st_size // 1024, 'KB')
