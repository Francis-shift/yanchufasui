"""把 Tripo 导出的场景物件（GLB）打包成网页用的文件，格式与冰龙相同：DRG2 + gzip，贴图 WebP。

- 摆正：底面落在 y = 0、水平方向居中，按给定的宽（x 方向）或高缩放成米；可选绕 y 转 180°（正面朝 +z）；
- 可选：把一段高度竖着拉长（牌坊：Tripo 给的宽是高的两倍，门洞太矮，只拉柱身，底座和屋顶不动）；
- 贴图：颜色压到给定边长；另从颜色推一张材质贴图（G = 粗糙度，B = 金属度——three.js 的约定）：
  鎏金 → 金属、较光滑（夕阳下才会反光）；琉璃瓦较光滑；汉白玉中等；其余粗糙。Tripo 只给颜色贴图，金会像哑光黄漆。
不减面：减面会弄乱贴图坐标，面数在 Tripo 里就设好。

用法：python tools/pack_prop.py 输入.glb 名字 (--width 米 | --height 米) [--stretch 起,止,倍数]（起止是占总高的比例）
                               [--sizes 2048,1024] [--mr 1024] [--flip]
产出：public/models/名字.drg2.gz、名字-<边长>.webp、名字-mr-<边长>.webp；最后打印包围盒与文件大小。
"""
import argparse
import gzip
import io
import json
import pathlib
import struct

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "models"
DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = pathlib.Path(path).read_bytes()
    length = struct.unpack_from("<I", data, 8)[0]
    off, js, binc = 12, None, None
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            binc = chunk
        off += 8 + clen
    return js, binc


def accessor(js, binc, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    dt, n = np.dtype(DT[a["componentType"]]), NC[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0)
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(binc, np.uint8, stride * a["count"], start).reshape(a["count"], stride)
        return raw[:, :dt.itemsize * n].copy().view(dt).reshape(a["count"], n)
    arr = np.frombuffer(binc, dt, a["count"] * n, start)
    return arr.reshape(a["count"], n) if n > 1 else arr


def load(path):
    js, binc = read_glb(path)
    assert len(js["meshes"]) == 1 and len(js["meshes"][0]["primitives"]) == 1, "只处理单网格单材质的模型"
    p = js["meshes"][0]["primitives"][0]
    get = lambda k: accessor(js, binc, p["attributes"][k]).astype(np.float64)
    idx = accessor(js, binc, p["indices"]).astype(np.int64).reshape(-1, 3)
    img = js["images"][js["textures"][0]["source"]]
    bv = js["bufferViews"][img["bufferView"]]
    tex = Image.open(io.BytesIO(binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")
    return get("POSITION"), get("NORMAL"), get("TEXCOORD_0"), idx, tex


def repair_normals(pos, idx, nrm):
    """长度接近 0 的法线换成相邻面法线的面积加权和（零法线在着色器里归一化得 NaN，泛光会放大成黑块）。"""
    nrm = nrm.copy()
    bad = np.where(np.linalg.norm(nrm, axis=1) < 1e-6)[0]
    if len(bad):
        tri = pos[idx]
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        acc = np.zeros_like(nrm)
        for k in range(3):
            np.add.at(acc, idx[:, k], fn)
        for v in bad:
            L = np.linalg.norm(acc[v])
            nrm[v] = acc[v] / L if L > 1e-12 else (0.0, 1.0, 0.0)
    return nrm, len(bad)


def write_drg2(pos, idx, uv, nrm):
    """DRG2（见 game/world/drg2.js）：坐标量化到包围盒的 16 位差分、贴图坐标 16 位、索引差分 zigzag、法线 8 位。
    物件没有龙那样的躯干中心线和参照点，这两段填 0。"""
    order = np.argsort(-pos[:, 2], kind="stable")
    remap = np.empty_like(order)
    remap[order] = np.arange(len(order))
    pos, uv, nrm, idx = pos[order], uv[order], nrm[order], remap[idx]
    idx = idx[np.argsort(idx.min(1), kind="stable")]       # 三角形按最小顶点号排，索引差分才小
    lo, hi = pos.min(0), pos.max(0)
    out = [b"DRG2", struct.pack("<III", len(pos), len(idx), 3), struct.pack("<6f", *lo, *hi), struct.pack("<11f", *[0.0] * 11)]
    q = np.round((pos - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype(np.int64) - 32768
    for k in range(3):
        d = np.diff(q[:, k], prepend=0)
        out.append(((d + 32768) % 65536 - 32768).astype("<i2").tobytes())
    uq = np.round(np.clip(uv, 0, 1) * 65535).astype("<u2")
    out += [uq[:, 0].tobytes(), uq[:, 1].tobytes()]
    dd = np.diff(idx.reshape(-1), prepend=0)
    zz = np.where(dd >= 0, dd * 2, -dd * 2 - 1)
    assert len(pos) < 65536 and zz.max() < 65536, "顶点超过 65535 或索引跨度太大，DRG2 装不下"
    out.append(zz.astype("<u2").tobytes())
    n = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12)
    nq = np.round(n * 127).astype("<i1")
    out += [nq[:, 0].tobytes(), nq[:, 1].tobytes(), nq[:, 2].tobytes()]
    return b"".join(out)


def material_map(tex):
    """从颜色推材质：返回 RGB 图，G = 粗糙度、B = 金属度（R 不用）。"""
    hsv = np.asarray(tex.convert("HSV")).astype(np.float32) / 255.0
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    ramp = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)
    gold = ramp(s, 0.3, 0.5) * ramp(v, 0.25, 0.45) * ramp(h, 22, 32) * (1 - ramp(h, 55, 68))
    glaze = ramp(s, 0.2, 0.4) * ramp(h, 190, 205) * (1 - ramp(h, 245, 260))
    marble = (1 - ramp(s, 0.1, 0.2)) * ramp(v, 0.55, 0.75)
    rough = 0.82 - 0.3 * marble - 0.4 * glaze
    rough = rough * (1 - gold) + 0.32 * gold
    img = np.zeros(hsv.shape, np.uint8)
    img[..., 1] = np.clip(rough * 255, 0, 255)
    img[..., 2] = np.clip(gold * 255, 0, 255)
    return Image.fromarray(img).filter(ImageFilter.GaussianBlur(1.0)), float(gold.mean()), float(glaze.mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("name")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--width", type=float)
    g.add_argument("--height", type=float)
    ap.add_argument("--stretch")
    ap.add_argument("--sizes", default="1024")
    ap.add_argument("--mr", type=int, default=1024)
    ap.add_argument("--flip", action="store_true")
    a = ap.parse_args()

    pos, nrm, uv, idx, tex = load(a.src)
    if a.flip:
        pos, nrm = pos * [-1, 1, -1], nrm * [-1, 1, -1]
    lo, hi = pos.min(0), pos.max(0)
    pos = pos - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    if a.stretch:
        f0, f1, k = (float(x) for x in a.stretch.split(","))
        H = pos[:, 1].max()
        y0, y1, y = f0 * H, f1 * H, pos[:, 1].copy()
        pos[:, 1] = np.where(y <= y0, y, np.where(y >= y1, y + (y1 - y0) * (k - 1), y0 + (y - y0) * k))
        band = (y > y0) & (y < y1)
        nrm = nrm.copy()
        nrm[band, 1] /= k                                  # 竖着拉长 k 倍，法线按逆转置变换：y 分量除以 k
    ext = pos.max(0) - pos.min(0)
    s = a.width / ext[0] if a.width else a.height / ext[1]
    pos = pos * s
    nrm, fixed = repair_normals(pos, idx, nrm)

    OUT.mkdir(parents=True, exist_ok=True)
    data = write_drg2(pos, idx, uv, nrm)
    gz = gzip.compress(data, 9, mtime=0)
    (OUT / f"{a.name}.drg2.gz").write_bytes(gz)
    files = [(f"{a.name}.drg2.gz", len(gz))]
    for size in (int(x) for x in a.sizes.split(",")):
        p = OUT / f"{a.name}-{size}.webp"
        tex.resize((size, size), Image.LANCZOS).save(p, "WEBP", quality=82, method=6)
        files.append((p.name, p.stat().st_size))
    mr, gold, glaze = material_map(tex.resize((a.mr, a.mr), Image.LANCZOS))
    p = OUT / f"{a.name}-mr-{a.mr}.webp"
    mr.save(p, "WEBP", quality=80, method=6)
    files.append((p.name, p.stat().st_size))

    ext = pos.max(0) - pos.min(0)
    print(f"{a.name}: {len(pos)} 顶点 {len(idx)} 三角形，修补法线 {fixed} 个；尺寸（米）宽 {ext[0]:.2f} 高 {ext[1]:.2f} 深 {ext[2]:.2f}")
    print(f"  贴图里算作鎏金 {gold * 100:.1f}%、琉璃瓦 {glaze * 100:.1f}%")
    if a.stretch:   # 牌坊：门洞顶（正中一窄条里、离地以上最低的顶点）
        mid = (np.abs(pos[:, 0]) < 0.03 * ext[0]) & (pos[:, 1] > 0.05 * ext[1])
        inner = pos[(pos[:, 1] < 0.3 * ext[1]) & (pos[:, 1] > 0.05 * ext[1])]
        print(f"  门洞：顶 {pos[mid, 1].min():.2f} 米，宽 {inner[inner[:, 0] > 0, 0].min() - inner[inner[:, 0] < 0, 0].max():.2f} 米")
    for f, n in files:
        print(f"  {f} {n / 1024:.0f} KB")


if __name__ == "__main__":
    main()
