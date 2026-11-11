#!/usr/bin/env node
/* The catalogue of open-licence typefaces a brand may name (#83) — how it was fetched, so anyone can fetch it again and get
   the same bytes. Run by hand, never by a build or a test: the files it writes are committed, and the deck embeds them from
   the disk (tools/fonts.mjs). Nothing here runs on the server.

   Source: the @fontsource packages on npm, each at an exact version. `npm pack` checks the tarball against the registry's
   sha512 (recorded as `integrity`); each woff2 kept is then recorded with its own sha256, which tools/test.mjs checks again.
   What is kept of a face: Regular (400) and Bold (700) — the one weight a face has when it has one — in the latin and
   latin-ext subsets, each with the unicode-range Fontsource gives it, and the licence text of the package beside them.

   usage: node tools/fontcatalogue.mjs                 fetch every face below into themes/brands/fonts/catalogue/
          FONTKIT_DIR=<dir> node tools/fontcatalogue.mjs --samples
                                                      also draw each face's name as an SVG path for the card (a product page
                                                      cannot load a font: spec/design.md) — needs fontkit installed in <dir>
                                                      (npm i fontkit@2.0.4 there); the drawing is committed, fontkit is not. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'themes/brands/fonts/catalogue');

/* [package, version, family, group, office face for a .pptx] — the office face is one every office suite has (Wedoc's
   OnlyOffice, PowerPoint): a .pptx names a face, it never carries one (spec/export.md, "Fonts"). */
export const FACES = [
  ['inter', '5.3.0', 'Inter', 'sans', 'Arial'],
  ['roboto', '5.3.0', 'Roboto', 'sans', 'Arial'],
  ['open-sans', '5.3.0', 'Open Sans', 'sans', 'Arial'],
  ['lato', '5.3.0', 'Lato', 'sans', 'Arial'],
  ['montserrat', '5.3.0', 'Montserrat', 'sans', 'Arial'],
  ['poppins', '5.3.0', 'Poppins', 'sans', 'Arial'],
  ['raleway', '5.3.0', 'Raleway', 'sans', 'Arial'],
  ['source-sans-3', '5.3.1', 'Source Sans 3', 'sans', 'Arial'],
  ['nunito', '5.3.0', 'Nunito', 'sans', 'Arial'],
  ['work-sans', '5.3.0', 'Work Sans', 'sans', 'Arial'],
  ['dm-sans', '5.3.0', 'DM Sans', 'sans', 'Arial'],
  ['manrope', '5.3.0', 'Manrope', 'sans', 'Arial'],
  ['plus-jakarta-sans', '5.3.0', 'Plus Jakarta Sans', 'sans', 'Arial'],
  ['figtree', '5.3.0', 'Figtree', 'sans', 'Arial'],
  ['outfit', '5.3.0', 'Outfit', 'sans', 'Arial'],
  ['merriweather', '5.3.0', 'Merriweather', 'serif', 'Georgia'],
  ['playfair-display', '5.3.0', 'Playfair Display', 'serif', 'Georgia'],
  ['lora', '5.3.0', 'Lora', 'serif', 'Georgia'],
  ['source-serif-4', '5.3.1', 'Source Serif 4', 'serif', 'Georgia'],
  ['libre-baskerville', '5.3.0', 'Libre Baskerville', 'serif', 'Georgia'],
  ['eb-garamond', '5.3.0', 'EB Garamond', 'serif', 'Georgia'],
  ['bebas-neue', '5.3.0', 'Bebas Neue', 'display', 'Arial'],
  ['oswald', '5.3.0', 'Oswald', 'display', 'Arial'],
  ['archivo-black', '5.3.0', 'Archivo Black', 'display', 'Arial'],
  ['space-grotesk', '5.3.0', 'Space Grotesk', 'display', 'Arial'],
  ['jetbrains-mono', '5.3.0', 'JetBrains Mono', 'mono', 'Courier New'],
  ['ibm-plex-mono', '5.3.0', 'IBM Plex Mono', 'mono', 'Courier New'],
];
const SUBSETS = ['latin', 'latin-ext'];
const sha256 = b => createHash('sha256').update(b).digest('hex');

function fetchFaces() {
  mkdirSync(out, { recursive: true });
  const faces = [];
  for (const [pkg, version, family, group, office] of FACES) {
    const tmp = mkdtempSync(join(tmpdir(), 'fontcat-'));
    try {
      const [packed] = JSON.parse(execFileSync('npm', ['pack', `@fontsource/${pkg}@${version}`, '--json', '--pack-destination', tmp], { cwd: tmp, encoding: 'utf8' }));
      execFileSync('tar', ['xzf', join(tmp, packed.filename), '-C', tmp]);
      const p = join(tmp, 'package'), meta = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'));
      if (meta.license !== 'OFL-1.1' && meta.license !== 'Apache-2.0') throw new Error(`${pkg}: licence ${meta.license} is not an open font licence we ship`);
      const weights = [400, 700].filter(w => existsSync(join(p, 'files', `${pkg}-latin-${w}-normal.woff2`)));
      if (!weights.length) throw new Error(`${pkg}: no Regular nor Bold woff2`);
      const dir = join(out, pkg); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      copyFileSync(join(p, 'LICENSE'), join(dir, 'LICENSE'));
      const files = [];
      for (const w of weights) {
        const css = readFileSync(join(p, `${w}.css`), 'utf8');
        for (const s of SUBSETS) {
          const file = `${pkg}-${s}-${w}-normal.woff2`, src = join(p, 'files', file);
          if (!existsSync(src)) continue;
          const block = new RegExp(`/\\* ${pkg}-${s}-${w}-normal \\*/[^}]*unicode-range:\\s*([^;]+);`).exec(css);
          if (!block) throw new Error(`${pkg}: no unicode-range for ${file}`);
          copyFileSync(src, join(dir, file));
          // Regular serves the light half of the scale and Bold the heavy half — no synthesized weight between them
          files.push({ file, subset: s, weight: weights.length === 1 ? '100 900' : w === 400 ? '100 500' : '600 900', range: block[1].trim(), sha256: sha256(readFileSync(src)) });
        }
      }
      faces.push({ id: pkg, family, group, office, licence: meta.license, source: `npm:@fontsource/${pkg}@${version}`, integrity: packed.integrity, files });
      console.log(`${family}: ${files.length} files, ${weights.join('+')}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  return faces;
}

/** The family's name drawn in its own face, as one SVG path at a 200-unit em (integers: a fifth of a pixel at the size the card draws it) — the card shows it, since its page loads no font. */
function drawSamples(faces) {
  const dir = process.env.FONTKIT_DIR;
  if (!dir) throw new Error('--samples needs FONTKIT_DIR, a folder where fontkit is installed');
  const fontkit = createRequire(join(dir, 'x.js'))('fontkit');
  for (const f of faces) {
    const file = f.files.find(x => x.subset === 'latin' && /^100 (500|900)$/.test(x.weight));
    const font = fontkit.create(readFileSync(join(out, f.id, file.file)));
    const k = 200 / font.unitsPerEm, run = font.layout(f.family);
    let x = 0, d = '';
    run.glyphs.forEach((g, i) => {
      const p = g.path.scale(k, -k).translate(x, 190); // every face on one baseline at one em, so the names line up by size
      d += p.toSVG().replace(/-?\d+\.\d+/g, n => String(Math.round(+n)));
      x += run.positions[i].xAdvance * k;
    });
    f.sample = { w: Math.ceil(x), h: 250, d };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifest = join(out, 'catalogue.json');
  const samples = process.argv.includes('--samples');
  const faces = process.argv.includes('--samples-only') ? JSON.parse(readFileSync(manifest, 'utf8')).faces : fetchFaces();
  if (samples || process.argv.includes('--samples-only')) drawSamples(faces);
  writeFileSync(manifest, JSON.stringify({
    about: 'Open-licence typefaces a brand may name (#83): fetched by tools/fontcatalogue.mjs, embedded in a deck by tools/fonts.mjs. Each face keeps its licence text in its folder.',
    faces,
  }, null, 1) + '\n');
  console.log(`${faces.length} faces → ${manifest}`);
}
