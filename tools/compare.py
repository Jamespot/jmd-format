#!/usr/bin/env python3
"""Compare two PDFs page by page, pixel-wise, with no dependencies (pdftoppm → raw PPM).
usage: tools/compare.py candidate.pdf reference.pdf [reference pages, e.g. 4,5,6,16] [--out dir]
Prints, per page: % of differing pixels (threshold 24/255 per channel), mean delta, and writes a diff image (PGM)."""
import subprocess, sys, os, tempfile

def ppm(pdf, page, dpi, out):
    subprocess.run(['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-singlefile', pdf, out], check=True)
    with open(out + '.ppm', 'rb') as f:
        data = f.read()
    # P6 header: "P6\n<w> <h>\n255\n"
    parts = data.split(b'\n', 3)
    w, h = map(int, parts[1].split())
    return w, h, parts[3]

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    cand, ref = args[0], args[1]
    ref_pages = [int(p) for p in args[2].split(',')] if len(args) > 2 else None
    out_dir = None
    if '--out' in sys.argv: out_dir = sys.argv[sys.argv.index('--out') + 1]; os.makedirs(out_dir, exist_ok=True)
    dpi = 96
    n = int([l for l in subprocess.run(['pdfinfo', cand], capture_output=True, text=True).stdout.splitlines() if l.startswith('Pages')][0].split()[-1])
    if ref_pages is None: ref_pages = list(range(1, n + 1))
    tmp = tempfile.mkdtemp()
    print(f"{'page':>5} {'ref':>4} {'diff %':>8} {'mean Δ':>8}  verdict")
    worst = 0
    for i, rp in enumerate(ref_pages, 1):
        w1, h1, a = ppm(cand, i, dpi, os.path.join(tmp, f'c{i}'))
        w2, h2, b = ppm(ref, rp, dpi, os.path.join(tmp, f'r{i}'))
        if (w1, h1) != (w2, h2):
            print(f"{i:>5} {rp:>4}  size mismatch {w1}x{h1} vs {w2}x{h2}"); continue
        npx = w1 * h1
        diff = 0; total = 0
        dimg = bytearray(npx) if out_dir else None
        for p in range(npx):
            k = p * 3
            d = max(abs(a[k] - b[k]), abs(a[k+1] - b[k+1]), abs(a[k+2] - b[k+2]))
            total += d
            if d > 24: diff += 1
            if dimg is not None: dimg[p] = 255 - min(255, d * 3)
        pct = 100 * diff / npx; mean = total / npx
        worst = max(worst, pct)
        verdict = 'identical' if pct < 0.05 else ('indistinguishable' if pct < 1 else ('close' if pct < 5 else 'different'))
        print(f"{i:>5} {rp:>4} {pct:8.2f} {mean:8.2f}  {verdict}")
        if dimg is not None:
            with open(os.path.join(out_dir, f'diff-{i}.pgm'), 'wb') as f:
                f.write(f'P5\n{w1} {h1}\n255\n'.encode() + bytes(dimg))
    print(f"\nworst page: {worst:.2f} % differing pixels")

main()
