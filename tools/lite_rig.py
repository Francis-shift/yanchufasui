"""给本机预览面板的检查页做减面版骨骼模型（正式的 boss 模型塞不进面板 512 KB 的上限）。不进游戏。
- 网格：按格子合并顶点（每格留离格心最近的那个顶点的骨号、权重、贴图坐标，法线取格内平均），二分格子大小凑到目标面数；
  只看位置：接缝两边的贴图坐标会糊到一起，但身形是连着的（10-28 试过贴图坐标差得远的不合并，网格碎成一片片的、满是窟窿）；
  没有面用到的顶点扔掉；
- 动作：隔帧取（帧率减半，最后一帧补上），骨架原样；
- 贴图：缩到 192 的 WebP。
用法：python tools/lite_rig.py public/models/boss.rig.gz public/models/boss-1024.webp preview/assets/boss [面数，默认 4500]
     → preview/assets/boss.rig.gz、preview/assets/boss-192.webp
"""
import gzip
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pack_rig import read_rig, write_rig  # noqa: E402


def cluster(pos, idx, cell):
    """返回（每个顶点归哪一格, 每格的代表顶点, 合并后的面, 格数）"""
    key = np.floor((pos - pos.min(0)) / cell).astype(np.int64)
    inv = np.unique(key, axis=0, return_inverse=True)[1].reshape(-1)
    k = inv.max() + 1
    mean = np.zeros((k, 3))
    np.add.at(mean, inv, pos)
    mean /= np.bincount(inv, minlength=k)[:, None]
    order = np.lexsort((np.linalg.norm(pos - mean[inv], axis=1), inv))
    first = np.ones(len(order), bool)
    first[1:] = inv[order][1:] != inv[order][:-1]
    rep = np.empty(k, np.int64)
    rep[inv[order][first]] = order[first]
    t = inv[idx]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    return inv, rep, np.unique(t, axis=0), k


def thin(c):
    keep = np.arange(0, c["frames"], 2)
    if keep[-1] != c["frames"] - 1:   # 帧数是偶数时最后一段只隔一帧，总时长多出 1/原帧率 秒，检查页不在乎
        keep = np.append(keep, c["frames"] - 1)
    return dict(c, fps=c["fps"] // 2, frames=len(keep),
                tracks=[{"bone": b, "kind": kd, "v": v if len(v) == 1 else v[keep]} for b, kd, v in c["tracks"]])


def main():
    src, tex, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
    target = int(sys.argv[4]) if len(sys.argv) > 4 else 4500
    r = read_rig(gzip.decompress(pathlib.Path(src).read_bytes()))
    pos, uv, idx = r["pos"], r["uv"], r["idx"]
    size = (pos.max(0) - pos.min(0)).max()
    lo, hi = 1e-4, 0.2
    for _ in range(30):
        c = (lo * hi) ** 0.5
        if len(cluster(pos, idx, c * size)[2]) > target:
            lo = c
        else:
            hi = c
    inv, rep, tris, k = cluster(pos, idx, hi * size)
    nrm = np.zeros((k, 3))
    np.add.at(nrm, inv, r["nrm"])
    w = np.round(r["weights"][rep] * 255).astype(np.int64)
    w[:, 0] += 255 - w.sum(1)
    used, tris = np.unique(tris, return_inverse=True)
    rep, nrm, w = rep[used], nrm[used], w[used]
    lite = {"bones": r["bones"], "pos": pos[rep], "nrm": nrm, "uv": uv[rep], "joints": r["joints"][rep], "weights": w,
            "idx": tris.reshape(-1, 3), "clips": [thin(c) for c in r["clips"]]}
    out.parent.mkdir(parents=True, exist_ok=True)
    rig = out.parent / f"{out.name}.rig.gz"
    rig.write_bytes(gzip.compress(write_rig(lite), 9))
    webp = out.parent / f"{out.name}-192.webp"
    Image.open(tex).convert("RGB").resize((192, 192), Image.LANCZOS).save(webp, quality=82)
    print(f"顶点 {len(pos)}→{len(rep)}，面 {len(idx)}→{len(lite['idx'])}；{rig} {rig.stat().st_size} B，{webp} {webp.stat().st_size} B")


if __name__ == "__main__":
    main()
