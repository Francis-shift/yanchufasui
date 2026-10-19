"""把书法字体按字表裁成两份网页字体，放进 public/fonts/。

用法：python tools/subset_font.py <源字体.ttf>

字表来自 game/rules/charset.js（用 node 读出来，保证和游戏里判断名字用的是同一张表）：
  brush-core.woff  手挑的几百字 + 数字标点，开局就下载；
  brush-rest.woff  其余一级字，用到或空闲时再下载。
源字体不进仓库（几兆大），放在 tools/fonts-src/（已加进 .gitignore）。
字体用开源的 SIL OFL 协议，裁剪后的文件照协议附上 public/fonts/OFL.txt。
"""
import json
import pathlib
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"

JS = "import { CORE, CHARSET } from './game/rules/charset.js'; console.log(JSON.stringify({ core: CORE, all: CHARSET }))"


def charsets():
    r = subprocess.run(["node", "--input-type=module", "-e", JS], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", check=True)
    cs = json.loads(r.stdout)
    core = cs["core"]
    seen = set(core)
    rest = "".join(c for c in cs["all"] if c not in seen)
    return core, rest


def main():
    src = pathlib.Path(sys.argv[1])
    core, rest = charsets()
    cmap = TTFont(src).getBestCmap()
    missing = [c for c in core + rest if c.strip() and ord(c) not in cmap]
    if missing:
        print(f"字体里缺 {len(missing)} 个字（会退回系统字体）：{''.join(missing[:80])}")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, chars in (("brush-core", core), ("brush-rest", rest)):
        opts = subset.Options()
        opts.flavor = "woff"          # 本机没有 brotli，压不了 woff2；woff 用 zlib，浏览器都认
        opts.hinting = False          # 毛笔字放大显示，微调信息没用，去掉更小
        opts.desubroutinize = True
        opts.name_IDs = ["*"]         # 保留名称表里的版权与协议信息（OFL 要求）
        font = subset.load_font(str(src), opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=chars)
        sub.subset(font)
        path = OUT / f"{name}.woff"
        subset.save_font(font, str(path), opts)
        print(f"{path.relative_to(ROOT)}：{len(chars)} 字，{path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
