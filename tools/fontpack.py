#!/usr/bin/env python3
"""Pack local font files into a brand font CSS (@font-face with woff2 data URIs), subset to Latin + Latin Extended.
usage: tools/fontpack.py out.css "Family Name" file.ttf|otf[@lo-hi] [more files…]
       A variable font gets font-weight 100 1000; a static file gets the weight found in its OS/2 table, or the range
       given after @ (garet-book.otf@300-500 garet-heavy.otf@600-900: two free weights covering the whole scale).
       Only pack a font the brand may redistribute: every deck embeds it.
Needs: pip install fonttools brotli  (build-time only — the produced CSS is what the runtime embeds)."""
import sys, base64, io
from fontTools.ttLib import TTFont
from fontTools import subset

UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x17F)) + list(range(0x2000, 0x206F)) + \
    [0x20AC, 0x2122, 0x2190, 0x2192, 0x2022, 0x00D7, 0x2026]

def pack(path):
    f = TTFont(path)
    variable = 'fvar' in f
    weight = '100 1000' if variable else str(f['OS/2'].usWeightClass)
    italic = bool(f['OS/2'].fsSelection & 1) if not variable else False
    opts = subset.Options(flavor='woff2', layout_features=['*'], notdef_outline=True)
    s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(f); f.flavor = 'woff2'
    buf = io.BytesIO(); f.save(buf)
    return weight, italic, base64.b64encode(buf.getvalue()).decode()

def main():
    out, family, files = sys.argv[1], sys.argv[2], sys.argv[3:]
    lines = [f'/* {family} — packed by tools/fontpack.py, Latin + Latin Extended subset, woff2 data URIs */']
    for p in files:
        p, _, rng = p.partition('@')
        weight, italic, b64 = pack(p)
        if rng: weight = rng.replace('-', ' ')
        lines.append(f"@font-face{{font-family:'{family}';font-style:{'italic' if italic else 'normal'};font-weight:{weight};font-display:block;src:url(data:font/woff2;base64,{b64}) format('woff2')}}")
    open(out, 'w').write('\n'.join(lines) + '\n')
    print(out, sum(len(l) for l in lines) // 1024, 'KB')

main()
