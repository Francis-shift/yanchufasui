"""把两款书法字体按字表裁成网页字体，放进 public/fonts/。

用法：python tools/subset_font.py <名字用字体.ttf> <大字用字体.ttf> [输出目录，默认 public/fonts]
  例：python tools/subset_font.py tools/fonts-src/MaShanZheng-Regular.ttf tools/fonts-src/ZhiMangXing-Regular.ttf

字表来自 game/rules/charset.js（用 node 读出来，保证和游戏里判断名字用的是同一张表）：
  brush-core.woff  名字用：手挑的几百字 + 数字标点，开局就下载；
  brush-rest.woff  名字用：其余一级字，用到或空闲时再下载；
  brush-big.woff   大字用：只有固定大字那几十个字。
源字体不进仓库（几兆大），放在 tools/fonts-src/（已加进 .gitignore）。
两款字体都是开源的 SIL OFL 协议（没有声明保留字体名，裁剪后不必改名），协议原文随字体放在 public/fonts/。
"""
import json
import pathlib
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"

JS = ("import { CORE, CHARSET, BIG_CHARS } from './game/rules/charset.js';"
      "console.log(JSON.stringify({ core: CORE, all: CHARSET, big: BIG_CHARS }))")


def charsets():
    r = subprocess.run(["node", "--input-type=module", "-e", JS], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", check=True)
    cs = json.loads(r.stdout)
    seen = set(cs["core"])
    rest = "".join(c for c in cs["all"] if c not in seen)
    return cs["core"], rest, cs["big"]


def cut(src, chars, path):
    cmap = TTFont(src).getBestCmap()
    missing = [c for c in chars if c.strip() and ord(c) not in cmap]
    if missing:
        print(f"  {src.name} 缺 {len(missing)} 个字（会退回下一款字体）：{''.join(missing[:80])}")
    opts = subset.Options()
    opts.flavor = "woff"          # 本机没有 brotli，压不了 woff2；woff 用 zlib，浏览器都认
    opts.hinting = False          # 毛笔字放大显示，微调信息没用，去掉更小
    opts.desubroutinize = True
    opts.name_IDs = ["*"]         # 保留名称表里的版权与协议信息（OFL 要求）
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    subset.save_font(font, str(path), opts)
    print(f"{path}：{len(chars)} 字，{path.stat().st_size / 1024:.0f} KB")


def main():
    name_src, big_src = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    out = pathlib.Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else OUT
    out.mkdir(parents=True, exist_ok=True)
    core, rest, big = charsets()
    cut(name_src, core, out / "brush-core.woff")
    cut(name_src, rest, out / "brush-rest.woff")
    cut(big_src, big, out / "brush-big.woff")


if __name__ == "__main__":
    main()
