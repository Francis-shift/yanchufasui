"""把 Tripo 绑好骨骼、带动作的人形模型（GLB，Mixamo 骨骼）打包成网页用的 RIG1 + gzip，贴图 WebP。读法见 game/actors/rig.js。

- 去掉手指骨和末端骨（*_End）：权重并到最近的、留下来的上级骨（手指并到手掌）。人形 65 根骨剩 22 根，
  动作数据随之少一大半；屏幕上几十个像素高的小怪，手指动不动看不出来。
- 动作只留指定的几段，可截一段时间（待机 15 秒，截前几秒、游戏里来回放）；没在动、又和静止姿势一样的通道不存；
  缩放通道不存（有不等于 1 的就报错）；位移只存髋骨（其余骨的位移有在动的就报错）。
- 坐标原样（Tripo 归一化成高 1），游戏里按要的身高缩放；正面朝 +z。
- 走、跑一类（--move）带根位移：髋骨一个循环往前走一段。游戏里位置由代码挪，所以把这段匀速前进从髋骨上扣掉（原地踏步），
  另记下它原本每秒走多少（模型单位），游戏里按实际移动速度调播放快慢，脚才不打滑。
  导出时就选了原地的（髋骨首尾不挪，人物模型就是）：没有根位移可量，改按支撑脚往后滑多快估（foot_speed），整段同样挪回髋骨上方。

用法：python tools/pack_rig.py 输入.glb 名字 --clip 游戏里的名字=GLB 里的名字[@起秒:止秒] ... [--move walk,run] [--tex 512] [--sheet 联系表.png]
产出：public/models/名字.rig.gz、名字-<边长>.webp。--sheet：从打包好的文件解回来，每段动作画几帧侧视图（核对动作和打包对不对）。
"""
import argparse
import gzip
import io
import json
import pathlib
import re
import struct

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "models"
DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DROP = re.compile(r"Hand(Index|Middle|Pinky|Ring|Thumb)\d|_End$")


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


def bone_name(n):
    return n.get("name", "").split(":")[-1]


def same_rot(a, b):
    return min(np.abs(a - b).max(), np.abs(a + b).max()) < 1e-4   # q 与 -q 是同一个转动


def pack(src, clip_specs, move=()):
    js, binc = read_glb(src)
    nodes, skin = js["nodes"], js["skins"][0]
    assert len(js["meshes"]) == 1 and len(js["meshes"][0]["primitives"]) == 1, "只处理单网格单材质的模型"
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    joints = skin["joints"]
    keep = [j for j in joints if not DROP.search(bone_name(nodes[j]))]
    kidx = {j: k for k, j in enumerate(keep)}

    def kept_ancestor(j):
        while j not in kidx:
            j = parent[j]
        return kidx[j]

    for j in keep:   # 骨架之外的上级（Armature 一类）必须是单位变换，否则静止姿势对不上
        p = parent.get(j)
        if p is not None and p not in kidx:
            n = nodes[p]
            assert np.allclose(n.get("translation", [0, 0, 0]), 0) and np.allclose(n.get("rotation", [0, 0, 0, 1]), [0, 0, 0, 1]) \
                and np.allclose(n.get("scale", [1, 1, 1]), 1), f"{n.get('name')} 不是单位变换"
    bones = []
    for j in keep:
        n, p = nodes[j], parent.get(j)
        assert np.allclose(n.get("scale", [1, 1, 1]), 1, atol=1e-4), f"{bone_name(n)} 静止姿势有缩放"
        bones.append({"name": bone_name(n), "parent": kidx.get(p, -1),
                      "t": np.array(n.get("translation", [0, 0, 0]), float), "q": np.array(n.get("rotation", [0, 0, 0, 1]), float)})
        assert bones[-1]["parent"] < len(bones) - 1, "骨的顺序要父在前、子在后"

    prim = js["meshes"][0]["primitives"][0]
    get = lambda k: accessor(js, binc, prim["attributes"][k]).astype(np.float64)
    pos, nrm, uv = get("POSITION"), get("NORMAL"), get("TEXCOORD_0")
    idx = accessor(js, binc, prim["indices"]).astype(np.int64).reshape(-1, 3)
    J = accessor(js, binc, prim["attributes"]["JOINTS_0"]).astype(np.int64)
    Wt = get("WEIGHTS_0")
    remap = np.array([kept_ancestor(j) for j in joints])
    # 手指的权重并到手掌：同一根骨的几份加起来，留最大的四份，再归一
    nj, nw = np.zeros((len(pos), 4), np.int64), np.zeros((len(pos), 4))
    for v in range(len(pos)):
        acc = {}
        for k in range(4):
            if Wt[v, k] > 0:
                b = remap[J[v, k]]
                acc[b] = acc.get(b, 0) + Wt[v, k]
        top = sorted(acc.items(), key=lambda x: -x[1])[:4]
        s = sum(w for _, w in top)
        for k, (b, w) in enumerate(top):
            nj[v, k], nw[v, k] = b, w / s
    wq = np.floor(nw * 255).astype(np.int64)
    wq[np.arange(len(wq)), nw.argmax(1)] += 255 - wq.sum(1)   # 量化后每个顶点的权重加起来正好 255

    img = js["images"][js["textures"][0]["source"]]
    bv = js["bufferViews"][img["bufferView"]]
    tex = Image.open(io.BytesIO(binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")

    anims = {a["name"]: a for a in js["animations"]}
    clips, report = [], []
    for spec in clip_specs:
        m = re.fullmatch(r"([^=]+)=([^@]+)(?:@([\d.]+):([\d.]+))?", spec)
        assert m, f"--clip 写法不对：{spec}"
        gname, aname = m.group(1), m.group(2)
        assert aname in anims, f"GLB 里没有动作 {aname}（有：{', '.join(anims)}）"
        a = anims[aname]
        tracks, fps, frames = [], None, None
        for ch in a["channels"]:
            node, path = ch["target"]["node"], ch["target"]["path"]
            s = a["samplers"][ch["sampler"]]
            t = accessor(js, binc, s["input"]).astype(np.float64)
            v = accessor(js, binc, s["output"]).astype(np.float64).reshape(len(t), -1)
            moving = np.abs(v - v[0]).max() > 1e-4
            if path == "scale":
                assert np.allclose(v, 1, atol=1e-3), f"{aname} 里 {bone_name(nodes[node])} 有缩放"
                continue
            if node not in kidx:
                continue   # 去掉的手指骨：动作一并不要
            b = kidx[node]
            if moving:
                assert s.get("interpolation", "LINEAR") == "LINEAR", f"{aname} 有非线性插值的动作通道"
                dt = np.diff(t)
                assert np.allclose(dt, dt[0], atol=1e-4), f"{aname} 关键帧间隔不均匀"
                f = round(1 / dt[0])
                assert fps in (None, f) and frames in (None, len(t)), f"{aname} 各通道帧率或帧数不一致"
                fps, frames = f, len(t)
            if path == "translation":
                if b != 0:
                    assert not moving and np.allclose(v[0], bones[b]["t"], atol=1e-4), f"{aname} 里 {bones[b]['name']} 的位移在动"
                    continue
            rest = bones[b]["q"] if path == "rotation" else bones[b]["t"]
            if not moving and (same_rot(v[0], rest) if path == "rotation" else np.allclose(v[0], rest, atol=1e-4)):
                continue   # 不动、又和静止姿势一样
            tracks.append({"bone": b, "kind": 0 if path == "rotation" else 1, "v": v if moving else v[:1]})
        fps = fps or 24
        n = frames or 1
        lo, hi = 0, n
        if m.group(3):
            lo, hi = int(float(m.group(3)) * fps), min(n, int(float(m.group(4)) * fps) + 1)
        for tr in tracks:
            if len(tr["v"]) > 1:
                tr["v"] = tr["v"][lo:hi]
            if tr["kind"] == 0:   # 相邻两帧取同半球，量化后插值不绕远路
                q = tr["v"]
                for i in range(1, len(q)):
                    if np.dot(q[i], q[i - 1]) < 0:
                        q[i] = -q[i]
        hip = next((tr["v"] for tr in tracks if tr["bone"] == 0 and tr["kind"] == 1 and len(tr["v"]) > 1), None)
        d = (hip[-1] - hip[0]) if hip is not None else np.zeros(3)
        drift, speed, note = float(np.hypot(d[0], d[2])), 0.0, ""
        if gname in move and drift < 0.01:
            # 导出时就是原地的（人物模型，10-28）：没有根位移可量，按支撑脚往后滑多快估它原本该往前走多快；
            # 整段照样挪回静止姿势的髋骨上方（人物的跑整段偏前 0.56）
            if hip is not None:
                hip[:, [0, 2]] -= hip[:, [0, 2]].mean(0) - bones[0]["t"][[0, 2]]
            speed = foot_speed(bones, tracks, hi - lo, fps)
            note = f"，导出时已原地，按支撑脚估原本每秒 {speed:.3f}"
        elif gname in move:
            assert hip is not None and d[2] > 0.9 * drift > 0, f"{gname} 的根位移不是朝 +z 往前走（{d.round(3)}）"
            k = np.arange(len(hip))[:, None] / (len(hip) - 1)
            hip[:, [0, 2]] -= k * d[[0, 2]]   # 扣掉匀速前进：首尾两帧落在同一处，循环接得上
            # 再把整段的平均位置挪回静止姿势的髋骨上方（跑这一段原本整体偏前 0.44，游戏里身子会跑到实际位置前面）
            hip[:, [0, 2]] -= hip[:, [0, 2]].mean(0) - bones[0]["t"][[0, 2]]
            speed = drift / ((hi - lo - 1) / fps)
            note = f"，原地化，原本每秒 {speed:.3f}"
        clips.append({"name": gname, "fps": fps, "frames": hi - lo, "speed": speed, "tracks": tracks})
        report.append(f"{gname}（{aname}{'，' + m.group(3) + '～' + m.group(4) + ' 秒' if m.group(3) else ''}）：{hi - lo} 帧 / {(hi - lo - 1) / fps:.2f} 秒，"
                      f"{len(tracks)} 条通道，髋骨首尾水平差 {drift:.3f}{note}")
    return {"bones": bones, "pos": pos, "nrm": nrm, "uv": uv, "idx": idx, "joints": nj, "weights": wq, "clips": clips}, tex, report


def foot_speed(bones, tracks, n, fps):
    """原地走跑：两只脚里低的那只贴着地（离最低点 3 厘米内）时，每秒往后滑多少（模型单位）——就是这段动作原本往前走多快。
    取中位数：跑步腾空、换脚那几帧不算。"""
    names = [b["name"] for b in bones]
    feet = [names.index(f) for f in ("LeftToeBase", "RightToeBase")]
    ys, zs = np.zeros((n, 2)), np.zeros((n, 2))
    for f in range(n):
        local = [[b["t"], b["q"]] for b in bones]
        for tr in tracks:
            local[tr["bone"]][1 - tr["kind"]] = tr["v"][min(f, len(tr["v"]) - 1)]
        W = world_mats(bones, local)
        for k, i in enumerate(feet):
            ys[f, k], zs[f, k] = W[i][1, 3], W[i][2, 3]
    low, floor, v = ys.argmin(1), ys.min(), []
    for f in range(1, n):
        k = low[f]
        if low[f - 1] == k and max(ys[f, k], ys[f - 1, k]) < floor + 0.03:
            v.append((zs[f - 1, k] - zs[f, k]) * fps)
    assert len(v) >= 3 and np.median(v) > 0, "原地走跑量不出支撑脚往后滑的速度"
    return float(np.median(v))


def write_rig(r):
    """RIG1 布局（小端）：
    'RIG1' u32 顶点数 u32 三角形数 u16 骨数 u16 动作数 f32×6 包围盒（lo, hi）
    骨 × 骨数：i16 父骨（-1 是根）f32×3 位移 f32×4 旋转（x y z w）u8 名字长 名字（UTF-8）
    顶点：u16×3 坐标（量化到包围盒）、i8×3 法线、u16×2 贴图坐标、u8×4 骨号、u8×4 权重（加起来 255）；u16×3×三角形数 索引
    动作 × 动作数：u8 名字长 名字 u16 帧率 u16 帧数 f32 原本每秒前进多少（模型单位，原地动作是 0）u16 通道数；
      通道：u8 骨号 u8 种类（0 旋转 / 1 位移）u16 帧数（1 = 整段不变）数据（旋转 i16×4 / 32767，位移 f32×3）
    """
    pos, idx = r["pos"], r["idx"]
    assert len(pos) < 65536 and len(r["bones"]) < 256
    lo, hi = pos.min(0), pos.max(0)
    out = [b"RIG1", struct.pack("<IIHH", len(pos), len(idx), len(r["bones"]), len(r["clips"])), struct.pack("<6f", *lo, *hi)]
    for b in r["bones"]:
        nm = b["name"].encode("utf-8")
        out.append(struct.pack("<h3f4fB", b["parent"], *b["t"], *b["q"], len(nm)) + nm)
    q = np.round((pos - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype("<u2")
    n = r["nrm"] / (np.linalg.norm(r["nrm"], axis=1, keepdims=True) + 1e-12)
    out += [q.tobytes(), np.round(n * 127).astype("<i1").tobytes(), np.round(np.clip(r["uv"], 0, 1) * 65535).astype("<u2").tobytes(),
            r["joints"].astype("<u1").tobytes(), r["weights"].astype("<u1").tobytes(), idx.astype("<u2").tobytes()]
    for c in r["clips"]:
        nm = c["name"].encode("utf-8")
        out.append(struct.pack("<B", len(nm)) + nm + struct.pack("<HHfH", c["fps"], c["frames"], c["speed"], len(c["tracks"])))
        for tr in c["tracks"]:
            v = tr["v"]
            out.append(struct.pack("<BBH", tr["bone"], tr["kind"], len(v)))
            out.append((np.round(v / np.linalg.norm(v, axis=1, keepdims=True) * 32767).astype("<i2") if tr["kind"] == 0
                        else v.astype("<f4")).tobytes())
    return b"".join(out)


def read_rig(data):
    """write_rig 的反过程（和 game/actors/rig.js 同一套读法），--sheet 用它从打包好的文件画图。"""
    off = 0

    def take(fmt):
        nonlocal off
        v = struct.unpack_from("<" + fmt, data, off)
        off += struct.calcsize("<" + fmt)
        return v

    assert data[:4] == b"RIG1"
    off = 4
    nv, nt, nb, nc = take("IIHH")
    lohi = np.array(take("6f"))
    lo, hi = lohi[:3], lohi[3:]
    bones = []
    for _ in range(nb):
        p, *tq, ln = take("h3f4fB")
        bones.append({"parent": p, "t": np.array(tq[:3]), "q": np.array(tq[3:]), "name": data[off:off + ln].decode()})
        off += ln

    def arr(dt, count):
        nonlocal off
        a = np.frombuffer(data, dt, count, off)
        off += a.nbytes
        return a

    pos = arr("<u2", nv * 3).reshape(-1, 3) / 65535 * (hi - lo) + lo
    nrm = arr("<i1", nv * 3).reshape(-1, 3) / 127
    uv = arr("<u2", nv * 2).reshape(-1, 2) / 65535
    jn = arr("<u1", nv * 4).reshape(-1, 4)
    wt = arr("<u1", nv * 4).reshape(-1, 4) / 255
    idx = arr("<u2", nt * 3).reshape(-1, 3).astype(np.int64)
    clips = []
    for _ in range(nc):
        ln = take("B")[0]
        name = data[off:off + ln].decode(); off += ln
        fps, frames, speed, ntr = take("HHfH")
        tracks = []
        for _ in range(ntr):
            b, kind, n = take("BBH")
            v = arr("<i2", n * 4).reshape(-1, 4) / 32767 if kind == 0 else arr("<f4", n * 3).reshape(-1, 3).astype(np.float64)
            tracks.append((b, kind, v))
        clips.append({"name": name, "fps": fps, "frames": frames, "speed": speed, "tracks": tracks})
    return {"bones": bones, "pos": pos, "nrm": nrm, "uv": uv, "joints": jn, "weights": wt, "idx": idx, "clips": clips}


def quat_mat(q):
    x, y, z, w = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def world_mats(bones, local):
    W = []
    for b, (t, q) in zip(bones, local):
        M = np.eye(4); M[:3, :3] = quat_mat(q); M[:3, 3] = t
        W.append(W[b["parent"]] @ M if b["parent"] >= 0 else M)
    return W


def sheet(r, tex, path, per=6):
    """每段动作取 per 帧，画侧视图（镜头在 +x，正面朝右）。顶点按线性蒙皮摆好姿势，面色取贴图。"""
    bones = r["bones"]
    rest = [(b["t"], b["q"]) for b in bones]
    inv = [np.linalg.inv(M) for M in world_mats(bones, rest)]
    t = np.asarray(tex.resize((256, 256)))
    fu = r["uv"][r["idx"]].mean(1)
    col = t[np.clip(fu[:, 1] * 255, 0, 255).astype(int), np.clip(fu[:, 0] * 255, 0, 255).astype(int)].astype(float)
    S, rows = 220, []
    for c in r["clips"]:
        row = Image.new("RGB", (S * per, int(S * 1.15)), (205, 205, 205))
        d0 = ImageDraw.Draw(row)
        d0.text((4, 4), c["name"], fill=(0, 0, 0))
        for k in range(per):
            f = round(k * (c["frames"] - 1) / max(per - 1, 1))
            local = [list(x) for x in rest]
            for b, kind, v in c["tracks"]:
                local[b][1 - kind] = v[min(f, len(v) - 1)]   # kind 0 旋转 → local[b][1]；1 位移 → local[b][0]
            Wm = world_mats(bones, local)
            skin = np.stack([Wm[i] @ inv[i] for i in range(len(bones))])
            P = np.c_[r["pos"], np.ones(len(r["pos"]))]
            out = np.zeros((len(P), 3))
            for j in range(4):
                out += r["weights"][:, j:j + 1] * np.einsum("nij,nj->ni", skin[r["joints"][:, j]], P)[:, :3]
            u = (out[:, 2] + 0.6) * S / 1.2 + k * S      # 侧视：z 朝右
            vv = (1.1 - out[:, 1]) * S / 1.2
            tri = out[r["idx"]]
            nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
            light = np.clip(nrm @ np.array([0.6, 0.6, 0.5]) / np.linalg.norm([0.6, 0.6, 0.5]), 0, 1) * 0.6 + 0.45
            cc = np.clip(col * light[:, None], 0, 255).astype(int)
            d = ImageDraw.Draw(row)
            for fi in np.argsort(tri.mean(1)[:, 0]):   # 镜头在 +x：先画 x 小的
                a, b, cidx = r["idx"][fi]
                d.polygon([(u[a], vv[a]), (u[b], vv[b]), (u[cidx], vv[cidx])], fill=tuple(cc[fi]))
            d.line([(k * S, 1.1 * S / 1.2), ((k + 1) * S, 1.1 * S / 1.2)], fill=(120, 120, 120))   # 地面 y = 0
        rows.append(row)
    img = Image.new("RGB", (S * per, sum(x.height for x in rows)), (205, 205, 205))
    y = 0
    for x in rows:
        img.paste(x, (0, y)); y += x.height
    img.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("name")
    ap.add_argument("--clip", action="append", required=True)
    ap.add_argument("--move", default="")
    ap.add_argument("--tex", type=int, default=512)
    ap.add_argument("--sheet")
    a = ap.parse_args()
    r, tex, report = pack(a.src, a.clip, [x for x in a.move.split(",") if x])
    data = write_rig(r)
    OUT.mkdir(parents=True, exist_ok=True)
    gz = gzip.compress(data, 9, mtime=0)
    (OUT / f"{a.name}.rig.gz").write_bytes(gz)
    tp = OUT / f"{a.name}-{a.tex}.webp"
    tex.resize((a.tex, a.tex), Image.LANCZOS).save(tp, "WEBP", quality=80, method=6)
    ext = r["pos"].max(0) - r["pos"].min(0)
    print(f"{a.name}: {len(r['pos'])} 顶点 {len(r['idx'])} 三角形 {len(r['bones'])} 根骨（{', '.join(b['name'] for b in r['bones'])}）")
    print(f"  尺寸 宽 {ext[0]:.3f} 高 {ext[1]:.3f} 深 {ext[2]:.3f}")
    for line in report:
        print("  " + line)
    print(f"  {a.name}.rig.gz {len(gz) / 1024:.0f} KB（未压 {len(data) / 1024:.0f} KB）  {tp.name} {tp.stat().st_size / 1024:.0f} KB")
    if a.sheet:
        sheet(read_rig(data), tex, a.sheet)
        print("  联系表：" + a.sheet)


if __name__ == "__main__":
    main()
