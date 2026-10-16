#!/usr/bin/env node
/* End-to-end tests for james-jmd.html and the jmd CLI — drives headless Chrome over CDP, zero dependencies.
   usage: node tools/test.mjs                (builds first, then runs every scenario)
          REFERENCE_PDF=… node tools/test.mjs (+ pixel comparison with the private reference deck)
   Requires Google Chrome. Set CHROME to override the binary path. */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, symlinkSync, openSync, ftruncateSync, closeSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Browser } from './cdp.mjs';
import '../runtime/jmd-core.js'; // defines globalThis.JMD
const JMD = globalThis.JMD;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const document_has_status = html => /id="status"/.test(html);
const tmp = mkdtempSync(join(tmpdir(), 'james-jmd-'));
let passed = 0, failed = 0;
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── fixtures ───────────────────────────────────────────────────────────
// The runtime tests use the neutral four-blocks sample. Four long bullets are appended to its compare
// slide to provoke a real overflow (past what the auto-fit absorbs); removing them is the fix an agent would apply.
// Two of them alone are a small overflow: the slide is fitted, a warning, the file is made (§1b).
const SMALL = "- A fifth commitment, long enough to wrap onto a second line inside the light column of the compare block.\n- A sixth commitment, also long enough to wrap onto a second line, so the columns run past the page edge.\n";
const EXTRA = SMALL + "- A seventh commitment, long enough to wrap onto a second line, so the columns run past the page edge.\n- An eighth commitment, long enough to wrap onto a second line, so the columns run past the page edge.\n";
const ANCHOR = '- The executive committee is set. You know today who decides, and on what.\n';
/* The runtime tests measure real type: a click's caret, a double-click's word, an overflow provoked past what the auto-fit
   absorbs. They were calibrated against the house face, so the fixtures are built in it wherever it is present, and in the
   tree's own default where it is not — the public tree ships no `jamespot` brand and no Garet (PUBLIC.md). The four
   assertions that read those pixels stand aside there rather than measure a face they were never calibrated on. */
/* JMD_NO_HOUSE=1 runs this suite as the public tree runs it, without leaving this one: the house brand is taken as absent.
   It is the only way to know that the public repo's `npm test` passes before that repo exists. */
const HOUSE = process.env.JMD_NO_HOUSE || !existsSync(join(root, 'themes/brands/jamespot.yaml')) ? null : 'jamespot';
const ANY_BRAND = HOUSE || 'mono'; // tests that just need *a* brand, not the house one
const BUILD = { cwd: root, stdio: 'ignore', env: HOUSE ? { ...process.env, JMD_DEFAULT_BRAND: HOUSE } : process.env };

const fixed = readFileSync(join(root, 'decks/samples/four-blocks.jmd'), 'utf8');
const src = fixed.replace(ANCHOR, ANCHOR + EXTRA);
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build/four-blocks-overflow.jmd'), src);
execSync('node tools/build.mjs', BUILD);
execSync('node tools/build.mjs build/four-blocks-overflow.jmd', BUILD);
execSync('node tools/build.mjs decks/samples/four-blocks.jmd', BUILD); // the editor tests open build/four-blocks.james-jmd.html: built here, never a leftover
const EMPTY = join(root, 'build/james-jmd.html');
const DECK = join(root, 'build/four-blocks-overflow.james-jmd.html');

const browser = await Browser.launch();
const open = url => browser.page(url);
const cli = (args, expectOk = true) => {
  try { return execSync(`node bin/jmd.mjs ${args}`, { cwd: root, stdio: 'pipe' }).toString(); }
  catch (e) { if (expectOk) throw e; return { code: e.status, out: e.stdout.toString() }; }
};

try {
  console.log('\n1. Self-contained deck (four-blocks + a provoked overflow)');
  let p = await open('file://' + DECK);
  await p.settle();
  ok(src !== fixed, 'fixture: two bullets appended to the compare slide');
  ok(await p.eval('document.querySelectorAll(".slide").length') === 4, 'renders 4 slides');
  ok(await p.eval('document.querySelector(".slide.is-active .slide-tag").textContent') === '01', 'starts on slide 01');
  if (HOUSE) ok(await p.eval('[...document.fonts].filter(f => f.family.replace(/"/g, "") === "Garet" && f.status === "loaded").length === 2 && document.fonts.check("300 20px Garet") && document.fonts.check("900 20px Garet")'), 'embedded fonts are loaded: both Garet faces (Book 300–500, Heavy 600–900) declared and loaded');
  ok(!/(src|href)="https?:/.test(readFileSync(DECK, 'utf8')), 'no network resource in the file');
  await p.key('ArrowRight'); await p.key('ArrowRight');
  ok(await p.eval('document.querySelector(".slide.is-active .slide-tag").textContent') === '03', '→ → lands on slide 03');
  ok(await p.eval('document.querySelector(".slide.is-active .statement .q").textContent.startsWith("We are a product company")'), 'slide 03 is the statement');
  await p.key('N');
  ok(await p.eval('document.getElementById("notes").classList.contains("is-open") && document.getElementById("notes-txt").textContent.includes("landing point")'), 'N opens the speaker notes of the current slide');
  const L = JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)'));
  ok(L.length === 1 && L[0].rule === 'overflow' && L[0].slide === 4, 'linter: exactly one error, overflow on slide 4', JSON.stringify(L));
  ok(!(await p.eval('document.getElementById("info").classList.contains("is-open")')) && !document_has_status(await p.eval('document.body.innerHTML')), 'nothing opens by itself, no error badge on the slide');
  ok((await p.eval('document.getElementById("help").textContent')).includes('info:') && !(await p.eval('document.getElementById("hud").textContent')).includes('linter'), 'the help offers I info, not L linter');
  await p.key('I');
  const card = await p.eval('document.getElementById("info").textContent');
  ok(await p.eval('document.getElementById("info").classList.contains("is-open")') && card.includes('four-blocks') && card.includes('slides4') && card.includes(ANY_BRAND) && card.includes('jmd/1'), 'I opens the file card: name, slides, brand, format');
  ok(card.includes('1 error') && await p.eval('document.getElementById("info-lint").classList.contains("is-err")'), 'the card ends with the linter line: a red light, "1 error"');
  await p.eval('document.getElementById("info-lint").click(); true');
  ok(await p.eval('document.getElementById("info").classList.contains("is-report")') && (await p.eval('document.getElementById("info-report").textContent')).includes('content reaches') && (await p.eval('document.getElementById("info").textContent')).includes(ANY_BRAND), 'clicking the light unfolds the readable report under the card — the card stays');
  await p.eval('document.getElementById("info-lint").click(); true');
  ok(!(await p.eval('document.getElementById("info").classList.contains("is-report")')), 'clicking it again folds the report');
  ok(/size\d+ KB · source \d+ KB/.test(await p.eval('document.getElementById("info").textContent')), 'the card gives the file size and the source size');
  await p.key('Escape');
  ok(!(await p.eval('document.getElementById("info").classList.contains("is-open")')), 'Esc closes it');
  await p.eval('window.__printed = 0; window.print = () => window.__printed++; window.__alerted = 0; window.alert = () => window.__alerted++; true');
  await p.key('D'); await p.key('P');
  ok(await p.eval('window.__printed') === 0 && await p.eval('window.__alerted') === 0 && await p.eval('document.getElementById("info").classList.contains("is-open") && document.getElementById("info").classList.contains("is-report")') && (await p.eval('document.getElementById("info-report").textContent')).includes('The PDF waits'), 'P is refused while the linter has errors — Info opens on the report with one line, no alert');
  // the fix an agent would apply: remove the two items, reload through the runtime API
  await p.eval(`jamesJmd.load(${JSON.stringify(fixed)}, "fixed.jmd"); true`); await p.settle();
  ok(await p.eval('jamesJmd.state.lint.filter(x => x.level === "error").length') === 0, 'removing the two items clears the overflow', await p.eval('JSON.stringify(jamesJmd.state.lint)'));
  await p.key('P'); await p.settle(30);
  ok(await p.eval('window.__printed') === 0, 'P alone does nothing: a PDF is a download, and every file leaves through D (2026-10-07)');
  await p.key('D'); await p.key('P');
  ok(await p.eval('window.__printed') === 1, 'D then P: from disk, the print dialog (Save as PDF) once the deck is clean');
  // self-contained export: intercept the download, check the round-trip
  await p.eval('URL.createObjectURL = b => { window.__blob = b; return "blob:test"; }; HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; }; true');
  await p.key('S'); await p.settle(30);
  ok(await p.eval('window.__dl') === undefined, 'S alone downloads nothing: the page leaves through D (2026-10-07)');
  await p.key('D'); await p.key('S');
  const exported = await p.eval('window.__blob.text()');
  ok(await p.eval('window.__dl') === 'Northwind × Contoso — four blocks.james-jmd.html', 'D then S downloads the page under the deck\'s title, as the PDF and the PowerPoint are named', await p.eval('window.__dl'));
  /* One name, made in one place (runtime/jmd-core.js fileName): the title as a person reads it, what a file system refuses
     replaced, 80 characters at most; no title → the source's name, else "deck"; a version says its number. */
  const fname = (t, sfx, o) => JMD.fileName(t == null ? null : { meta: { title: t } }, sfx, o);
  ok(fname('Neoditel 25 ans — souveraineté', '.pptx') === 'Neoditel 25 ans — souveraineté.pptx' && fname('a/b\\c:d*e?"f<g>h|i\u0001j', '.pdf') === 'a b c d e f g h i j.pdf' && fname('', '.jmd', { fallback: 'kickoff.jmd' }) === 'kickoff.jmd' && fname(null, '') === 'deck' && fname('Q3', '.pptx', { version: 4 }) === 'Q3 (v4).pptx' && fname('x'.repeat(200), '').length === 80, 'fileName: the title kept (accents, dashes), forbidden characters out, a fallback, a version, 80 characters at most');
  const m = /<script type="text\/jmd" id="jmd"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(exported);
  ok(m && m[1] === fixed, 'exported file embeds the current source byte-for-byte');
  ok(!/<section class="slide slide--\w+"/.test(exported), 'exported file carries no rendered DOM, only the source');
  await p.close();

  console.log('\n1b. Auto-fit: a slide a little over the limit is shown smaller, a warning, the file is made');
  {
    p = await open('file://' + EMPTY); await p.settle();
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed.replace(ANCHOR, ANCHOR + SMALL))}, "small.jmd"); true`); await p.settle(400);
    const F = JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint.filter(x => x.rule === "overflow" || x.rule === "fit"))'));
    ok(F.length === 1 && F[0].rule === 'fit' && F[0].level === 'warning' && F[0].slide === 4 && /shown at 9\d %/.test(F[0].message) && /shorten a text/.test(F[0].message), 'two extra bullets: no overflow error, a `fit` warning that says the zoom and what to do', JSON.stringify(F));
    const fitted = await p.eval('(() => { const s = document.querySelectorAll(".slide")[3], b = s.querySelector(".body-pad"), w0 = document.querySelectorAll(".slide")[0].querySelector(".body-pad").getBoundingClientRect().width; return { cls: s.classList.contains("is-fit"), fit: +s.dataset.fit, zoom: b.style.zoom, width: Math.round(b.getBoundingClientRect().width) === Math.round(w0), bottom: (b.lastElementChild.getBoundingClientRect().bottom - s.getBoundingClientRect().top) / (s.getBoundingClientRect().width / 1280) }; })()');
    ok(fitted.cls && fitted.fit >= 0.85 && fitted.fit < 1 && fitted.zoom === String(fitted.fit) && fitted.width && fitted.bottom <= 660, 'the body is zoomed to the fit, its rendered width kept, its content now above the limit (' + JSON.stringify(fitted) + ')');
    await p.eval('window.__printed = 0; window.print = () => window.__printed++; true');
    await p.key('D'); await p.key('P');
    ok(await p.eval('window.__printed') === 1, 'P prints: a fitted slide is not an error');
    await p.key('E'); await p.settle(100); await p.eval('jamesJmd.show(3); true'); await p.settle(100);
    const mark = await p.eval('(() => { const s = document.querySelector(".slide.is-active"); const cs = getComputedStyle(s, "::after"); return { line: cs.borderTopStyle, text: cs.content }; })()');
    ok(mark.line === 'dotted' && /fit/.test(mark.text), 'in edit mode the fitted slide shows a dotted line at the limit with the zoom (' + JSON.stringify(mark) + ')');
    await p.key('E'); await p.settle(50);
    await p.eval(`jamesJmd.load(${JSON.stringify(src)}, "over.jmd"); true`); await p.settle(400);
    ok(await p.eval('jamesJmd.state.lint.filter(x => x.rule === "fit").length') === 0 && await p.eval('jamesJmd.state.lint.filter(x => x.rule === "overflow" && x.level === "error").length') === 1 && await p.eval('document.querySelectorAll(".slide")[3].style.zoom || document.querySelectorAll(".slide")[3].querySelector(".body-pad").style.zoom') === '', 'four extra bullets: below ' + Math.round(0.85 * 100) + ' % the slide is not fitted, the overflow stays an error');
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed)}, "fixed.jmd"); true`); await p.settle(300);
    ok(await p.eval('[...document.querySelectorAll(".slide")].every(s => !s.dataset.fit && !s.classList.contains("is-fit"))'), 'reloading a clean deck leaves no fit behind');
    await p.close();
  }

  console.log('\n2. Exported file reopens offline');
  const exp = join(tmp, 'fixed.james-jmd.html'); writeFileSync(exp, exported);
  p = await open('file://' + exp); await p.settle();
  ok(await p.eval('document.querySelectorAll(".slide").length') === 4, 'renders 4 slides');
  ok(await p.eval('jamesJmd.state.lint.filter(x => x.level === "error").length') === 0, 'no linter error');
  ok(await p.eval('document.title') === 'Northwind × Contoso — four blocks — james-jmd', 'document title comes from the deck');
  await p.close();

  console.log('\n3. Empty runtime');
  p = await open('file://' + EMPTY); await p.settle();
  ok(await p.eval('document.getElementById("open").classList.contains("is-open")'), 'shows the Open screen');
  ok(await p.eval('document.querySelectorAll(".slide").length') === 0, 'no slide rendered');
  await p.eval(`(() => { const f = new File([${JSON.stringify(fixed)}], "dropped.jmd", {type: "text/plain"}); const dt = new DataTransfer(); dt.items.add(f); document.dispatchEvent(new DragEvent("drop", {dataTransfer: dt, bubbles: true, cancelable: true})); return true; })()`);
  await new Promise(r => setTimeout(r, 300)); await p.settle();
  ok(await p.eval('document.querySelectorAll(".slide").length') === 4, 'dropping a .jmd renders it');
  ok(!(await p.eval('document.getElementById("open").classList.contains("is-open")')), 'Open screen closes');
  ok(await p.eval('jamesJmd.state.name') === 'dropped.jmd', 'file name is kept for the export');
  await p.close();

  console.log('\n4. ?src= loading (needs HTTP: Chrome blocks fetch() between file:// URLs)');
  writeFileSync(join(tmp, 'sib.jmd'), fixed); writeFileSync(join(tmp, 'james-jmd.html'), readFileSync(EMPTY));
  const srv = createServer((req, res) => { try { res.end(readFileSync(join(tmp, req.url.split('?')[0]))); } catch { res.statusCode = 404; res.end(); } }).listen(0);
  p = await open(`http://127.0.0.1:${srv.address().port}/james-jmd.html?src=sib.jmd`); await p.settle();
  await new Promise(r => setTimeout(r, 300));
  ok(await p.eval('document.querySelectorAll(".slide").length') === 4, 'james-jmd.html?src=sib.jmd renders the sibling file over HTTP');
  await p.close(); srv.close();
  p = await open('file://' + join(tmp, 'james-jmd.html') + '?src=sib.jmd'); await p.settle();
  await new Promise(r => setTimeout(r, 300));
  ok(await p.eval('document.getElementById("open").classList.contains("is-open")'), 'over file:// it falls back to the Open screen instead of a blank page');
  await p.close();

  console.log('\n4b. Download (D): one menu for every way the deck leaves (spec/export.md)');
  {
    /* What a browser makes alone (the page, the PDF) is always offered; PowerPoint and images need the server, so only the
       deck's own page there offers them — a file from disk or a 24-hour link would offer a door nothing answers. */
    const items = async q => JSON.parse(await q.eval(`JSON.stringify([...document.querySelectorAll('#dl-list a, #dl-list button')].map(e => e.querySelector('b').textContent.split(' ')[0] + (e.getAttribute('href') ? ' ' + e.getAttribute('href') : '')))`));
    p = await open('file://' + exp); await p.settle();
    ok(await p.eval('document.getElementById("hud").textContent.replace(/\\s+/g, " ").trim()') === '← → navigate F present E edit D download O open ? all keys', 'the bar holds what one reaches for: navigate, present, edit, download, (open, from disk), all keys — no longer P and S apart', await p.eval('document.getElementById("hud").textContent.replace(/\\s+/g, " ").trim()'));
    await p.key('D'); await p.settle(80);
    ok(await p.eval('document.getElementById("dl").classList.contains("is-open")') && JSON.stringify(await items(p)) === '["Page","PDF"]' && await p.eval('document.activeElement.matches("#dl-list button")'), 'from disk: D opens the menu on the page and the PDF, the first one focused');
    await p.key('Escape'); await p.settle(50);
    ok(!(await p.eval('document.getElementById("dl").classList.contains("is-open")')), 'Esc closes it');
    await p.eval('document.getElementById("hud-dl").click(); true'); await p.settle(50);
    ok(await p.eval('document.getElementById("dl").classList.contains("is-open")'), 'the hud\'s download is a button, for the mouse');
    await p.eval('document.getElementById("dl").click(); true'); await p.settle(50);
    ok(!(await p.eval('document.getElementById("dl").classList.contains("is-open")')), 'a click beside the box closes it');
    /* Without a mouse (2026-10-07): ↑ ↓ move round the list, the letters take a format, and while the menu is open its keys
       are its own — an arrow does not move the slides behind, Enter does not turn the page. */
    const focused = () => p.eval('document.activeElement.getAttribute("data-key")'), slideNow = () => p.eval('jamesJmd.state.index');
    const before = await slideNow();
    await p.key('D'); await p.settle(50); await p.key('ArrowDown'); const down = await focused(); await p.key('ArrowDown'); const wrapped = await focused(); await p.key('ArrowUp'); const up = await focused();
    await p.key('ArrowRight'); await p.key('Enter'); await p.settle(50);
    ok(down === 'P' && wrapped === 'S' && up === 'P' && await slideNow() === before && !(await p.eval('document.getElementById("dl").classList.contains("is-open")')), '↓ ↑ move round the list (S, P, S, P); an arrow and Enter in the menu never move the slides — Enter takes the one in focus', JSON.stringify([down, wrapped, up]));
    await p.eval('window.__dl = []; HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); }; true'); // the runtime downloads through an <a download>: catch it
    await p.key('D'); await p.settle(50); await p.key('s'); await p.settle(50);
    ok(JSON.parse(await p.eval('JSON.stringify(window.__dl)')).some(n => /\.james-jmd\.html$/.test(n)) && !(await p.eval('document.getElementById("dl").classList.contains("is-open")')), 'D then S: the page leaves, the menu closes');
    await p.key('D'); await p.settle(50); await p.key('q'); await p.key('i'); await p.settle(50);
    ok(await p.eval('document.getElementById("dl").classList.contains("is-open") && !document.getElementById("info").classList.contains("is-open")') && await slideNow() === before, 'a letter the menu does not have does nothing — not the info card (I) behind it either');
    await p.key('D'); await p.settle(50);
    ok(!(await p.eval('document.getElementById("dl").classList.contains("is-open")')), 'D again closes it');
    await p.close();
    const jmdLib = await import('../lib/jmd.mjs');
    const pageHtml = await jmdLib.build('---\nformat: jmd/1\nlayout: webpage\ntitle: A page\n---\n\n# One page\n\nA line.\n', { brand: ANY_BRAND });
    const hosted = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/deck/WWWWWWWWWWWWWWWW') ? pageHtml : readFileSync(exp)); }).listen(0);
    const at = `http://127.0.0.1:${hosted.address().port}`, seen = {};
    for (const path of ['/deck/AAAAAAAAAAAAAAAA', '/deck/AAAAAAAAAAAAAAAA/v/3', '/deck/AAAAAAAAAAAAAAAA/edit/abcdefghijklmnopqrstuv/', '/d/BBBBBBBBBBBBBBBB/fixed.james-jmd.html', '/deck/WWWWWWWWWWWWWWWW']) {
      p = await open(at + path); await p.settle(); await p.key('D'); await p.settle(80); seen[path] = await items(p);
      if (path === '/deck/AAAAAAAAAAAAAAAA') { // X and I take the server's files: the link is clicked, the menu closes
        // the link is caught on its way out (after the menu put its token on it), the browser does not follow it here
        await p.eval('window.__href = []; window.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a[download]"); if (a) { e.preventDefault(); window.__href.push(a.getAttribute("href")); } }); true');
        await p.key('x'); await p.settle(300);
        seen.drawing = await p.eval('document.getElementById("dl-toast").classList.contains("is-open") && document.querySelector("#dl-toast .t").textContent');
        const token = (await p.eval('window.__href[0] || ""')).split('?t=')[1] || '';
        await p.eval(`document.cookie = 'jmd-dl-${token}=ok; Path=/'; true`); await p.settle(400); // what the server says with the file
        seen.ready = await p.eval('document.querySelector("#dl-toast .t").textContent + "|" + document.getElementById("dl-toast").className + "|" + document.cookie.includes("jmd-dl-")');
        await p.key('D'); await p.settle(30); await p.key('I'); await p.settle(300);
        const token2 = (await p.eval('window.__href[1] || ""')).split('?t=')[1] || '';
        await p.eval(`document.cookie = 'jmd-dl-${token2}=busy; Path=/'; true`); await p.settle(400);
        seen.busy = await p.eval('document.querySelector("#dl-toast .t").textContent + "|" + document.getElementById("dl-toast").className');
        seen.keys = JSON.parse(await p.eval('JSON.stringify(window.__href)')).map(h => h.replace(/\?t=[a-z0-9]{8,32}$/, '?t=*'));
      }
      await p.close();
    }
    hosted.close();
    ok(JSON.stringify(seen['/deck/AAAAAAAAAAAAAAAA']) === '["Page","PDF /deck/AAAAAAAAAAAAAAAA/deck.pdf","PowerPoint /deck/AAAAAAAAAAAAAAAA/deck.pptx","Images /deck/AAAAAAAAAAAAAAAA/images.zip"]', 'on /deck/<id>: the PDF is a file the server draws (not a print dialog), PowerPoint and images too', JSON.stringify(seen['/deck/AAAAAAAAAAAAAAAA']));
    ok(JSON.stringify(seen.keys) === '["/deck/AAAAAAAAAAAAAAAA/deck.pptx?t=*","/deck/AAAAAAAAAAAAAAAA/images.zip?t=*"]', 'D then X: the PowerPoint; D then I: the images — no mouse, each link with the token the page waits on', JSON.stringify(seen.keys));
    /* The seconds a server draws a PowerPoint looked like a bug (2026-10-07): a strip says what is drawn and counts, then the
       outcome the server's cookie carries — the cookie read once and dropped. */
    ok(/^Drawing the PowerPoint · \d s$/.test(seen.drawing || '') && /^Ready — the PowerPoint is in your downloads\|is-open is-done\|false$/.test(seen.ready) && /^The server is drawing other files — try again in a few seconds\|is-open is-err$/.test(seen.busy), 'while the server draws: "Drawing the PowerPoint · n s" and a bar; then "Ready", or the reason in words (busy)', JSON.stringify([seen.drawing, seen.ready, seen.busy]));
    ok(seen['/deck/AAAAAAAAAAAAAAAA/v/3'].includes('PowerPoint /deck/AAAAAAAAAAAAAAAA/v/3/deck.pptx') && seen['/deck/AAAAAAAAAAAAAAAA/edit/abcdefghijklmnopqrstuv/'].includes('PowerPoint /deck/AAAAAAAAAAAAAAAA/deck.pptx'), 'a published version exports itself; the edit page exports the deck as stored — never a URL with the edit key in it');
    ok(JSON.stringify(seen['/d/BBBBBBBBBBBBBBBB/fixed.james-jmd.html']) === '["Page","PDF"]' && JSON.stringify(seen['/deck/WWWWWWWWWWWWWWWW']) === '["Page","PDF /deck/WWWWWWWWWWWWWWWW/deck.pdf","Images /deck/WWWWWWWWWWWWWWWW/images.zip"]', 'a 24-hour link offers what the browser makes alone; a Webpage has no PowerPoint', JSON.stringify([seen['/d/BBBBBBBBBBBBBBBB/fixed.james-jmd.html'], seen['/deck/WWWWWWWWWWWWWWWW']]));
  }

  console.log('\n5. Linter on a broken deck');
  const bad = `---\nformat: jmd/2\n---\n---\nbg: pink\n---\n::: foo\n- a\n:::\n---\n---\n## A title that is far too long to fit the sixty characters budget\n::: metrics\n- 1|a\n- 2|b\n- 3|c\n- 4|d\n- 5|e\n:::\n---\nnotes: x\n---\n## T\n::: metrics\n- 1|a\n::: cards\n:::\n:::\n`;
  p = await open('file://' + EMPTY); await p.settle();
  await p.eval(`jamesJmd.load(${JSON.stringify(bad)}, "bad.jmd"); true`); await p.settle();
  const rules = await p.eval('jamesJmd.state.lint.map(x => x.level[0] + ":" + x.rule).sort().join(" ")');
  for (const r of ['e:format', 'e:bg', 'e:unknown-block', 'e:no-title', 'e:max-items', 'e:nested', 'w:title-length', 'i:no-notes'])
    ok(rules.split(' ').includes(r), `reports ${r}`, rules);
  ok(await p.eval('jamesJmd.state.lint.every(x => typeof x.slide === "number" && "block" in x && "rule" in x && "message" in x)'), 'every finding has slide/block/rule/message');
  await p.close();

  // Seen in the field: a channel replaced every `:::` of the contract by a placeholder, the agent copied it, the deck built with
  // the cards printed as text and the lint said clean. The opener lands in the lead, the closer in the prose.
  const mangled = (fence) => `---\nformat: jmd/1\n---\n---\nnotes: x\n---\n## Cards\n\n${fence} cards\n### One\nText.\n\n### Two\nText.\n${fence}\n`;
  for (const fence of [':[ip 1]', '::', '::::']) {
    const f = JMD.lint(JMD.parse(mangled(fence))).filter(x => x.rule === 'stray-fence');
    ok(f.length === 2 && f[0].message.includes('write `::: cards`') && f[1].message.includes('write `:::`') && !JMD.lint(JMD.parse(mangled(fence))).some(x => x.rule === 'loose-heading'),
      `stray-fence: \`${fence} cards\` … \`${fence}\` → two errors naming the fix, and the headings under it are not reported twice`, JSON.stringify(f));
  }
  ok(JMD.lint(JMD.parse(mangled(':::'))).filter(x => x.rule === 'stray-fence' || x.rule === 'loose-heading').length === 0, 'the same deck with real fences is clean');
  const loose = JMD.lint(JMD.parse('---\nformat: jmd/1\n---\n---\nnotes: x\n---\n## T\n\nLead.\n\n### One\nText.\n\n### Two\nText.\n'));
  ok(loose.filter(x => x.rule === 'loose-heading').length === 1 && loose.find(x => x.rule === 'loose-heading').message.startsWith('2 `#` headings'), 'loose-heading: `###` outside a block is one error per slide, with the count');
  const bare = JMD.lint(JMD.parse('---\nformat: jmd/1\n---\n---\nnotes: x\n---\n## T\n:::\n\n::: cards\n- a | b\n:::\n'));
  ok(bare.some(x => x.rule === 'stray-fence' && x.message.includes('closes nothing')), 'a bare `:::` under the title closes nothing: said so');

  console.log('\n6. Every sample deck passes the linter (with its own brand and files)');
  for (const f of execSync('ls decks/samples/*.jmd', { cwd: root }).toString().trim().split('\n')) {
    const r = cli(`lint ${f} --dom --json`, false);
    const js = JSON.parse(typeof r === 'string' ? r : r.out);
    ok(js.ok === true, `${f} has no linter error`, JSON.stringify(js.findings.filter(x => x.level === 'error')));
  }

  // the pages of the site written as decks (/doc, /releases) obey the same linter; the newest release band is this VERSION (1.27.0)
  for (const f of existsSync(join(root, 'mcp/doc')) ? execSync('ls mcp/doc/*.jmd', { cwd: root }).toString().trim().split('\n') : []) {
    const r = cli(`lint ${f} --dom --json`, false);
    const js = JSON.parse(typeof r === 'string' ? r : r.out);
    ok(js.ok === true, `${f} has no linter error`, JSON.stringify(js.findings.filter(x => x.level === 'error')));
  }
  // /releases is the service's page (mcp/doc), which the public tree does not ship (PUBLIC.md): asserted where it is
  if (existsSync(join(root, 'mcp/doc'))) {
    const { checkReleases } = await import('./check-releases.mjs');
    const rel = checkReleases();
    ok(!rel.misses.length, `/releases opens on ${rel.version}, in French and in English (a bump without its band is refused by make deploy-prod too)`, rel.misses.join(' · '));
  } else console.log('  · no mcp/doc in this tree: the release notes are the service\'s, not checked here');

  console.log('\n7. V1 blocks, images, links, assets');
  const tour = readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8');
  execSync('node tools/build.mjs decks/samples/product-tour.jmd', BUILD); // brand from the deck's frontmatter
  p = await open('file://' + join(root, 'build/product-tour.james-jmd.html')); await p.settle();
  ok(await p.eval('document.querySelectorAll(".slide").length') === 12, 'product-tour renders 12 slides');
  ok(await p.eval('document.querySelectorAll(".slide--cover .cover-art img").length') === 2, 'level-1 titles make covers, with cover art');
  ok(await p.eval('document.querySelectorAll(".divider .slide-h1").length') === 1, 'section block renders a divider');
  ok(await p.eval('document.querySelectorAll(".slide--split .split-media img").length') === 4, 'images with .right make split slides');
  ok(await p.eval('document.querySelectorAll(".slide--split-block .split-block .cards").length') === 1, 'a block with .right sits in the right column');
  ok(await p.eval('document.querySelectorAll("a.cta").length') === 3 && await p.eval('document.querySelector("a.cta").getAttribute("href")') === 'https://example.com/inbox', 'links with .cta render as buttons');
  ok(await p.eval('document.querySelector(".cards .card--wide") !== null && document.querySelectorAll(".card ul li span").length > 6'), 'cards: wide card and bullets in the heading form');
  ok(await p.eval('document.querySelectorAll(".card .num").length && document.querySelector(".cards[style*=\'--n:5\'] .card .num").textContent') === '01', 'cards: numbered five-column form');
  ok(await p.eval('document.querySelectorAll(".pills .slide-pill").length') === 4, 'pills');
  ok(await p.eval('document.querySelectorAll(".logos .logo img").length') === 12 && await p.eval('document.querySelector(".logos .logo img").getBoundingClientRect().width') > 20, 'logos render with a real width');
  ok(await p.eval('document.querySelectorAll("img").length') > 0 && await p.eval('[...document.querySelectorAll("img")].every(i => i.src.startsWith("data:image/svg+xml"))'), 'every image is embedded as a data URI');
  ok(await p.eval('jamesJmd.state.lint.filter(x => x.level === "error").length') === 0, 'no linter error in the browser');
  ok(await p.eval('document.querySelector(".slide--sky") !== null && getComputedStyle(document.querySelector(".slide--sky .slide-h2")).color') === 'rgb(255, 255, 255)', 'bg: sky is white-on-color');
  await p.close();
  // assets: missing file → error from the CLI (it sees the disk); not embedded → warning in the browser
  writeFileSync(join(tmp, 'noimg.jmd'), fixed.replace('## Northwind in three numbers.', '## Northwind in three numbers.\n\n![](nope.png){.right}'));
  const miss = cli(`lint ${join(tmp, 'noimg.jmd')}`, false);
  ok(miss.code === 1 && miss.out.includes('missing-asset') && miss.out.includes('nope.png'), 'jmd lint: missing-asset error for a file that does not exist');
  p = await open('file://' + EMPTY); await p.settle();
  await p.eval(`jamesJmd.load(${JSON.stringify(fixed.replace('## Northwind in three numbers.', '## Northwind in three numbers.\n\n![](nope.png){.right}'))}, "x.jmd"); true`); await p.settle();
  ok(await p.eval('jamesJmd.state.lint.some(x => x.rule === "asset-not-embedded" && x.level === "warning")'), 'runtime: asset-not-embedded warning when a dropped deck references files');
  ok(await p.eval('document.querySelector(".split-media .img-missing") !== null'), 'runtime: a missing image shows an empty frame, not a broken page');
  await p.close();
  // the self-contained export keeps the embedded assets
  p = await open('file://' + join(root, 'build/product-tour.james-jmd.html')); await p.settle();
  await p.eval('URL.createObjectURL = b => { window.__blob = b; return "blob:test"; }; HTMLAnchorElement.prototype.click = function(){}; true');
  await p.key('D'); await p.key('S');
  const exp2 = await p.eval('window.__blob.text()');
  ok(/<script type="application\/json" id="assets">\{"assets\/cover.svg":"data:image\/svg\+xml;base64,/.test(exp2), 'S export carries the embedded assets');
  await p.close();

  console.log('\n7c. Data: table and chart (spec/jmd.md → Blocks — data, spec/charts.md)');
  {
    const H = '---\nformat: jmd/1\nlayout: slide\n---\n\n---\nnotes: n\n---\n## Data\n';
    const one = (body, lang) => JMD.parse(H.replace('layout: slide', 'layout: slide' + (lang ? '\nlang: ' + lang : '')) + body);
    const errs = (body, rule) => JMD.lint(one(body)).filter(f => f.level === 'error' && (!rule || f.rule === rule));
    // the table: header, alignment by colons and by numbers, the hero row, a cell is inline
    const tsrc = '::: table\n| Offer | Users | Note |\n|---|---|:-:|\n| **Starter** | 1 240 | ok |\n| Pro | 3,5 | [x](https://e.x) | {.hero}\n:::\n';
    const th = JMD.render(one(tsrc), {});
    ok(/<thead><tr><th[^>]*>Offer<\/th>/.test(th) && (th.match(/<tr/g) || []).length === 3, 'table: the row above |---| is the header, two body rows', th.slice(0, 300));
    ok(/<td class="is-right"[^>]*>1 240<\/td>/.test(th) && /<td class="is-center"[^>]*>ok<\/td>/.test(th) && /<td data-line[^>]*><strong>Starter<\/strong><\/td>/.test(th), 'table: a column of numbers aligns right by itself, `:-:` centers, a cell is inline Markdown');
    ok(/<tr class="is-hero">/.test(th) && /data-line="\d+" data-col="1"/.test(th), 'table: `{.hero}` puts a row forward; a cell carries the column the editor counts (a leading pipe is column 0)');
    ok(!errs(tsrc).length && errs('::: table\n| a | b | c | d | e | f | g |\n|---|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |\n:::\n', 'table-columns').length === 1, 'lint: a clean table; seven columns is `table-columns`');
    const rows = (n, cells = '| a | 1 |') => '::: table\n| Name | N |\n|---|--:|\n' + Array.from({ length: n }, (_, k) => cells.replace('a', 'r' + k) + (k === 9 ? ' {.hero}' : '')).join('\n') + '\n:::\n';
    ok(errs('::: table\n- not a row\n:::\n', 'table-rows').length === 1 && errs(rows(25), 'max-items').length === 1, 'lint: no row is `table-rows`; twenty-five rows is `max-items`');
    // Seen in the field (2026-10-12): 14 companies made two hand-made pairs of columns, unequal, a hero lighting both halves — past 12 rows the table folds itself
    const sh = JMD.render(one(rows(14)), {});
    ok(!errs(rows(14)).length && /<div class="table-split">/.test(sh) && (sh.match(/<table /g) || []).length === 2 && (sh.match(/<thead>/g) || []).length === 2 && (sh.match(/is-hero/g) || []).length === 1, 'table: past 12 rows it folds in two tables side by side, the header repeated, the hero row lit alone');
    const odd = JMD.render(one(rows(13)), {});
    ok(sh.indexOf('>r6<') < sh.lastIndexOf('<table') && sh.indexOf('>r7<') > sh.lastIndexOf('<table') && odd.indexOf('>r6<') < odd.lastIndexOf('<table') && odd.indexOf('>r7<') > odd.lastIndexOf('<table'), 'table: the order runs down the first half then the second, the first the longer (13 rows: 7 and 6)');
    ok(errs(rows(14, '| a | 1 | 2 | 3 |'), 'max-items').length === 1 && errs(rows(6, '| a | 1 | 2 | 3 |').replace('::: table', '::: table {.split}'), 'table-columns').length === 1 && /table-split/.test(JMD.render(one(rows(6).replace('::: table', '::: table {.split}')), {})), 'lint: a folded half holds 3 columns at most; `{.split}` folds a shorter table on demand');
    // A planning seen in the field (2026-10-12): a timeline whose phases carry detail, cards without the theme's marker, an icon in a title
    const phases = '::: timeline\n### Janvier à juin — Cadrage\n- Kick Off\n- Atelier 1\n### Juillet — Pilote {.now}\nCible restreinte.\n### Septembre 2027 — Déploiement {.next}\n- Plan de formation\n:::\n';
    const tp = JMD.render(one(phases), {});
    ok(!errs(phases).length && /<div class="timeline timeline--phases"/.test(tp) && (tp.match(/class="tl-step/g) || []).length === 3 && (tp.match(/<div class="tl-card">/g) || []).length === 3 && /tl-step is-now/.test(tp) && /tl-step is-next/.test(tp), 'timeline: `###` opens a phase (`{.now}` `{.next}` on its heading), its detail in a card under the dot');
    ok(/<div class="tl-date"[^>]*>Janvier à juin<\/div>/.test(tp) && /<h4>Cadrage<\/h4>/.test(tp) && (tp.match(/<li>/g) || []).length === 3 && /<p data-line[^>]*>Cible restreinte\.<\/p>/.test(tp) && errs('::: timeline\n' + Array.from({ length: 7 }, (_, k) => '### P' + k).join('\n') + '\n:::\n', 'max-items').length === 1, 'timeline: `date — title`, bullets and text in a phase; seven phases is `max-items`');
    const plain = JMD.render(one('::: cards {.plain}\n- A | a\n- B | b\n:::\n'), { brand: { 'card-marker': 'glyphs', glyphs: 4 } });
    ok(!/class="num/.test(plain) && /class="num/.test(JMD.render(one('::: cards\n- A | a\n- B | b\n:::\n'), { brand: { 'card-marker': 'glyphs', glyphs: 4 } })), 'cards: `{.plain}` takes the theme\'s marker off, the deck\'s say without touching the theme');
    const icon = '::: cards\n### ![](img:jamespot/logo-jamespot-icone) Cadrage\n- Kick Off\n:::\n';
    ok(errs(icon, 'inline-image').length === 1 && !/!\[|img:jamespot/.test(JMD.render(one(icon), {})) && /<h3[^>]*>Cadrage<\/h3>/.test(JMD.render(one(icon), {})) && !errs('::: logos\n- ![A](a.svg)\n:::\n', 'inline-image').length, 'an image inside a text is `inline-image` and never printed as `![…]`; a logo wall is not one');
    // the chart: the types, the values read as numbers, the series, the hero, the decimal mark of the deck's language
    const bar = '::: chart\nunit: k€\n- Q1 | 980\n- Q2 | 1 150 {.hero}\n- Q3 | 3,5\n:::\n';
    const bh = JMD.render(one(bar), {});
    ok(/<figure class="chart chart--bar"/.test(bh) && (bh.match(/<rect class="chart-bar/g) || []).length === 3 && /chart-bar chart-s1 is-hero/.test(bh) && /chart-bar chart-s1 is-quiet/.test(bh), 'chart: bar by default, one bar per item, the hero forward and the others quiet');
    ok(bh.includes('>1\u00A0150\u00A0k€</text>') && bh.includes('>3.5\u00A0k€</text>') && JMD.render(one(bar, 'fr'), {}).includes('>3,5\u00A0k€</text>'), 'chart: `1 150` and `3,5` read as numbers, drawn with the unit, the thousands spaced, the decimal mark of `lang:` (en . / fr ,)');
    ok(!errs(bar).length && errs(bar.replace('| 980', '| about a thousand'), 'chart-value').length === 1 && errs(bar.replace('- Q3 | 3,5', '- Q3'), 'chart-value').length === 1, 'lint: a clean chart; a value that is not a number, or no value, is `chart-value`');
    const pie = n => '::: chart {.pie}\n' + Array.from({ length: n }, (_, k) => `- P${k} | ${k + 1}`).join('\n') + '\n:::\n';
    ok(!errs(pie(6)).length && errs(pie(7), 'max-items').length === 1 && errs(pie(3).replace('| 2', '| -2'), 'chart-value').length === 1 && errs(pie(3).replace('| 2', '| 2 | 4'), 'chart-series').length === 1, 'lint: a pie holds six slices, positive, one series');
    ok(errs('::: chart\n- a | 1 | 2 | 3 | 4 | 5\n:::\n', 'chart-series').length === 1 && JMD.lint(one('::: chart {.radar}\n- a | 1\n:::\n')).some(f => f.rule === 'chart-type' && f.level === 'warning'), 'lint: five series is `chart-series`; an unknown type is a warning (drawn as bars)');
    const ph = JMD.render(one('::: chart {.donut}\n- A | 30\n- B | 70 {.hero}\n:::\n'), {});
    ok(/chart--pie/.test(ph) && (ph.match(/<path class="chart-slice/g) || []).length === 2 && /class="chart-total"[^>]*>70\u00A0%<\/text>/.test(ph) && /<span class="p">30\u00A0%<\/span>/.test(ph), '`{.donut}` is the pie: one slice per item, the hero\'s share in the hole, each share in the keys');
    const lh = JMD.render(one('::: chart {.line}\nseries: 2025 | 2026\n- Jan | 12 | 14\n- Feb | 13 | 36\n:::\n'), {});
    ok((lh.match(/<polyline class="chart-line/g) || []).length === 2 && /chart-legend[\s\S]*2025[\s\S]*2026/.test(lh) && />40<\/text>/.test(lh) && !/>50<\/text>/.test(lh), 'chart: a line per series, the series named in the legend, the top tick just above the data (40 for 36)');
    ok(/<table class="chart-data">/.test(lh) && /pathLength="1"/.test(lh) && /style="--k:\d+"/.test(lh), 'chart: the numbers are also in the page as text; the line and the dots carry what the motion needs');
    // the diagram: Mermaid's flowchart read by us — shapes, edges, labels, the hero, and what is ignored or refused
    const flow = '::: diagram\nflowchart LR\n  A([Start]) --> B{Choice?}\n  B -->|Yes| C[Do it]:::hero\n  B -- No --> D[(Store)]\n  D -.-> A\n  C ==> E((End))\n  C ~~~ D\n:::\n';
    const fh = JMD.render(one(flow), {});
    ok(/<figure class="diagram diagram--lr"/.test(fh) && (fh.match(/<g class="dg-node/g) || []).length === 5 && /dg-node dg-stadium/.test(fh) && /dg-node dg-diamond/.test(fh) && /dg-node dg-rect is-hero/.test(fh) && /dg-node dg-cylinder/.test(fh) && /dg-node dg-circle/.test(fh), 'diagram: one node per id, its shape from its brackets, `:::hero` forward', fh.slice(0, 300));
    ok((fh.match(/<path class="dg-edge/g) || []).length === 5 && /dg-edge dg-dotted/.test(fh) && /dg-edge dg-thick/.test(fh) && (fh.match(/<g class="dg-label/g) || []).length === 2 && />Yes<\/tspan>/.test(fh) && />No<\/tspan>/.test(fh), 'diagram: solid, dotted, thick; `|label|` and `-- label -->` both read; `~~~` places without drawing');
    const labelBoxes = src => [...JMD.render(one('::: diagram\n' + src + '\n:::\n'), {}).matchAll(/<g class="dg-(label|node)[^"]*"[^>]*><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)].map(m => ({ k: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));
    const onEachOther = bs => bs.some((a, i) => bs.some((b, j) => j > i && (a.k === 'label' || b.k === 'label') && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
    const crowded = ['flowchart LR\n  E[Eudonet] <-->|Synchronisation des comptes adhérents| J[Jamespot]\n  J -->|Inscrits aux événements| E\n  E2[Eudonet] -->|Droits d\'accès aux replays par utilisateur| U[Ubicast]', 'flowchart LR\n  E[Eudonet] <-->|Comptes adhérents / Inscrits aux événements| J[Jamespot]\n  E -->|Droits d\'accès aux replays par utilisateur| U[Ubicast]', 'flowchart TD\n  A[Source] -->|un libellé assez long| B[Cible un]\n  A -->|un autre libellé long| C[Cible deux]\n  A -->|troisième libellé long| D[Cible trois]', 'flowchart TD\n  A -->|aller simple| B\n  B -->|retour simple| A'];
    ok(crowded.every(c => labelBoxes(c).filter(b => b.k === 'label').length >= 2 && !onEachOther(labelBoxes(c))), 'diagram: the labels of two edges between the same boxes, or of a fan out of one box, sit side by side — never on each other nor on a box');
    ok(/<ul class="chart-data"><li>Start → Choice\?<\/li>/.test(fh) && /Choice\? → Do it \(Yes\)/.test(fh), 'diagram: what it says is also in the page as text');
    ok(!errs(flow).length && JMD.render(one('::: diagram\nflowchart TD\n  Q{"Two<br/>lines"} --> A\n:::\n'), {}).includes('>Two</tspan><tspan'), 'lint: a clean flowchart; `<br/>` in a label is a new line');
    ok(errs('::: diagram\npie title P\n  "a" : 1\n:::\n', 'diagram-type')[0]?.message.includes('::: chart {.pie}') && errs('::: diagram\nsequenceDiagram\n  A->>B: hi\n:::\n', 'diagram-type').length === 1 && errs('::: diagram\n:::\n', 'diagram-empty').length === 1, 'lint: another Mermaid family is routed to our block or refused; an empty diagram is `diagram-empty`');
    const styled = JMD.lint(one('::: diagram\n%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B\n  style A fill:#f00\n  classDef x fill:#0f0\n  B:::x\n  click A call alert()\n  A ?? B\n:::\n'));
    ok(styled.some(f => f.rule === 'diagram-style' && f.level === 'warning') && styled.filter(f => f.rule === 'diagram-click' && f.level === 'error').length === 1 && styled.filter(f => f.rule === 'diagram-syntax').length === 1, 'lint: colors in the source are ignored (a warning), `click` is an error, a line we cannot read is `diagram-syntax`');
    const chainOf = n => '::: diagram\nflowchart LR\n  ' + Array.from({ length: n }, (_, k) => 'N' + k).join(' --> ') + '\n:::\n';
    ok(!errs(chainOf(10), 'max-items').length && errs(chainOf(11), 'max-items').length === 1 && errs('::: diagram\nflowchart LR\n  ' + Array.from({ length: 9 }, (_, k) => `N${k}[A label long enough to need two lines ${k}]`).join(' --> ') + '\n:::\n', 'diagram-dense').length === 1, 'lint: ten nodes on a slide, not eleven; a diagram that fits only below 14 px is `diagram-dense`');
    ok(/diagram--td/.test(JMD.render(JMD.parse(H.replace('layout: slide', 'layout: story') + flow), {})), 'diagram: on a Story screen a left-to-right flow reads top-down');
    // the other grammar: a list given a form, the way a SmartArt is — the words are HTML, edited in place, the drawing is ours
    const cyc = '::: diagram {.cycle}\ncenter: One loop\n- Listen | what **customers** say\n- Decide\n- Ship | small {.hero}\n- Measure\n:::\n';
    const ch = JMD.render(one(cyc), {});
    ok(/diagram--cycle/.test(ch) && (ch.match(/<div class="dg-card/g) || []).length === 4 && /dg-card is-hero/.test(ch) && (ch.match(/<path class="dg-edge dg-arc/g) || []).length === 4 && /<strong>customers<\/strong>/.test(ch) && /class="dg-center"[^>]*>One loop</.test(ch) && /<b data-line="\d+" data-col="0">Listen<\/b>/.test(ch), 'cycle: a card per item on a ring, an arrow between each, the center, inline Markdown, the source line for the editor');
    const pyr = JMD.render(one('::: diagram {.pyramid}\n- Top {.hero}\n- Middle\n- Base | what it stands on\n:::\n'), {});
    ok((pyr.match(/<polygon class="dg-band/g) || []).length === 3 && /dg-band is-hero/.test(pyr) && (pyr.match(/<div class="dg-card/g) || []).length === 3, 'pyramid: a band per item, the first on top, its words beside it');
    const mx = JMD.render(one('::: diagram {.matrix}\nx: Low effort | High effort\ny: High value | Low value\n- A\n- B\n- C\n- D\n:::\n'), {});
    ok(/dg-matrix has-y has-x/.test(mx) && (mx.match(/<div class="dg-card/g) || []).length === 4 && />Low effort<\/span><span>High effort</.test(mx), 'matrix: four quadrants, the two axes named');
    ok(!errs(cyc).length && errs(cyc.replace('- Decide\n- Ship | small {.hero}\n', ''), 'max-items').length === 1 && errs('::: diagram {.matrix}\n- A\n- B\n- C\n:::\n', 'max-items').length === 1 && errs('::: diagram {.pyramid}\n' + '- x\n'.repeat(7) + ':::\n', 'max-items').length === 1, 'lint: a cycle holds 3 to 6, a matrix 4, a pyramid 2 to 6');
    ok(errs('::: diagram\n- a\n- b\n:::\n', 'diagram-form').length === 1 && JMD.lint(one('::: diagram {.wheel}\n- a\n:::\n')).length > 0 && JMD.lint(one('::: diagram {.cycle}\nflowchart TD\n- a\n- b\n- c\n:::\n')).some(f => f.rule === 'diagram-form' && f.level === 'warning'), 'lint: a list without a form is `diagram-form`; Mermaid under a form is a warning');
    const tr = '::: diagram {.tree}\n- Ops | COO\n  - Product | CPO\n    - Platform\n    - Mobile {.hero}\n  - Sales\n:::\n';
    const trh = JMD.render(one(tr), {});
    ok((trh.match(/<g class="dg-node/g) || []).length === 5 && (trh.match(/class="dg-node dg-rect dg-root/g) || []).length === 1 && /dg-rect is-hero/.test(trh) && /<tspan class="dg-sub"[^>]*>COO<\/tspan>/.test(trh), 'tree: a box per item, the first unindented one the root, the role under the name, `{.hero}` forward');
    ok((trh.match(/<path class="dg-edge/g) || []).length === 4 && !/dg-head/.test(trh) && /d="M[\d.,]+V[\d.]+H[\d.]+V[\d.]+"/.test(trh) && /<li>Ops — Product<\/li>/.test(trh) && /<li>Product — Mobile<\/li>/.test(trh), 'tree: each item hangs from the last one less indented, by an elbow, no arrowhead; the hierarchy is in the page as text');
    ok(!errs(tr).length && errs('::: diagram {.tree}\n- Alone\n:::\n', 'max-items').length === 1 && errs('::: diagram {.tree}\n- R\n' + '  - c\n'.repeat(10) + ':::\n', 'max-items').length === 1 && errs('::: diagram {.tree}\n- R\n' + Array.from({ length: 9 }, (_, k) => `  - A long name for a team ${k} | with a long role under it`).join('\n') + '\n:::\n', 'diagram-dense').length === 1, 'lint: a tree of 2 to 10 on a slide; nine long boxes on one level are `diagram-dense`');
    // the relation forms: a hub, sets that overlap, rings, a staircase, a funnel; the tree left to right, the matrix's center
    const form = (f, body) => JMD.render(one('::: diagram {.' + f + '}\n' + body + ':::\n'), {});
    const rad = form('radial', 'center: Hub\n- A\n- B {.hero}\n- C\n- D\n');
    ok(/class="dg-hub"[^>]*>Hub</.test(rad) && (rad.match(/<line class="dg-edge dg-spoke/g) || []).length === 4 && !/dg-arc/.test(rad) && (rad.match(/<div class="dg-card/g) || []).length === 4, 'radial: a hub named by `center:`, a spoke to each card, no arrow turning');
    const ven = form('venn', 'center: Both\n- Left\n- Right {.hero}\n');
    ok((ven.match(/<circle class="dg-set/g) || []).length === 2 && /dg-set dg-v2 is-hero/.test(ven) && /dg-center--venn[^>]*>Both</.test(ven) && (form('venn', '- a\n- b\n- c\n').match(/<circle class="dg-set/g) || []).length === 3, 'venn: two or three sets, the shared part named, the hero set fuller');
    const tgt = form('target', '- Core {.hero}\n- Ring\n- Outside\n');
    ok((tgt.match(/<circle class="dg-ring/g) || []).length === 3 && /dg-ring is-hero[^>]*r="[\d.]+"/.test(tgt) && (tgt.match(/<polyline class="dg-leader/g) || []).length === 3, 'target: a ring per item from the core out, each named by a leader');
    const stp = form('steps', '- One\n- Two\n- Three\n- Four {.hero}\n');
    const hs = [...stp.matchAll(/class="dg-card[^"]*" style="--k:\d+;height:(\d+)px/g)].map(m => +m[1]);
    ok(hs.length === 4 && hs.every((h, k) => !k || h > hs[k - 1]) && /dg-card is-deep is-hero/.test(stp), 'steps: each step higher than the one before, the words light on the deep ones');
    const fun = form('funnel', '- Wide\n- Mid\n- Narrow {.hero}\n');
    const widths = [...fun.matchAll(/<polygon class="dg-band[^"]*" style="[^"]*" points="([\d.]+),[\d.]+ ([\d.]+)/g)].map(m => m[2] - m[1]);
    ok(widths.length === 3 && widths[0] > widths[1] && widths[1] > widths[2], 'funnel: the bands narrow from the first item down');
    ok(/diagram--lr/.test(JMD.render(one('::: diagram {.tree .lr}\n- R\n  - a\n  - b\n:::\n'), {})) && /class="dg-grid-center"[^>]*>Pick</.test(form('matrix', 'center: Pick\n- a\n- b\n- c\n- d\n')), '`{.tree .lr}` grows left to right; a matrix names its center');
    ok(errs('::: diagram {.radial}\n- a\n- b\n- c\n:::\n', 'diagram-center').length === 1 && errs('::: diagram {.venn}\n- a\n- b\n- c\n- d\n:::\n', 'max-items').length === 1 && !JMD.lint(one('::: diagram {.tree .lr}\n- R\n  - a\n:::\n')).some(f => f.rule === 'diagram-form'), 'lint: a radial needs its hub; a venn holds two or three; `.lr` is a tree\'s option, not an unknown form');
    const heroOf = l => (JMD.render(one('::: diagram\nflowchart LR\n  ' + l + '\n:::\n'), {}).match(/dg-node dg-(\w+)[^"]*is-hero/) || [])[1];
    ok(heroOf('A[Ship]{.hero} --> B') === 'rect' && heroOf('A{.hero} --> B') === 'rect' && heroOf('A[Ship] {.hero}') === 'rect' && heroOf('A --> B{Go?}{.hero}') === 'diamond', '`{.hero}`, the format\'s own modifier, puts a node forward like `:::hero` — and `A{.hero}` is not a decision');
    ok((JMD.render(one(flow), {}).match(/<g class="dg-step">/g) || []).length === 5, 'a flowchart is one step per node — what an explain slide shows click by click');
    const hostile = JMD.render(one('::: diagram {.cycle .x" onload="alert(1)}\ncenter: <img src=x onerror=alert(2)>\n- <script>alert(3)</script> | [x](javascript:alert(4))\n- "><svg onload=alert(5)> {.hero" onclick="alert(6)}\n- c\n:::\n'), {});
    ok(!/<(script|img)\b|<[^>]*\son\w+\s*=|href="javascript:/i.test(hostile) && hostile.includes('&lt;script&gt;alert(3)&lt;/script&gt;'), 'forms: hostile words are text, a javascript: link becomes #, no attribute is reached', hostile.slice(0, 200));
    // in a real page: the diagrams sample builds clean, an explain slide steps its diagram, a reveal leaves only the hero lit
    execSync('node tools/build.mjs decks/samples/diagrams.jmd', BUILD);
    p = await open('file://' + join(root, 'build/diagrams.james-jmd.html')); await p.settle();
    ok(await p.eval('jamesJmd.state.lint.filter(x => x.level !== "info").length') === 0 && await p.eval('document.querySelectorAll(".diagram").length') === 9, 'diagrams.jmd: nine diagrams, no finding', JSON.stringify(await p.eval('jamesJmd.state.lint.filter(x => x.level !== "info")')));
    await p.eval('jamesJmd.motion("soft"); jamesJmd.show([...document.querySelectorAll(".slide")].findIndex(s => s.classList.contains("slide--explain"))); true'); await p.settle(100);
    const dstep = await p.eval('(() => { const s = document.querySelector(".slide--explain"); return { pending: s.querySelectorAll(".dg-card.is-pending").length, cards: s.querySelectorAll(".dg-card").length }; })()');
    await p.key('ArrowRight'); await p.settle(50);
    const dafter = await p.eval('document.querySelectorAll(".slide--explain .dg-card.is-pending").length');
    ok(dstep.cards === 4 && dstep.pending === 4 && dafter === 3, 'explain: a cycle\'s cards arrive one by one on →', JSON.stringify(dstep) + ' ' + dafter);
    // in the editor a box is drawn, not typed: a press on it opens the slide's source on the box's line
    await p.eval('jamesJmd.motion("none"); jamesJmd.show(1); jamesJmd.edit(); true'); await p.settle(80);
    await p.eval('(() => { const g = [...document.querySelectorAll(".slide.is-active .dg-node")].find(n => n.textContent === "Shipped"); g.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); })(); true'); await p.settle(50);
    const picked = await p.eval('(() => { const t = document.getElementById("edit-src"); return t.value.slice(t.selectionStart, t.selectionEnd); })()');
    ok(picked === 'D ==> F([Shipped]){.hero}' && await p.eval('document.activeElement.id') === 'edit-src', 'editor: a press on a diagram box selects its line in the source', picked);
    await p.close();
    writeFileSync(join(root, 'build/reveal-diagram.jmd'), H.replace('notes: n', 'intent: reveal\nnotes: n') + '::: diagram {.cycle}\n- A\n- B {.hero}\n- C\n:::\n');
    execSync('node tools/build.mjs build/reveal-diagram.jmd', BUILD);
    p = await open('file://' + join(root, 'build/reveal-diagram.james-jmd.html')); await p.settle(1500);
    const rev = await p.eval('(() => { const c = [...document.querySelectorAll(".dg-card")]; return c.map(x => getComputedStyle(x).opacity); })()');
    ok(rev.length === 3 && +rev[1] === 1 && +rev[0] < 0.5 && +rev[2] < 0.5, 'reveal: the hero stays lit, the other cards go quiet (after their motion too)', rev.join(','));
    await p.close();
    // in a real page: the sample builds clean, the chart moves in a presented deck and stands still where motion is off
    execSync('node tools/build.mjs decks/samples/numbers.jmd', BUILD);
    p = await open('file://' + join(root, 'build/numbers.james-jmd.html')); await p.settle();
    ok(await p.eval('jamesJmd.state.lint.filter(x => x.level !== "info").length') === 0 && await p.eval('document.querySelectorAll(".chart .chart-svg").length') === 4 && await p.eval('document.querySelectorAll(".table tbody tr").length') === 3, 'numbers.jmd: four charts and a table, no finding');
    await p.eval('jamesJmd.show(2); true'); await new Promise(r => setTimeout(r, 120));
    ok(await p.eval('getComputedStyle(document.querySelector(".slide.is-active .chart-bar")).animationName') === 'jc-grow-y', 'presented, a bar grows from its axis (jc-grow-y)');
    await p.eval('jamesJmd.show(3); true'); await new Promise(r => setTimeout(r, 120));
    ok(await p.eval('getComputedStyle(document.querySelector(".slide.is-active .chart-line")).animationName') === 'jc-draw', 'presented, a line draws itself (jc-draw)');
    await p.eval('jamesJmd.motion("none"); jamesJmd.show(2); true'); await new Promise(r => setTimeout(r, 60));
    ok(await p.eval('getComputedStyle(document.querySelector(".slide.is-active .chart-bar")).animationName') === 'none', 'motion off: the chart stands still');
    // in place: a table cell is edited where it stands, its row keeps its edge pipes
    await p.eval('jamesJmd.show(1); jamesJmd.edit(); true'); await p.settle(50);
    await p.eval('document.querySelector(".slide.is-active .table tbody tr td").click(); true'); await p.settle(50);
    ok(await p.eval('document.activeElement.classList.contains("is-inline") && document.activeElement.textContent') === 'Starter', 'click on a table cell opens it in place with its source text');
    await p.eval('document.activeElement.textContent = "Solo"; document.activeElement.dispatchEvent(new Event("input", {bubbles: true})); true');
    await new Promise(r => setTimeout(r, 300));
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true'); await p.settle(100);
    const numbersSrc = readFileSync(join(root, 'decks/samples/numbers.jmd'), 'utf8');
    ok(await p.eval('jamesJmd.state.src') === numbersSrc.replace('| Starter | 1 240 |', '| Solo | 1 240 |'), 'Enter commits: that cell of that row changed, the edge pipes where they were, nothing else moved');
    await p.close();
    // the other layouts: the same source lints clean as a Story and as a Doc
    for (const lay of ['story', 'doc']) {
      const f = join(tmp, `numbers-${lay}.jmd`); writeFileSync(f, numbersSrc.replace('layout: slide', 'layout: ' + lay));
      const r = cli(`lint ${f} --dom --json`, false); const js = JSON.parse(typeof r === 'string' ? r : r.out);
      ok(js.ok === true && js.findings.every(x => x.level !== 'warning'), `numbers.jmd as a ${lay}: no error, no fit`, JSON.stringify(js.findings));
    }
  }

  console.log('\n7b. Case: what the format names is read in lowercase');
  {
    const mixed = '---\nFORMAT: JMD/1\nLayout: Doc\nTitle: Case Does Not Matter\nBrand: Jamespot-Basic\n---\n\n---\nIntent: Hook\nSection: Mixed Case\nNotes: Notes Keep Their Case.\n---\n## A Title\nLead.\n\n::: Metrics\n- 1 | one | first {.Hero}\n- 2 | two | second\n:::\n\n---\nBG: Lavender\nnotes: n\n---\n::: Statement\nCase is not a rule.\n:::\n';
    const d = JMD.parse(mixed), s1 = d.slides[0];
    ok(d.meta.format === 'jmd/1' && d.meta.layout === 'doc' && d.meta.brand === 'jamespot-basic' && d.meta.title === 'Case Does Not Matter', 'header: keys and enumerated values lowercased, the title kept');
    ok(s1.meta.intent === 'hook' && s1.meta.section === 'Mixed Case' && s1.meta.notes === 'Notes Keep Their Case.' && d.slides[1].meta.bg === 'lavender', 'slide keys: intent and bg lowercased, section and notes kept');
    ok(s1.nodes.filter(n => n.type === 'block').map(n => n.name).join() === 'metrics' && JMD.lint(d).every(f => f.level !== 'error'), '`::: Metrics` is the metrics block; the deck lints clean');
    ok(/metric--hero/.test(JMD.render(d, { brand: {} })) && JMD.layout(d) === 'doc', '`{.Hero}` is the hero modifier; the layout is doc');
    const { loadBrand, deckBrand } = await import('./build.mjs');
    ok(deckBrand(mixed) === 'jamespot-basic' && loadBrand('PLUM').id === 'plum' && loadBrand('MoNo').id === 'mono', 'a brand id is case-insensitive, in the header and as an argument')
    if (HOUSE) ok(loadBrand('Jamespot-2026').id === 'jamespot' && loadBrand('JAMESPOT-BASIC').id === 'jamespot', 'the two merged looks still resolve, whatever the case');
    ok(deckBrand('---\nformat: jmd/1\nbrand: https://Example.com/Brand.yaml\n---\n') === 'https://Example.com/Brand.yaml', 'a brand URL keeps its case');
    const bad = JMD.lint(JMD.parse(mixed.replace('Layout: Doc', 'Layout: Poster')));
    ok(bad.some(f => f.rule === 'layout'), 'an unknown value is still an error, whatever its case');
  }

  console.log('\n8. Slide editor (V2): edit the slide source, nothing else moves');
  {
    const tour = readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8');
    p = await open('file://' + join(root, 'build/product-tour.james-jmd.html')); await p.settle();
    ok(await p.eval('jamesJmd.state.src') === tour, 'embedded source is byte-identical to the file');
    await p.key('ArrowRight'); await p.key('ArrowRight'); await p.key('E'); await p.settle(100);
    ok(await p.eval('document.getElementById("edit").classList.contains("is-open")') && (await p.eval('document.getElementById("edit-title").textContent')).startsWith('Slide 03'), 'E opens the editor on the current slide');
    ok((await p.eval('document.getElementById("edit-src").value')).startsWith('---\nintent: problem'), 'the textarea holds the slide own lines, frontmatter included');
    // the E keystroke that opened the panel must not be typed into it (keydown → keypress → input)
    await p.eval('document.dispatchEvent(new KeyboardEvent("keypress", { key: "e", bubbles: true })); true');
    await p.settle(50);
    ok(!(await p.eval('document.getElementById("edit-src").value')).startsWith('e') && await p.eval('jamesJmd.state.dirty') === false, 'the E that opens the editor is not typed into it');
    await p.eval('jamesJmd.applyEdit(); true');
    ok(await p.eval('jamesJmd.state.src') === tour, 'open, touch nothing, apply → source byte-identical');
    await p.eval('(() => { const t = document.getElementById("edit-src"); t.value = t.value.replace("Incidents don\'t wait", "Outages never wait"); t.dispatchEvent(new Event("input")); })(); true');
    await new Promise(r => setTimeout(r, 400)); await p.settle();
    const edited = await p.eval('jamesJmd.state.src');
    ok(edited.replace('Outages never wait', "Incidents don't wait") === tour, 'a word changed on slide 3 changes exactly that word in the source');
    ok((await p.eval('document.querySelector(".slide.is-active .slide-h2").textContent')) === 'Outages never wait for office hours' && await p.eval('jamesJmd.state.i') === 2, 'the slide re-renders live and stays current');
    ok(await p.eval('jamesJmd.state.dirty') === true && await p.eval('document.getElementById("edit").classList.contains("is-dirty")'), 'the editor marks the deck dirty');
    await p.eval('(() => { const t = document.getElementById("edit-src"); t.value = t.value.replace("::: cards {.right}", "::: foo"); t.dispatchEvent(new Event("input")); })(); true');
    await new Promise(r => setTimeout(r, 500)); await p.settle();
    ok(await p.eval('document.getElementById("edit-status").textContent') === '1 error' && !(await p.eval('document.getElementById("edit-lint").classList.contains("is-open")')), 'a structural mistake: the slide\'s light turns red, the list stays folded');
    await p.eval('{ const t = document.getElementById("edit-src"); t.selectionStart = t.selectionEnd = t.value.indexOf("::: foo") + 8; t.dispatchEvent(new Event("click")); } true');
    ok((await p.eval('document.getElementById("edit-ctx").textContent')).includes('not in the vocabulary') && await p.eval('document.getElementById("edit-ctx").classList.contains("is-err")'), 'with the caret in the bad block, the hint line carries the linter\'s message');
    await p.eval('document.getElementById("edit-status").click(); true');
    ok(await p.eval('document.getElementById("edit-lint").classList.contains("is-open")') && (await p.eval('document.getElementById("edit-lint").textContent')).includes('foo'), 'clicking the light unfolds the details');
    await p.eval('(() => { const t = document.getElementById("edit-src"); t.value = t.value.replace("::: foo", "::: cards {.right}"); t.dispatchEvent(new Event("input")); })(); true');
    await new Promise(r => setTimeout(r, 500)); await p.settle();
    ok((await p.eval('document.getElementById("edit-lint").textContent')).includes('is clean'), 'fixing it clears the panel');
    // ⌘S saves the .jmd (download path when the picker is not available)
    await p.eval('window.showSaveFilePicker = undefined; URL.createObjectURL = b => { window.__blob = b; return "blob:x"; }; HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; }; true');
    await p.eval('document.getElementById("edit-src").dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true })); true');
    await new Promise(r => setTimeout(r, 200));
    ok(await p.eval('window.__dl') === 'product-tour.jmd' && (await p.eval('window.__blob.text()')).includes('Outages never wait'), '⌘S saves the edited .jmd');
    ok(await p.eval('jamesJmd.state.dirty') === false, 'saving clears the dirty flag');
    await p.key('Escape'); await p.settle(50);
    ok(!(await p.eval('document.getElementById("edit").classList.contains("is-open")')), 'Esc closes the editor');
    await p.close();

    // in place: click a text in the slide, edit its source, it is written back to its line (and column)
    p = await open('file://' + EMPTY); await p.settle();
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed)}, "four-blocks.jmd"); true`); await p.settle();
    await p.key('ArrowRight'); // slide 2: metrics
    await p.eval('jamesJmd.edit(); true'); await p.settle(50);
    await p.eval('document.querySelector(".slide.is-active .metric--hero .v").click(); true'); await p.settle(50);
    ok(await p.eval('document.activeElement.classList.contains("is-inline") && document.activeElement.textContent') === '250,000', 'click on a metric value opens it in place with its source text');
    await p.eval('document.activeElement.textContent = "300,000"; document.activeElement.dispatchEvent(new Event("input", {bubbles: true})); true');
    await new Promise(r => setTimeout(r, 300));
    ok((await p.eval('document.getElementById("edit-src").value')).includes('- 300,000 | users |'), 'the panel follows the in-place edit, column-aware');
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true'); await p.settle(100);
    const s2 = await p.eval('jamesJmd.state.src');
    ok(s2.replace('- 300,000 | users |', '- 250,000 | users |') === fixed, 'Enter commits: exactly that column of that line changed');
    ok(await p.eval('document.querySelector(".slide.is-active .metric--hero .v").textContent') === '300,000' && await p.eval('jamesJmd.state.i') === 1, 're-rendered, still on the slide');
    await p.eval('document.querySelector(".slide.is-active .slide-h2").click(); true'); await p.settle(50);
    ok(await p.eval('document.activeElement.textContent') === 'Northwind in three numbers.', 'click on the title opens the title line');
    await p.eval('document.activeElement.textContent = "Broken"; document.activeElement.dispatchEvent(new Event("input", {bubbles: true})); true');
    await new Promise(r => setTimeout(r, 300));
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true'); await p.settle(100);
    ok(await p.eval('jamesJmd.state.src') === s2 && await p.eval('document.querySelector(".slide.is-active .slide-h2").textContent') === 'Northwind in three numbers.', 'Escape discards the in-place edit');
    await p.eval('document.querySelector(".slide.is-active .card, .slide.is-active .metric .s").click(); true'); await p.settle(50);
    ok(await p.eval('document.activeElement.dataset.col') === '2', 'the comment column of a metric maps to column 2');
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true'); await p.settle(50);
    // a real mouse: the caret lands where the pointer is, mapped into the source (marks skipped); a double-click selects a word
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed.replace('The hard early years.', 'The **hard** early years.'))}, "four-blocks.jmd"); jamesJmd.state.editing || jamesJmd.edit(); true`); await p.settle(50);
    await p.key('Home'); await p.settle(50); // slide 1: timeline, item 2 rendered "The hard early years. It takes time to find a market."
    const box = await p.eval('(() => { const el = document.querySelector(".slide.is-active .tl-step:nth-child(2) p"); const rendered = el.textContent; const tn = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; while (tn.nextNode()) nodes.push(tn.currentNode); const last = nodes[nodes.length - 1]; const r2 = document.createRange(); r2.setStart(last, last.length - 5); r2.setEnd(last, last.length - 4); const b = r2.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, rendered }; })()');
    await p.mouse(box.x, box.y); await p.settle(50);
    const car = await p.eval('(() => { const s = window.getSelection(); return { text: document.activeElement.textContent, inline: document.activeElement.classList.contains("is-inline"), at: s.anchorOffset, collapsed: s.isCollapsed }; })()');
    ok(car.inline && car.text.includes('**') && car.collapsed && car.text.slice(car.at, car.at + 5) === box.rendered.slice(-5), 'a real click opens the text with the caret under the pointer, offset by the markdown marks (' + JSON.stringify(car.text.slice(car.at, car.at + 5)) + ')');
    await p.mouse(box.x, box.y, 2); await p.settle(50);
    const dbl = await p.eval('(() => { const s = window.getSelection(); return { still: !!window.jamesJmd.state && document.activeElement.classList.contains("is-inline"), sel: s.toString() }; })()');
    if (HOUSE) ok(dbl.still && /^\S+\s?$/.test(dbl.sel) && dbl.sel.length > 1, 'a double-click on the open text selects a word, and keeps it open (' + JSON.stringify(dbl.sel) + ')');
    await p.eval('document.execCommand("insertText", false, "MARKET"); true'); await new Promise(r => setTimeout(r, 300)); // type over the selection
    const h2 = await p.eval('(() => { const b = document.querySelector(".slide.is-active .slide-h2").getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()');
    await p.mouse(h2.x, h2.y); await p.settle(100);
    if (HOUSE) ok((await p.eval('jamesJmd.state.src')).includes('find a MARKET.') && await p.eval('document.activeElement.classList.contains("is-inline") && document.activeElement.classList.contains("slide-h2")'), 'clicking another text commits the first and opens the second, on the re-rendered slide');
    ok(await p.eval('window.getSelection().anchorOffset') <= 4, 'its caret is near the start, where the pointer was');
    // the slide never runs under the panel (its right edge, where .right images live, was hidden on a 1440px screen)
    for (const w of [1440, 756]) {
      await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.round(w * 0.625), deviceScaleFactor: 1, mobile: false }); await p.settle(50);
      const g = await p.eval('(() => { const s = document.querySelector(".slide.is-active").getBoundingClientRect(); return { right: s.right, left: s.left, free: innerWidth - 480 }; })()');
      ok(g.right <= g.free + 1 && Math.abs(g.left - (g.free - (g.right - g.left))) < 2, 'editing at ' + w + 'px: the slide sits centered in the free area, none of it under the panel');
    }
    await p.eval('jamesJmd.edit(); true'); await p.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false }); await p.settle(50);
    const g2 = await p.eval('(() => { const s = document.querySelector(".slide.is-active").getBoundingClientRect(); return { left: s.left, right: s.right, iw: innerWidth }; })()');
    ok(Math.abs(g2.left) < 1 && Math.abs(g2.right - g2.iw) < 1, 'presenting in a 1024px window: the slide fills it edge to edge, nothing cut');
    await p.eval('jamesJmd.edit(); true');
    await p.send('Emulation.clearDeviceMetricsOverride'); await p.settle(50);
    // off a text (an image, a block background): no native selection runs into the panel, the open text is committed
    await p.eval('jamesJmd.load(' + JSON.stringify(readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8')) + ', "product-tour.jmd"); jamesJmd.state.editing || jamesJmd.edit(); jamesJmd.show(5); true'); await p.settle(100);
    const img = await p.eval('(() => { const b = document.querySelector(".slide.is-active .split-media").getBoundingClientRect(); const t = document.querySelector(".slide.is-active .slide-h2").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, tx: t.left + 5, ty: t.top + 5 }; })()');
    await p.mouse(img.tx, img.ty); await p.settle(50);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: img.x, y: img.y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: img.tx, y: img.ty, button: 'left' });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: img.tx, y: img.ty, button: 'left', clickCount: 1 }); await p.settle(100);
    const off = await p.eval('(() => ({ sel: window.getSelection().toString(), active: document.activeElement.id || document.activeElement.tagName, open: !!document.querySelector(".is-inline") }))()');
    ok(off.sel === '' && off.active !== 'edit-src' && !off.open, 'a press off a text selects nothing, leaves the panel alone and commits the open text (' + JSON.stringify(off) + ')');
    // a click on an image (or a logo, a block background) must never open the slide itself as a text (it used to carry data-line and showed '---')
    await p.eval('jamesJmd.show(5); true'); await p.settle(50);
    const im = await p.eval('(() => { const b = document.querySelector(".slide.is-active .split-media").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()');
    await p.mouse(im.x, im.y); await p.settle(100);
    ok(!(await p.eval('document.querySelector(".slide.is-active").hasAttribute("contenteditable")')) && await p.eval('document.activeElement.tagName') !== 'SECTION' && !(await p.eval('document.querySelector(".slide.is-active").textContent.trim() === "---"')), 'a click on an image never turns the slide into an editable field');
    ok(await p.eval('document.querySelectorAll("[data-line]").length') > 0 && await p.eval('document.querySelectorAll("section.slide[data-line]").length') === 0, 'only text pieces carry data-line, never a slide');

    /* **The first slide of a deck whose body follows the front matter directly** (2026-09-27, found on a live deck). Every
       sample here opens its first slide with a `---`, and every in-place test above is on slide 2 or later — so the one
       shape that was broken was the one nothing drove: with no `---` to open it, that slide got no `bodyStart`, the base of
       every node's map fell back to 0, and its title claimed **line 0 of the document**. Clicking it and typing rewrote the
       front matter's own `---`: the title on screen did not move, the deck lost its header, and the mangled source was
       saved. It is read here at three levels — the map, the `data-line` in the markup, and the click — because the first
       is the cause, the second is what the editor reads, and the third is what a person does. */
    const bare = '---\nformat: jmd/1\ntitle: Held\n---\n# First title\nA lead line.\n\n---\n# Second\nMore.\n';
    const head = JMD.parse(bare).slides[0].nodes.find(n => n.type === 'title');
    ok(head.map[0] === 4 && JMD.parse(bare).slides[1].nodes.find(n => n.type === 'title').map[0] === 8,
      'a title on a first slide the front matter opens is counted from the document, not from the slide', String(head.map[0]));
    await p.eval('jamesJmd.load(' + JSON.stringify(bare) + ', "bare.jmd"); true'); await p.settle();
    await p.eval('jamesJmd.state.editing || jamesJmd.edit(); jamesJmd.show(0); true'); await p.settle(100); // 0-based: the first slide, the one that was broken
    ok(await p.eval('document.querySelector(".slide.is-active h1").dataset.line') === '4', 'and the markup says so: the editor writes back to the line the text came from', await p.eval('document.querySelector(".slide.is-active h1").dataset.line'));
    await p.eval('document.querySelector(".slide.is-active h1").click(); true'); await p.settle(50);
    await p.eval('document.activeElement.textContent = "Renamed"; document.activeElement.dispatchEvent(new Event("input", {bubbles: true})); true');
    await new Promise(r => setTimeout(r, 300));
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true'); await p.settle(100);
    const renamed = await p.eval('jamesJmd.state.src');
    ok(renamed === bare.replace('# First title', '# Renamed') && renamed.startsWith('---\nformat: jmd/1'),
      'clicking that title changes that title — and the front matter is still where it was', JSON.stringify(renamed.split('\n').slice(0, 6)));
    // help: the palette of shapes, the caret hint, the bg chip
    await p.eval('jamesJmd.load(' + JSON.stringify(fixed) + ', "four-blocks.jmd"); jamesJmd.state.editing || jamesJmd.edit(); jamesJmd.show(1); true'); await p.settle(100);
    const chips = await p.eval('Array.from(document.querySelectorAll("#edit-chips button")).map(b => b.textContent)');
    ok(chips.length === JMD.SHAPES.length + 1 && chips.includes('cards') && chips.includes('logos') && chips[chips.length - 1] === 'bg: white ▸', 'the panel shows a chip per shape plus the slide background (' + chips.length + ')');
    await p.eval('{ const t = document.getElementById("edit-src"); t.focus(); t.selectionStart = t.selectionEnd = 1; t.dispatchEvent(new Event("click")); } true');
    ok((await p.eval('document.getElementById("edit-ctx").textContent')).includes('bg: white'), 'caret in the frontmatter: the hint lists the backgrounds and keys');
    await p.eval('{ const t = document.getElementById("edit-src"); t.selectionStart = t.selectionEnd = t.value.indexOf("- 200+") + 3; t.dispatchEvent(new Event("click")); } true');
    ok((await p.eval('document.getElementById("edit-ctx").textContent')).startsWith('metrics '), 'caret inside ::: metrics: the hint is the metrics rule');
    await p.eval('{ const t = document.getElementById("edit-src"); t.selectionStart = t.selectionEnd = t.value.length; t.dispatchEvent(new Event("click")); document.querySelector("#edit-chips button[data-shape=pills]").click(); } true');
    await new Promise(r => setTimeout(r, 400)); await p.settle();
    ok((await p.eval('document.getElementById("edit-src").value')).includes('\n\n::: pills\n- One\n') && await p.eval('document.querySelectorAll(".slide.is-active .slide-pill").length') === 3, 'the pills chip inserts a valid block at the caret, on its own lines, rendered live');
    ok((await p.eval('document.getElementById("edit-lint").textContent')).includes('is clean') && await p.eval('document.activeElement.id') === 'edit-src', 'the inserted snippet lints clean and the caret stays in the textarea');
    await p.eval('document.querySelector("#edit-chips button.bg").click(); true'); await new Promise(r => setTimeout(r, 400)); await p.settle();
    ok((await p.eval('document.getElementById("edit-src").value')).startsWith('---\nbg: indigo\n') && await p.eval('document.querySelector(".slide.is-active").classList.contains("slide--indigo")') && await p.eval('document.querySelector("#edit-chips button.bg").textContent') === 'bg: indigo ▸', 'the bg chip cycles the slide background, live');
    // overflow shows on the slide itself, as a dashed line at the limit, in edit mode only
    await p.eval('jamesJmd.load(' + JSON.stringify(src) + ', "over.jmd"); jamesJmd.show(3); true'); await p.settle(300);
    const over = await p.eval('(() => { const s = document.querySelector(".slide.is-active"); const cs = getComputedStyle(s, "::after"); return { cls: s.classList.contains("is-over"), line: cs.borderTopStyle, top: cs.top, lint: jamesJmd.state.lint.filter(x => x.rule === "overflow").length }; })()');
    ok(over.lint > 0 && over.cls && over.line === 'dashed' && over.top === '660px', 'an overflowing slide draws a dashed line at 660px in edit mode (' + JSON.stringify(over) + ')');
    // decoration the theme applies on its own: the brand's watermark and card markers
    await p.eval('jamesJmd.load(' + JSON.stringify(readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8')) + ', "product-tour.jmd"); true'); await p.settle(100);
    const deco = await p.eval('(() => { const wms = Array.from(document.querySelectorAll(".slide .wm")).map(w => w.className + " " + (w.querySelector("use") || {}).getAttribute("href")); const split = document.querySelector(".slide--split .wm"); const glyphs = Array.from(document.querySelectorAll(".card .num--glyph use")).map(u => u.getAttribute("href")); const vivid = document.querySelectorAll(".card--vivid").length; const offset = document.querySelectorAll(".cards--offset").length; const wmOpacity = getComputedStyle(document.querySelector(".slide:not(.slide--intent):not(.slide--indigo):not(.slide--accent):not(.slide--sky) .wm--mark .wm-g")).opacity; return { wms, split: !!split, glyphs, vivid, offset, wmOpacity, marks: document.querySelectorAll("symbol[id^=brand-glyph-]").length }; })()');
    ok(deco.wms.length > 3 && deco.wms.every(c => c.includes('brand-glyph-1')) && deco.wms.some(c => c.includes('wm--a')) && deco.wms.some(c => c.includes('wm--b')), 'content slides carry the watermark: one glyph for the whole deck, side alternating (' + deco.wms.length + ')');
    ok(+deco.wmOpacity <= 0.04, 'the watermark is faint on a neutral slide (opacity ' + deco.wmOpacity + ')');
    // the glyph that travels: the intent poses it (engine.css), a measure places it where the pose hangs on the page (act),
    // the presenter flies it from one pose to the next, and on explain walks it under each step — motion only
    await p.eval('jamesJmd.load(' + JSON.stringify(readFileSync(join(root, 'decks/samples/team-update.jmd'), 'utf8')) + ', "team-update.jmd"); true'); await p.settle(400);
    const pose = await p.eval('(() => { const s = jamesJmd.state.slides, at = i => { const g = s[i].querySelector(".wm-g"), c = g && getComputedStyle(g); return c && { x: parseFloat(c.left), y: parseFloat(c.top), w: parseFloat(c.width), o: +c.opacity }; }; const idx = n => s.findIndex(x => x.dataset.intent === n); const act = s[idx("act")], cta = act.querySelector("a.cta").getBoundingClientRect(), r0 = act.getBoundingClientRect(), k = r0.width / 1280; return { hook: at(idx("hook")), prove: at(idx("prove")), act: at(idx("act")), ctaRight: (cta.right - r0.left) / k, ctaMid: (cta.top + cta.height / 2 - r0.top) / k }; })()');
    ok(Math.abs(pose.hook.x - 640) < 2 && pose.hook.w > 800, 'hook: the glyph is huge, centred behind the words (' + JSON.stringify(pose.hook) + ')');
    ok(pose.prove.w <= 40 && pose.prove.o === 1, 'prove: the glyph is a small full stamp (' + JSON.stringify(pose.prove) + ')');
    ok(pose.act.x > pose.ctaRight && pose.act.x - pose.ctaRight < 120 && Math.abs(pose.act.y - pose.ctaMid) < 2, 'act: the glyph is measured beside the button (' + JSON.stringify(pose.act) + ', button ends at ' + Math.round(pose.ctaRight) + ')');
    const wasEditing = await p.eval('(() => { const e = jamesJmd.state.editing; if (e) jamesJmd.edit(); return e; })()'); await p.settle(100);
    const flight = await p.eval('(() => { const s = jamesJmd.state.slides, h = s.findIndex(x => x.dataset.intent === "hook"); jamesJmd.motion("soft"); jamesJmd.show(h); jamesJmd.show(h + 1); const soft = s[h + 1].querySelector(".wm-g").getAnimations().length; jamesJmd.motion("none"); jamesJmd.show(h); jamesJmd.show(h + 1); const none = s[h + 1].querySelector(".wm-g").getAnimations().length; return { soft, none }; })()');
    ok(flight.soft === 1 && flight.none === 0, 'presenting, the glyph flies from one pose to the next — never with motion none (' + JSON.stringify(flight) + ')');
    const walk = await p.eval('(() => { const s = jamesJmd.state.slides, e = s.findIndex(x => x.dataset.intent === "explain"), g = s[e].querySelector(".wm-g"); jamesJmd.motion("soft"); jamesJmd.show(e); const x0 = g.style.getPropertyValue("--gx"); jamesJmd.next(); const x1 = g.style.getPropertyValue("--gx"); jamesJmd.next(); const x2 = g.style.getPropertyValue("--gx"); jamesJmd.prev(); jamesJmd.prev(); const back = g.style.getPropertyValue("--gx"); return { x0, x1, x2, back }; })()');
    await p.eval('(() => { jamesJmd.state.motion = null; ' + (wasEditing ? 'jamesJmd.edit(); ' : '') + 'return true; })()'); await p.settle(100); // the suite goes on as it was
    // the QR code a shared deck carries (mcp/qr.mjs): what the server draws must scan back to the link, at every length a
    // read link can have and well past it (versions 1 to 9), read by the browser's own detector where it has one
    // the QR code is drawn by the service, which the public tree does not ship (PUBLIC.md): asserted where mcp/ is
    const { qrSvg } = existsSync(join(root, 'mcp/qr.mjs')) ? await import('../mcp/qr.mjs') : {};
    if (!qrSvg) console.log('  · no mcp/ in this tree: the QR code the service draws is not scanned back here');
    else {
    const qrTexts = ['https://slides.jamespot.io/deck/S_vQ3uZK5U4RLw2N', 'x', 'https://example.org/deck/' + 'a'.repeat(16) + '?n=' + 'é'.repeat(30), 'https://example.com/' + 'b'.repeat(150)];
    const scanned = await p.eval('(async () => { if (!("BarcodeDetector" in window)) return null; const d = new BarcodeDetector({ formats: ["qr_code"] }), out = []; for (const svg of ' + JSON.stringify(qrTexts.map(t => qrSvg(t))) + ') { const img = new Image(); img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg.replace("currentColor", "#000")))); await img.decode(); const c = document.createElement("canvas"); c.width = c.height = 400; c.getContext("2d").drawImage(img, 0, 0, 400, 400); out.push(((await d.detect(c))[0] || {}).rawValue || ""); } return out; })()');
    if (scanned) ok(JSON.stringify(scanned) === JSON.stringify(qrTexts), 'the QR code scans back to its link, from 1 byte to 170 (' + scanned.map(x => x.length).join(', ') + ')');
    else console.log('  · no BarcodeDetector in this Chrome: the QR code is not scanned back here');
    }
    // Q shows the code where the page has one (a shared deck), and does nothing on a file that has none
    const q = await p.eval('(() => { const key = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" })); key(); const none = !document.getElementById("qr"); const d = document.createElement("div"); d.id = "qr"; document.body.appendChild(d); key(); const open = d.classList.contains("is-open"); key(); const shut = !d.classList.contains("is-open"); d.remove(); return { none, open, shut }; })()');
    ok(q.none && q.open && q.shut, 'Q opens and closes the QR code of a shared deck, and is nothing on a file that has none (' + JSON.stringify(q) + ')');
    // a phone held upright: the Slide deck is drawn as a Story, one screen at a time; turned sideways, the slides again
    const phone = await browser.page('file://' + join(root, 'build/james-jmd.html'), { network: false });
    await phone.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await phone.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await phone.eval('location.reload(); true'); await phone.settle(600);
    await phone.eval('jamesJmd.load(' + JSON.stringify(readFileSync(join(root, 'decks/samples/team-update.jmd'), 'utf8')) + ', "team-update.jmd"); true'); await phone.settle(300);
    const upright = JSON.parse(await phone.eval('JSON.stringify({ layout: jamesJmd.state.layout, reflowed: jamesJmd.state.reflowed, src: /layout: slide/.test(jamesJmd.state.src), story: document.body.classList.contains("layout-story") })'));
    await phone.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    await phone.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 410 }] });
    await phone.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await phone.settle(200);
    const swipedTo = await phone.eval('jamesJmd.state.i');
    const bar = JSON.parse(await phone.eval('JSON.stringify({ shown: getComputedStyle(document.getElementById("progress")).display, n: document.querySelectorAll("#progress button").length, done: document.querySelectorAll("#progress .is-done").length })'));
    await phone.eval('document.querySelectorAll("#progress button")[6].click(); true'); const jumped = await phone.eval('jamesJmd.state.i');
    await phone.eval('jamesJmd.show(1); true');
    ok(bar.shown === 'flex' && bar.n === 10 && bar.done === 2 && jumped === 6, 'on a touch screen, the story bar: one segment a screen, the seen ones filled, a tap goes there (' + JSON.stringify(bar) + ', tapped 7 → ' + (jumped + 1) + ')');
    // the bar takes the colour of what is under it: the dark band of a tall phone, or the screen itself on a 9:16 one
    const tint = async i => { await phone.eval('jamesJmd.show(' + i + '); true'); await phone.settle(100); return phone.eval('document.getElementById("progress").classList.contains("is-light")'); };
    const inBand = await tint(2);
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 693, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } }); await phone.settle(300);
    const onWhite = await tint(2), onDark = await tint(1);
    ok(!inBand && onWhite && !onDark, 'the story bar stays readable: white in the dark band, ink over a white screen, white over a dark one (' + [inBand, onWhite, onDark].join(' ') + ')');
    await phone.eval('jamesJmd.show(1); true');
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } }); await phone.settle(500);
    const sideways = JSON.parse(await phone.eval('JSON.stringify({ layout: jamesJmd.state.layout, i: jamesJmd.state.i })'));
    phone.close && phone.close();
    ok(upright.layout === 'story' && upright.reflowed && upright.src && upright.story, 'a phone held upright reads a Slide deck as a Story — the source still says slide (' + JSON.stringify(upright) + ')');
    ok(swipedTo === 1, 'a swipe turns the page (' + swipedTo + ')');
    ok(sideways.layout === 'slide' && sideways.i === 1, 'turned sideways, the slides again, on the same screen (' + JSON.stringify(sideways) + ')');
    ok(walk.x0 === '' && walk.x1 && walk.x2 && walk.x2 !== walk.x1 && walk.back === '', 'explain: the glyph walks to each step as it arrives, and back to its corner (' + JSON.stringify(walk) + ')');
    ok(!deco.split, 'a split slide (already decorated) has no watermark');
    ok(deco.marks === 4 && [...new Set(deco.glyphs)].length >= 3 && deco.glyphs[0] === '#brand-glyph-1' && deco.glyphs[1] === '#brand-glyph-2', 'cards take one shape of the family each, rotating (' + [...new Set(deco.glyphs)].join(' ') + ')');
    const look2026 = JMD.render(JMD.parse(readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8')), { brand: { glyphs: 4, 'card-fill': 'alternate', 'card-shadow': 'offset' } });
    ok((look2026.match(/card--vivid/g) || []).length >= 3 && look2026.includes('cards--offset') && !/card--vivid[^>]*>(?:(?!<\/div>)[\s\S])*?<ul>/.test(look2026), 'the 2026 look: one-line cards alternate the vivid fill (never a bullet card), blocks carry the offset shadow');
    const tourSrc = readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8');
    const alt = JMD.render(JMD.parse(tourSrc), { brand: { name: 'X', watermark: 'none', 'card-marker': 'letter' } });
    ok(!alt.includes('class="wm') && alt.includes('num num--letter">P<') && !alt.includes('num--glyph'), 'brand watermark: none and card-marker: letter are honored');
    const icons = JMD.render(JMD.parse(tourSrc), { brand: { 'card-marker': 'icon' } });
    ok(icons.includes('data-icon="shield"') && icons.includes('data-icon="award"'), 'card-marker: icon picks a line icon from the title (Security → shield, Certification → award)');
    const plain = JMD.render(JMD.parse(tourSrc), { brand: {} });
    ok(plain.includes('<div class="num">01</div>') && plain.includes('#brand-mark"') && !plain.includes('card--vivid') && !plain.includes('cards--offset'), 'without glyphs the marker falls back to the mark; {.numbered} still numbers; no vivid/offset unless the brand says so');
    // motion: one global mode, brand default, M cycles, step reveals items one by one, print and render never animate
    await p.eval('localStorage.removeItem("james-jmd.motion"); jamesJmd.load(' + JSON.stringify(readFileSync(join(root, 'decks/samples/product-tour.jmd'), 'utf8')) + ', "product-tour.jmd"); jamesJmd.state.editing && jamesJmd.edit(); jamesJmd.show(3); true'); await p.settle(100);
    ok(await p.eval('jamesJmd.state.motion') === 'soft' && await p.eval('document.body.classList.contains("motion-soft")'), 'the deck opens in the brand\'s motion mode (soft)');
    ok((await p.eval('getComputedStyle(document.querySelector(".slide.is-active .card")).animationName')) === 'jp-rise' && (await p.eval('getComputedStyle(document.querySelector(".slide.is-active .card:nth-child(3)")).animationDelay')) === '0.24s', 'soft: the cards rise in cascade (third card 240 ms after the first)');
    await p.key('M'); await p.key('M'); await p.settle(50);
    ok(await p.eval('jamesJmd.state.motion') === 'zoom' && await p.eval('localStorage.getItem("james-jmd.motion")') === 'zoom', 'M cycles the mode and remembers it in this browser');
    await p.key('M'); await p.settle(50);
    ok(await p.eval('jamesJmd.state.motion') === 'step' && await p.eval('document.querySelectorAll(".slide.is-active .is-pending").length') === 3, 'step: the three cards of the slide wait');
    await p.key('ArrowRight'); await p.settle(30);
    ok(await p.eval('jamesJmd.state.i') === 3 && await p.eval('document.querySelectorAll(".slide.is-active .is-shown").length') === 1, '→ reveals the first card, the slide does not change');
    await p.key('ArrowRight'); await p.key('ArrowRight'); await p.key('ArrowRight'); await p.settle(30);
    ok(await p.eval('jamesJmd.state.i') === 4, 'once every item is shown, → goes to the next slide');
    await p.key('ArrowLeft'); await p.settle(30);
    ok(await p.eval('jamesJmd.state.i') === 3 && await p.eval('document.querySelectorAll(".slide.is-active .is-pending").length') === 3, '← comes back to the previous slide, its items waiting again');
    await p.key('M'); await p.settle(50);
    ok(await p.eval('jamesJmd.state.motion') === 'none' && await p.eval('document.querySelectorAll(".is-pending").length') === 0 && (await p.eval('getComputedStyle(document.querySelector(".slide.is-active .card")).animationName')) === 'none', 'none: nothing waits, nothing animates');
    await p.eval('localStorage.removeItem("james-jmd.motion"); jamesJmd.motion("soft"); true');
    // help on demand; card shapes start one further on each block
    await p.key('?'); ok(await p.eval('document.getElementById("help").classList.contains("is-open")') && (await p.eval('document.getElementById("help").textContent')).includes('motion'), '? opens the keys help');
    await p.key('Escape'); ok(!(await p.eval('document.getElementById("help").classList.contains("is-open")')), 'Esc closes it');
    const firsts = await p.eval('Array.from(document.querySelectorAll(".cards")).map(c => c.querySelector(".num--glyph use") && c.querySelector(".num--glyph use").getAttribute("href")).filter(Boolean)');
    ok(new Set(firsts).size >= 3, 'the first card of successive blocks takes a different shape each time (' + firsts.join(' ') + ')');
    ok(Object.keys(JMD.CONTEXT_HINTS).length === 5 && JMD.SHAPES.every(sh => sh.name && sh.hint && sh.snippet), 'the shapes table lives in the core: name, hint, snippet for each');
    await p.eval('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true'); await p.settle(50);
    await p.close();
  }

  console.log('\n8b. Intents: what the slide is for, turned into form');
  {
    const bad = JMD.lint(JMD.parse('---\nformat: jmd/1\ntitle: t\n---\n---\nintent: nope\n---\n## A\n---\nintent: reveal\nbg: indigo\n---\n## B\n---\nintent: problem\n---\n## C\n---\nintent: problem\n---\n## D\n'));
    ok(bad.some(f => f.level === 'error' && f.rule === 'intent' && f.message.includes('hook, problem, reveal')), 'an unknown intent is an error naming the ten');
    ok(bad.some(f => f.level === 'info' && f.rule === 'intent-bg'), 'intent + bg: the bg is ignored, said as info');
    const story = bad.filter(f => f.rule.startsWith('story-')).map(f => f.rule).sort();
    ok(JSON.stringify(story) === JSON.stringify(['story-close', 'story-open', 'story-tension']), 'the story linter warns: no hook to open, no act/recap to close, two problems without a reveal (' + story.join(' ') + ')');
    const team = readFileSync(join(root, 'decks/samples/team-update.jmd'), 'utf8');
    ok(JMD.lint(JMD.parse(team)).filter(f => f.level !== 'info').length === 0, 'team-update (ten intents, one each) has no warning at all');
    const html = JMD.render(JMD.parse(team), {});
    const secs = html.match(/<section class="[^"]*"[^>]*>/g);
    const arc = ['hook', 'problem', 'reveal', 'prove', 'explain', 'decide', 'celebrate', 'fun', 'recap', 'act'];
    ok(secs.length === 10 && arc.every((it, i) => secs[i].includes('slide--' + it) && secs[i].includes('data-intent="' + it + '"') && secs[i].includes('slide--' + JMD.INTENT_BG[it])) && [...new Set(arc)].length === JMD.INTENTS.length, 'each slide carries its intent class, data-intent and the background the intent sets');
    ok(html.includes('metric metric--hero is-hero') && html.includes('col col--dark is-hero'), '{.hero} marks the hero metric and the recommended compare column');
    execSync('node tools/build.mjs decks/samples/team-update.jmd', BUILD);
    p = await open('file://' + join(root, 'build/team-update.james-jmd.html')); await p.settle(300);
    const diff = await p.eval(`(() => { const px = (sel, prop, pseudo) => getComputedStyle(document.querySelector(sel), pseudo || null)[prop];
      return { hookTitle: parseFloat(px('.slide--hook .slide-h2', 'fontSize')), proveTitle: parseFloat(px('.slide--prove .slide-h2', 'fontSize')), revealHero: parseFloat(px('.slide--reveal .metric.is-hero .v', 'fontSize')), revealOther: parseFloat(px('.slide--reveal .metric:not(.is-hero) .v', 'fontSize')),
        recapTick: px('.slide--recap .prose li', 'content', '::before'), explainNum: px('.slide--explain .card .num', 'content', '::before'), decideTick: px('.slide--decide .col.is-hero', 'content', '::after'), decideDim: parseFloat(px('.slide--decide .col:not(.is-hero)', 'opacity')),
        funBg: px('.slide--fun', 'backgroundColor'), hookBg: px('.slide--hook', 'backgroundColor'), problemBg: px('.slide--problem', 'backgroundColor'), funTilt: px('.slide--fun .statement .q', 'transform'), celebrateConfetti: px('.slide--celebrate', 'backgroundImage', '::before').includes('radial-gradient'), actCta: parseFloat(px('.slide--act a.cta', 'height')) }; })()`);
    ok(diff.hookTitle > diff.proveTitle * 1.4, `hook titles are big, prove titles small (${diff.hookTitle} vs ${diff.proveTitle}px)`);
    ok(diff.revealHero >= 180 && diff.revealOther < 50, `reveal: one hero number (${diff.revealHero}px), the others recede (${diff.revealOther}px)`);
    ok(diff.recapTick === '"✓"' && diff.explainNum.includes('counter(step'), 'recap lists are ticked, explain cards are numbered (' + diff.explainNum + ')');
    ok(diff.decideTick === '"✓"' && diff.decideDim < 0.7, 'decide: the recommended column carries a tick, the other is dimmed');
    ok(diff.funBg !== diff.hookBg && diff.hookBg !== diff.problemBg && diff.celebrateConfetti && diff.funTilt !== 'none' && diff.actCta >= 80, 'fun, hook and problem sit on three different backgrounds; celebrate has confetti, fun tilts, act has a big CTA');
    // the story arc in the Info card, and explain slides stepping their items whatever the motion mode
    await p.key('I'); await p.settle(50);
    const card = await p.eval('document.getElementById("info").textContent');
    ok(card.includes('hook › problem › reveal › prove › explain › decide › celebrate › fun › recap › act'), 'the Info card shows the story arc');
    await p.key('Escape');
    await p.eval('jamesJmd.motion("soft"); jamesJmd.show(4); true'); await p.settle(100);
    const step = await p.eval('(() => { const s = document.querySelector(".slide--explain"); return { pending: s.querySelectorAll(".is-pending").length, cards: s.querySelectorAll(".card").length }; })()');
    await p.key('ArrowRight'); await p.settle(50);
    const after = await p.eval('(() => { const s = document.querySelector(".slide--explain"); return { pending: s.querySelectorAll(".is-pending").length, active: s.classList.contains("is-active") }; })()');
    ok(step.pending === step.cards && step.cards === 4 && after.pending === 3 && after.active, 'an explain slide reveals its cards one by one on → in soft mode (the intent modulates the global motion)');
    await p.eval('jamesJmd.motion("none"); true'); await p.settle(50);
    ok(await p.eval('document.querySelector(".slide--explain .is-pending") === null'), 'motion none: nothing waits, even on explain');
    await p.close();
    // the differential: one content under the ten intents must still fit the slide, in the default brand and the densest one
    const meta = 'notes: n\n---\n## Incidents don\'t wait for office hours\n\nEvery team has a plan on paper. Few can run it at 3 am with the people they actually have.\n\n';
    const bodies = { metrics: '::: metrics\n- 73 % | of incidents happen outside office hours | Measured on twelve months of alerts. {.hero}\n- 4 min | target reaction time | From the first alert to the crisis cell.\n- 2 × | faster than last year | Same team, new playbooks.\n:::\n',
      cards: '::: cards\n- Prepare | Ready-made plans, tested. Drills on a schedule. One place for procedures.\n- React | Real-time coordination of the team. Secure channels: chat, video, alerts. {.hero}\n- Continue | Degraded mode in one switch. Critical data available 24/7.\n:::\n',
      list: '- **Enroll the crisis cell** — invite the people who will run the response.\n- **Load the playbooks** — procedures, checklists, key documents.\n- **Rehearse** — run a drill and fix what breaks.\n\n[Book the drill](https://example.com){.cta}\n' };
    for (const [name, body] of Object.entries(bodies)) for (const brand of [ANY_BRAND, 'slate']) {
      writeFileSync(join(root, `build/intents-${name}.jmd`), `---\nformat: jmd/1\ntitle: Intents\nbrand: ${brand}\n---\n` + JMD.INTENTS.map(it => `---\nintent: ${it}\n` + meta + body).join(''));
      const o = cli(`lint build/intents-${name}.jmd --dom --json`, false), r = JSON.parse(typeof o === 'string' ? o : o.out);
      ok(r.errors === 0, `${name} under the ten intents fits the slide with ${brand}`, JSON.stringify(r.findings.filter(f => f.level === 'error').map(f => f.slide + ': ' + f.message)));
    }
  }

  // the document header — layout, title, brand, language, date, author — is edited in the same panel, as its own lines
  {
    execSync('node tools/build.mjs decks/samples/four-blocks.jmd', BUILD);
    p = await open('file://' + join(root, 'build/four-blocks.james-jmd.html')); await p.settle(300);
    await p.key('ArrowRight'); await p.key('E'); await p.settle(100);
    ok(await p.eval('document.getElementById("edit-target").textContent') === 'document' && (await p.eval('document.getElementById("edit-title").textContent')).startsWith('Slide 02'), 'the editor opens on the slide, with a `document` button');
    await p.eval('document.getElementById("edit-target").click(); true'); await p.settle(100);
    const hdr = await p.eval('document.getElementById("edit-src").value');
    ok((await p.eval('document.getElementById("edit-title").textContent')).startsWith('Document · lines 1–') && hdr.startsWith('---\nformat: jmd/1\n') && hdr.includes('\nlayout: slide\n') && hdr.includes('\ntitle: ') && await p.eval('document.getElementById("edit-target").textContent') === 'slide', 'document: the header lines open in the editor, the button now reads `slide`');
    ok((await p.eval('document.getElementById("edit-chips").textContent')) === 'layout: slide ▸' && (await p.eval('document.getElementById("edit-ctx").textContent')).includes('layout: slide · doc · story · webpage'), 'the header has one chip, `layout: slide ▸`, and its own hint');
    await p.eval('document.querySelector("#edit-chips .layout").click(); true'); await p.settle(400);
    ok(await p.eval('document.body.classList.contains("layout-doc")') && await p.eval('jamesJmd.state.layout') === 'doc' && (await p.eval('document.getElementById("edit-src").value')).split('\n')[2] === 'layout: doc' && await p.eval('jamesJmd.state.i') === 1 && await p.eval('document.querySelectorAll(".slide").length') === 4, 'clicking the chip inserts `layout: doc` under `format:` and the deck re-renders as A4 pages, on the same slide');
    await p.eval('document.querySelector("#edit-chips .layout").click(); true'); await p.settle(400);
    await p.eval('document.querySelector("#edit-chips .layout").click(); true'); await p.settle(400);
    await p.eval('document.querySelector("#edit-chips .layout").click(); true'); await p.settle(400);
    ok(await p.eval('jamesJmd.state.layout') === 'slide' && await p.eval('document.body.classList.contains("layout-slide")') && !(await p.eval('document.body.classList.contains("layout-webpage")')) && await p.eval('jamesJmd.state.i') === 1 && (await p.eval('document.getElementById("edit-src").value')).includes('layout: slide'), 'the chip cycles doc → story → webpage → slide: the Slide stage is back, still on slide 02');
    await p.eval('const t = document.getElementById("edit-src"); t.value = t.value.replace(/^title: .*$/m, "title: Renamed"); t.dispatchEvent(new Event("input")); true'); await p.settle(400);
    ok(await p.eval('document.title') === 'Renamed — james-jmd' && await p.eval('jamesJmd.state.dirty') === true && await p.eval('jamesJmd.state.src').then(s => s.split('\n').slice(-3).join('\n')) === fixed.split('\n').slice(-3).join('\n'), 'editing `title:` renames the deck; the slides below are untouched byte for byte');
    await p.eval('document.getElementById("edit-target").click(); true'); await p.settle(100);
    ok((await p.eval('document.getElementById("edit-title").textContent')).startsWith('Slide 02') && (await p.eval('document.getElementById("edit-src").value')).includes('Northwind in three numbers'), '`slide` brings the slide back into the editor');
    await p.key('Escape'); await p.key('I'); await p.settle(100);
    ok(await p.eval('document.querySelectorAll("#info [data-edit=header]").length') >= 4 && (await p.eval('document.querySelector("#info h2").textContent')) === 'Renamed', 'the Info card: the title and the header rows are links');
    await p.eval('document.querySelector("#info dd[data-edit]").click(); true'); await p.settle(100);
    ok(await p.eval('document.getElementById("edit").classList.contains("is-open")') && !(await p.eval('document.getElementById("info").classList.contains("is-open")')) && (await p.eval('document.getElementById("edit-title").textContent')).startsWith('Document'), 'clicking a header row in Info opens the editor on the header');
    await p.key('Escape'); await p.key('E'); await p.settle(100);
    ok((await p.eval('document.getElementById("edit-title").textContent')).startsWith('Slide 02'), 'E always opens on the slide');
    // a deck with no header at all: the editor offers a minimal one
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed.replace(/^---\n[\s\S]*?\n---\n/, ''))}, "bare.jmd"); jamesJmd.editTarget("doc"); true`); await p.settle(200);
    ok((await p.eval('document.getElementById("edit-title").textContent')).includes('no header yet') && (await p.eval('document.getElementById("edit-src").value')) === '---\nformat: jmd/1\nlayout: slide\n---', 'a deck without a header: the editor offers `format` and `layout`, to be inserted at line 1');
    await p.eval('document.querySelector("#edit-chips .layout").click(); true'); await p.settle(400);
    ok(await p.eval('jamesJmd.state.layout') === 'doc' && (await p.eval('jamesJmd.state.src')).startsWith('---\nformat: jmd/1\nlayout: doc\n---\n') && JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).every(f => f.rule !== 'format'), 'the chip writes that header in, and the format error goes away');
    await p.close();
  }

  console.log('\n9. ZIP reader and the .pptx importer');
  {
    const { readZip, writeZip } = await import('./zip.mjs');
    const zdir = join(tmp, 'z'); mkdirSync(join(zdir, 'ppt/slides'), { recursive: true });
    writeFileSync(join(zdir, 'ppt/slides/slide1.xml'), '<p:sld><a:t>Hello</a:t></p:sld>');
    writeFileSync(join(zdir, 'blob.bin'), Buffer.alloc(5000, 7));
    execSync('zip -q -r ../t.zip .', { cwd: zdir }); // deflate + a stored-or-deflated binary
    const z = readZip(readFileSync(join(tmp, 't.zip')));
    ok(z.has('ppt/slides/slide1.xml') && z.text('ppt/slides/slide1.xml').includes('Hello'), 'readZip: reads a deflated text entry');
    ok(z.read('blob.bin').length === 5000 && z.read('blob.bin')[4999] === 7, 'readZip: reads a binary entry intact');
    ok(z.read('nope') === null, 'readZip: missing entry → null');
    /* The writer (spec/export.md): store mode, no dependency — what it writes is read back by a reader that is not ours.
       A member's name is ours and plain: a path in it never becomes a folder on someone's disk. */
    const made = writeZip({ 'deck-01.png': Buffer.from('first'), 'deck-02.png': Buffer.alloc(5000, 9) });
    writeFileSync(join(tmp, 'made.zip'), made);
    let unzipSays = ''; try { unzipSays = execSync('unzip -t made.zip', { cwd: tmp, encoding: 'utf8' }); } catch (e) { unzipSays = String(e.stdout || e.message); }
    const back = readZip(made);
    let refused = ''; try { writeZip({ '../evil.png': Buffer.from('x') }); } catch (e) { refused = e.message; }
    ok(/No errors detected/.test(unzipSays) && back.text('deck-01.png') === 'first' && back.read('deck-02.png').length === 5000 && back.read('deck-02.png')[4999] === 9 && /plain name/.test(refused), 'writeZip: a real zip — unzip -t checks its CRCs, it reads back intact, and a path as a member name is refused', unzipSays.split('\n')[0]);
    writeFileSync(join(zdir, 'bomb.xml'), Buffer.alloc(40 * 1024 * 1024, 0x20)); // 40 MB of spaces: a few KB deflated
    execSync('zip -q ../bomb.zip bomb.xml', { cwd: zdir });
    const bomb = readZip(readFileSync(join(tmp, 'bomb.zip')));
    let bombErr = null; try { bomb.read('bomb.xml'); } catch (e) { bombErr = e; }
    ok(bombErr && bombErr.code === 'ZIP_TOO_LARGE' && /32 MB/.test(bombErr.message), 'readZip: an entry inflating above the cap throws with the cap, before the memory is spent', String(bombErr));
    let notZip = null; try { readZip(Buffer.from('PK\x03\x04 not really a zip, no directory')); } catch (e) { notZip = e; }
    ok(notZip && notZip.message === 'not a zip file', 'readZip: bytes without a directory are "not a zip file", nothing else');
    const { pixels } = await import('../lib/import-pptx.mjs');
    const ihdr = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0x75, 0x30, 0, 0, 0x75, 0x30, 8, 6, 0, 0, 0])]);
    const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b080100020003011100', 'hex'); // JFIF, then SOF0: 256 high, 512 wide
    ok(pixels(ihdr) === 900_000_000 && pixels(jpg) === 512 * 256 && pixels(Buffer.from('nope')) === null, 'pixels(): the size a PNG or a JPEG claims in its header, without decoding it');
    if (process.env.JMD_TEST_PPTX && existsSync(process.env.JMD_TEST_PPTX)) {
      const out = execSync(`node bin/jmd.mjs import "${process.env.JMD_TEST_PPTX}" -o ${join(tmp, 'imp')}`, { cwd: root }).toString();
      ok(/\d+ slides, \d+ images/.test(out) && existsSync(join(tmp, 'imp/import-report.md')) && existsSync(join(tmp, 'imp/brand-draft.yaml')), 'jmd import: draft, media, brand draft and report written');
      const drafted = execSync(`ls ${join(tmp, 'imp')}/*.jmd`).toString().trim();
      const r = cli(`lint ${drafted} --json`, false); const js = JSON.parse(typeof r === 'string' ? r : r.out);
      ok(js.slides > 0 && !js.findings.some(f => f.rule === 'missing-asset' || f.rule === 'unknown-block' || f.rule === 'format'), 'jmd import: the draft parses, every referenced media exists', JSON.stringify(js.findings.filter(f => f.level === 'error')));
    } else console.log('  – JMD_TEST_PPTX not set, importer run skipped');
    /* An Office file is the one zip with folders in it (lib/pptx.mjs): `paths: true` takes `ppt/slides/slide1.xml` and
       `[Content_Types].xml`, never a `..`, and `deflate: true` is still read back by unzip and by us. */
    const office = writeZip({ '[Content_Types].xml': '<Types/>'.repeat(40), '_rels/.rels': '<R/>', 'ppt/media/a.png': Buffer.alloc(300, 1) }, { paths: true, deflate: true });
    writeFileSync(join(tmp, 'office.zip'), office);
    let officeSays = ''; try { officeSays = execSync('unzip -t office.zip', { cwd: tmp, encoding: 'utf8' }); } catch (e) { officeSays = String(e.stdout || e.message); }
    const refusedPaths = ['ppt/../x.xml', '/abs.xml', 'ppt//x.xml', '..'].filter(n => { try { writeZip({ [n]: 'x' }, { paths: true }); return false; } catch { return true; } });
    ok(/No errors detected/.test(officeSays) && readZip(office).text('_rels/.rels') === '<R/>' && refusedPaths.length === 4, 'writeZip paths: folders and brackets for an Office file, deflated and read back; `..`, a leading `/` or an empty segment refused', officeSays.split('\n')[0] + ' refused=' + refusedPaths.join(','));
  }

  console.log('\n9b. PowerPoint export (lib/pptx.mjs)');
  {
    /* The deck's words land in XML that PowerPoint, Keynote and OnlyOffice (Wedoc) parse: every character is escaped, a link
       leaves only as https/http/mailto, and the file opens in a reader that is not ours — our own importer reads it back. */
    const jmdLib = await import('../lib/jmd.mjs');
    const { readZip } = await import('./zip.mjs');
    const { importPptx } = await import('../lib/import-pptx.mjs');
    const evil = `---\nformat: jmd/1\nlayout: slide\ntitle: Export & co\nlang: en\n---\n\n---\nnotes: Say <b>this</b> & that.\n---\n# Tags <script>alert(1)</script> & "quotes" ]]>\nA [safe link](https://www.jamespot.com) and a [bad one](javascript:alert(1)).\n\n---\n\n## Second screen\n\n::: metrics\n- 42 | answers | and nothing else\n- 7 | days | a week\n:::\n`;
    const buf = await jmdLib.pptx(evil, { brand: ANY_BRAND });
    const z = readZip(buf), slide1 = z.text('ppt/slides/slide1.xml'), rels1 = z.text('ppt/slides/_rels/slide1.xml.rels');
    ok(buf.slice(0, 2).toString() === 'PK' && z.has('[Content_Types].xml') && z.has('ppt/presentation.xml') && z.has('ppt/slides/slide2.xml') && !z.has('ppt/slides/slide3.xml'), 'pptx: a zip with the Office parts, one slide per screen');
    ok(!/<script/i.test(slide1) && slide1.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; ]]&gt;'), 'pptx: the deck\'s words are escaped in the slide XML — a tag in a title is text, never markup');
    ok(rels1.includes('https://www.jamespot.com') && !/javascript:/i.test(rels1) && !/javascript:/i.test(slide1.replace(/<a:t>[^<]*<\/a:t>/g, '')), 'pptx: an https link leaves as a link, a javascript: link never does', rels1.match(/Target="[^"]*"/g)?.join(' '));
    ok(z.has('ppt/notesSlides/notesSlide1.xml') && z.text('ppt/notesSlides/notesSlide1.xml').includes('Say &lt;b&gt;this&lt;/b&gt; &amp; that.'), 'pptx: the speaker notes travel, escaped');
    ok(/<a:t>42<\/a:t>/.test(z.text('ppt/slides/slide2.xml')) && /<a:t>answers<\/a:t>/.test(z.text('ppt/slides/slide2.xml')), 'pptx: a block\'s text is native text — a metric is a number someone can edit');
    ok(Object.keys(z).length >= 0 && [...z.names].filter(n => n.startsWith('ppt/media/')).every(n => z.read(n).slice(1, 4).toString() === 'PNG'), 'pptx: what is not text (the watermark, the drawing) is PNG pictures');
    writeFileSync(join(tmp, 'export.pptx'), buf);
    const back = await importPptx(join(tmp, 'export.pptx'), join(tmp, 'export-back'), { brand: ANY_BRAND });
    const backSrc = readFileSync(back.jmd, 'utf8');
    ok(back.slides === 2 && backSrc.includes('Second screen') && backSrc.includes('42'), 'pptx: our own importer opens the export and finds its screens and words', `${back.slides} slides`);
    let refusedWeb = null; try { await jmdLib.pptx('---\nformat: jmd/1\nlayout: webpage\n---\n\n# One page\n'); } catch (e) { refusedWeb = e; }
    ok(refusedWeb && refusedWeb.code === 'JMD_NO_SCREEN', 'pptx: a webpage has no screens to give PowerPoint — refused in words', String(refusedWeb));
    /* The face (spec/export.md "Fonts"): the brand's own is embedded in a deck, never in an Office file — the brand names the
       face the reader's suite has (Jamespot: Arial, Arial Black for Garet Heavy), one name of its own shape, nothing else. */
    const faces = [...slide1.matchAll(/<a:rPr [^>]*?b="([01])"[^>]*>(?:(?!<\/a:rPr>).)*?<a:latin typeface="([^"]*)"/g)].map(m => m[2] + ':' + m[1]);
    if (!HOUSE) ok(faces.length && !faces.some(f => /Garet/.test(f)), 'pptx: every run names a face, and never a brand face the Office suite does not have', [...new Set(faces)].join(' '));
    else ok(faces.includes('Arial Black:0') && faces.some(f => f.startsWith('Arial:')) && faces.includes('Courier New:0') && !faces.some(f => /Garet/.test(f)) && z.text('ppt/theme/theme1.xml').includes('typeface="Arial"'), 'pptx: the Jamespot faces — Arial Black for the heaviest weights (no bold on top), Arial for the rest, Courier New for a mono, never Garet', [...new Set(faces)].join(' '));
    const { validateBrand } = await import('./safe.mjs');
    const officeBad = ['Arial, Verdana', '"Arial"', 'x</style><script>', 'A;b', ''.padEnd(70, 'a')].filter(v => { try { validateBrand({ primary: '#000', 'font-office': v }); return false; } catch (e) { return /font-office/.test(e.message); } });
    ok(officeBad.length === 5 && validateBrand({ primary: '#000', 'font-office': 'Arial', 'font-office-heavy': 'Arial Black' }), 'brand: font-office is one face (letters, digits, spaces) — a list, a quote, markup or 70 letters refused, the field named');
    const plainBrand = await jmdLib.pptx(evil, { brand: 'slate' });
    ok(!/typeface="(?!Arial"|Courier New")/.test(readZip(plainBrand).text('ppt/slides/slide2.xml')), 'pptx: a brand that names no office face gets Arial, which every suite has');
  }

  console.log('\n10. CLI and PDF pipeline');
  ok(cli('lint decks/samples/four-blocks.jmd').includes('0 errors'), 'jmd lint: static rules pass on the clean sample');
  const bad2 = cli('lint build/four-blocks-overflow.jmd --dom', false);
  ok(bad2.code === 1 && bad2.out.includes('overflow'), 'jmd lint --dom: exit 1 and the overflow finding on the provoked deck', JSON.stringify(bad2));
  const js = JSON.parse(cli('lint decks/samples/four-blocks.jmd --json'));
  ok(js.ok === true && js.slides === 4 && Array.isArray(js.findings), 'jmd lint --json: machine-readable shape');
  cli('pdf decks/samples/four-blocks.jmd -o build/four-blocks.pdf');
  const info = execSync('pdfinfo build/four-blocks.pdf', { cwd: root }).toString();
  ok(/Pages:\s+4/.test(info) && /960 x 540/.test(info), 'jmd pdf: 4 pages at 960×540 pt');
  const txt = execSync('pdftotext -layout build/four-blocks.pdf -', { cwd: root }).toString();
  ok(txt.includes('Northwind in three numbers.') && txt.includes('WHO NORTHWIND IS'), 'PDF text is selectable and complete');
  cli('render decks/samples/four-blocks.jmd -o build/four-blocks-slides');
  const pngs = execSync('ls build/four-blocks-slides', { cwd: root }).toString().trim().split('\n');
  ok(pngs.length === 4 && readFileSync(join(root, 'build/four-blocks-slides/slide-01.png')).subarray(1, 4).toString() === 'PNG', 'jmd render: one PNG per slide');

  console.log('\n10b. Brands: the shipped set, a .yaml path, YAML text');
  const { brands, loadBrand, markSymbol } = await import('../tools/build.mjs');
  const ids = brands().map(b => b.id);
  const wanted = ['slate', 'ocean', 'forest', 'terracotta', 'plum', 'mono'].concat(HOUSE ? [HOUSE] : []); // the house brand is not in every tree (PUBLIC.md)
  ok(ids.length >= wanted.length && !ids.includes('jamespot-basic') && !ids.includes('jamespot-2026') && wanted.every(x => ids.includes(x)) && brands().every(b => b.about.length > 10), 'brands(): six neutral looks' + (HOUSE ? ' and the house one' : '') + ', each with a one-line about (' + ids.join(' ') + ')');
  for (const id of ids) {
    const o = cli(`lint decks/samples/four-blocks.jmd --dom --json --brand ${id}`, false), r = JSON.parse(typeof o === 'string' ? o : o.out);
    ok(r.ok === true, `four-blocks lints clean with brand ${id}`, JSON.stringify((r.findings || []).filter(x => x.level === 'error')));
  }
  cli('build decks/samples/hello-jmd.jmd -o build/hello-ocean.html --brand ocean');
  const ocean = readFileSync(join(root, 'build/hello-ocean.html'), 'utf8');
  ok(ocean.includes('--brand-primary:#0B2545') && ocean.includes('neutral mark "dot"') && !ocean.includes('@font-face'), 'jmd build --brand ocean: navy palette, the dot mark family, no embedded font');
  writeFileSync(join(root, 'build/acme.yaml'), 'name: Acme\nprimary: "#123456"\nlogo: tri\n');
  const acme = loadBrand(join(root, 'build/acme.yaml'));
  ok(acme.id === 'acme' && acme.accent === '#123456' && acme.logo === 'tri' && acme['card-marker'] === 'glyphs' && acme.fonts === 'fonts/system.css', 'a .yaml path is a brand; blanks take the neutral defaults');
  const { deckBrand } = await import('../tools/build.mjs');
  ok(deckBrand('---\ntheme: ocean\n---\n') === 'ocean' && deckBrand('---\ntheme: jamespot\ntemplate: plum\n---\n') === 'plum' && deckBrand('---\ntheme: mono\n---\n') === 'mono', 'frontmatter: brand:, template: and theme: are one key, and brand: wins');
  const inline = loadBrand('primary: "#0B2545"\naccent: "#F18F01"');
  ok(inline.id === 'custom' && inline.accent === '#F18F01' && inline.name === '', 'YAML text is a brand too (custom)');
  let err = ''; try { loadBrand('primary: blue'); } catch (e) { err = e.message; } ok(err.includes('#rrggbb'), 'a brand without a #hex primary is refused');
  try { loadBrand('primary: "#000"\nlogo: nope'); } catch (e) { err = e.message; } ok(err.includes('not one of the marks'), 'an unknown mark is refused, the list given');
  const sym = markSymbol('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><script>evil()</script><circle cx="5" cy="5" r="4"/></svg>');
  ok(sym.startsWith('<symbol id="brand-mark" viewBox="0 0 10 10">') && sym.includes('<circle') && !sym.includes('script') && !sym.includes('onload'), 'a customer SVG becomes the brand-mark symbol, scripts and handlers dropped');

  console.log('\n12. Security: the deck is data, never code (spec/security.md §1–§2)');
  {
    const { buildHtml, resolveAssets, contentSecurityPolicy } = await import('../tools/build.mjs');
    const { sanitizeSvg, cssStr, validateBrand } = await import('../tools/safe.mjs');
    const jmdLib = await import('../lib/jmd.mjs');
    // a deck folder with an image inside, a secret outside, a symlink pointing out, and a text file inside
    const sec = join(tmp, 'sec'), deckDir = join(sec, 'deck'); mkdirSync(join(deckDir, 'img'), { recursive: true });
    writeFileSync(join(deckDir, 'img/ok.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"/></svg>');
    writeFileSync(join(sec, 'secret.png'), 'SECRET-BYTES-OUTSIDE'); writeFileSync(join(deckDir, 'notes.txt'), 'not an image');
    symlinkSync(join(sec, 'secret.png'), join(deckDir, 'link.png'));
    // every text channel tries an injection; the paths try to leave the folder
    const adversarial = ['---', 'format: jmd/1', 'title: T <img src=x onerror=alert(1)>', `brand: ${ANY_BRAND}`, '---',
      '---', 'intent: hook', 'notes: <script>alert("notes")</script> and <b>bold</b>', 'section: </section><script>alert(2)</script>', '---',
      '# Title </section><script>alert(3)</script>', 'Lead with <svg onload=alert(4)> and [js](javascript:alert(5)) and [data](data:text/html,<script>alert(6)</script>){.cta}',
      '', '---', 'bg: white', '---', '## Slide {.x" onmouseover="alert(7)}', '![alt" onerror="alert(8)](../secret.png)', '![img](link.png)', '![txt](notes.txt)', '![ok](img/ok.svg)',
      '::: cards {.y" onclick="alert(9)}', '- <iframe src=javascript:alert(10)> | "><script>alert(11)</script>', '- `<script>alert(12)</script>` | **<b onmouseover=alert(13)>x</b>**', ':::',
      '', '---', 'bg: wash', '---', '## Table', '| a | b |', '|---|---|', '| <script>alert(14)</script> | </script><script>alert(15)</script> |',
      '', '---', 'bg: indigo', '---', '## Statement', '::: statement', 'One sentence </style><script>alert(16)</script>', '— <a href="javascript:alert(17)">who</a>', ':::', ''].join('\n');
    // a brand that tries every field
    const badBrand = (k, v) => { try { loadBrand(`primary: "#112233"\n${k}: ${v}`); return null; } catch (e) { return e.message; } };
    try { buildHtml({ jmd: adversarial, name: 'nofont.jmd', brand: 'primary: "#112233"\nfonts: fonts/private/nope.css', dir: deckDir }); ok(false, 'brand: a fonts file that is not there is a build error'); }
    catch (e) { ok(/brand fonts/.test(e.message) && /fontpack/.test(e.message), 'brand: a fonts file that is not there is a build error, not a silent fallback (the message says what to do)', e.message); }
    const fontAttack = 'x"; } </style><script>alert(1)</script><style>';
    ok((badBrand('font-display', fontAttack) || '').includes('font-display'), 'brand: a font name carrying </style><script> is refused, the field named (confirmed hole, closed)');
    ok((badBrand('accent', '"#123456; } </style>"') || '').includes('accent'), 'brand: a color carrying `;` is refused');
    ok((badBrand('type-scale', '"1</style>"') || '').includes('type-scale') && (badBrand('watermark', 'evil') || '').includes('watermark') && (badBrand('motion', 'x') || '').includes('motion'), 'brand: scale and enum fields are validated by shape');
    ok((badBrand('fonts', '../../../../etc/passwd') || '').includes('fonts') && badBrand('fonts', 'fonts/system.css') === null, 'brand: fonts must be a fonts/….css of the brands folder, nowhere else on the disk');
    /* `brand` was the last channel through which a caller's words reached the server's disk (confirmed hole, closed). `dir`
       has been confined under a scratch folder for the call since §2, but a brand naming a `.yaml` path went straight to
       readFileSync: on the hosted server that read any .yaml of the machine, quoted one of its lines back verbatim through
       the shape error that refused it, and — a file that is there failing differently from one that is not — told a caller
       which paths exist. Locally a path must keep working: `--brand=./ours.yaml` is the point of the flag. So the assertion
       is in two halves, and the second one is that hosted the answer is the *same sentence* either way: no oracle left. */
    const { setBrandPaths } = await import('../tools/build.mjs');
    const outside = join(tmp, 'outside-brand.yaml'), leaky = join(tmp, 'leaky-brand.yaml'), absent = join(tmp, 'no-such-brand.yaml');
    writeFileSync(outside, 'name: Read from outside the tree\nprimary: "#ff0000"\n');
    writeFileSync(leaky, 'accent: A-LINE-OF-A-FILE-NOBODY-ASKED-FOR\nprimary: "#00ff00"\n');
    ok(loadBrand(outside).name === 'Read from outside the tree', 'locally a brand may be a .yaml anywhere: the disk belongs to whoever typed the command');
    setBrandPaths(false); // what mcp/tools.mjs setHosted(true) does
    const hostedSays = p => { try { loadBrand(p); return '(read it)'; } catch (e) { return e.message; } };
    const there = hostedSays(outside), lineOf = hostedSays(leaky), notThere = hostedSays(absent);
    setBrandPaths(true);
    ok(/a path is not a brand/.test(there) && /a path is not a brand/.test(lineOf) && there === notThere && lineOf === notThere,
      'hosted a path is not a brand at all, and the refusal is one sentence whether the file is there or not: no file read, no line of it quoted back, no way to learn which paths exist', JSON.stringify([there.slice(0, 40), notThere === there]));
    ok(!lineOf.includes('A-LINE-OF-A-FILE-NOBODY-ASKED-FOR') && loadBrand('mono').id === 'mono' && loadBrand('primary: "#112233"').id === 'custom',
      'and what still works is what a caller is meant to name: an id, or the YAML itself', lineOf.slice(0, 60));
    ok(!/["<>{};]/.test(cssStr(fontAttack)) && cssStr('Helvetica Neue') === 'Helvetica Neue', 'interpolation escapes CSS anyway: nothing can close a string, a rule or the <style>');
    const built0 = buildHtml({ jmd: adversarial, name: 'x"><script>alert(0)</script>.jmd', brand: 'name: "Acme */</style><script>alert(0)</script>"\nprimary: "#112233"', dir: deckDir });
    ok(!built0.includes('<script>alert(0)') && built0.includes('data-name="x&quot;&gt;&lt;script&gt;'), 'the deck name and the brand name are escaped where they land (attribute, CSS comment)');
    ok(!buildHtml({ jmd: fixed, brand: 'name: "**//"\nprimary: "#112233"' }).includes('/* brand : */'), 'brand name: no `*` nor `/` survives in the CSS comment (a `**//` cannot assemble a closer)');
    ok(validateBrand({ primary: '#000', 'font-display': 'Söhne' }) && validateBrand({ primary: '#000', 'font-body': '游ゴシック' }), 'brand: font names in any script are accepted');
    let svgErr = ''; try { buildHtml({ jmd: fixed, brand: 'primary: "#000"\nlogo: logo.svg' }); } catch (e) { svgErr = e.message; }
    ok(svgErr.includes('logo.svg') && svgErr.includes('brand.yaml URL'), 'a local brand naming an SVG logo without a URL to fetch it from is an error, not silently the Jamespot mark');
    // a real-world logo (Illustrator export): class rules in a <style>, root attributes, a prolog — keeps its colors, warns about nothing
    const aiLogo = '<?xml version="1.0" encoding="utf-8"?><!-- Generator: Adobe Illustrator --><svg version="1.1" id="Calque_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 10 10" style="enable-background:new 0 0 10 10;" xml:space="preserve"><style type="text/css">.st0{fill:#E30613;} .st1{fill:#1D1D1B;stroke:#FFFFFF;stroke-width:0.5;}</style><rect class="st0" width="5" height="5"/><path class="st1" d="M5 5h5v5z"/></svg>';
    const ai = sanitizeSvg(aiLogo);
    ok(ai.dropped.length === 0 && ai.symbol.includes('<rect class="st0" width="5" height="5" style="fill:#E30613"/>') && ai.symbol.includes('style="fill:#1D1D1B;stroke:#FFFFFF;stroke-width:0.5"') && !ai.symbol.includes('<style'), 'an Illustrator logo keeps its colors (class rules inlined, the <style> itself never reaches the page) and triggers no warning', ai.symbol + ' ' + ai.dropped.join(','));
    const badStyle = sanitizeSvg('<svg viewBox="0 0 1 1"><style>#hud{display:none} .a{fill:url(https://x/y)} .b{fill:#123;background:url(https://t)}</style><rect class="a b" width="1" height="1"/></svg>');
    ok(badStyle.symbol.includes('style="fill:#123"') && !/hud|https|background/.test(badStyle.symbol) && badStyle.dropped.includes('style rules'), 'logo <style>: selectors by id, url(http) and non-paint properties are dropped, counted once');
    const voidTag = sanitizeSvg('<svg viewBox="0 0 1 1"><foreignObject><div>x<br>y<img src="x"></div></foreignObject><rect width="1" height="1"/></svg>');
    ok(voidTag.symbol.includes('<rect width="1" height="1"/>') && !voidTag.symbol.includes('div'), 'HTML void tags inside a dropped <foreignObject> do not swallow the shapes after it');
    const httpImg = resolveAssets('---\nformat: jmd/1\n---\n## x\n![a](http://example.com/p.png)\n![b](https://example.com/p.png)\n', deckDir);
    ok(!('http://example.com/p.png' in httpImg.assets) && !('https://example.com/p.png' in httpImg.assets) && !httpImg.missing.length, 'resolveAssets leaves URL images to the network door (tools/images.mjs): neither embedded from disk nor kept live');
    // the hostile logo: eight vectors
    const evilSvg = '<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload=\'alert(1)\'><script>alert(2)</script><style>rect{fill:url(https://x/y)}</style><foreignObject><body onload=alert(3)></body></foreignObject><image href="https://x/p.png"/><set attributeName="onmouseover" to="alert(4)"/><animate attributeName="x"/><defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient></defs><g id="stage" OnClick="alert(5)"><rect width="10" height="10" fill="url(#g)"/><use xlink:href="#stage"/><use href="https://evil/x.svg#a"/><circle r="1" fill="url(https://evil/p)"/><path d="M0 0h10" fill="javascript:alert(7)"/></g></svg>';
    const { symbol, dropped } = sanitizeSvg(evilSvg);
    ok(!/script|style|foreignobject|image|<set|animate|on\w+=|https?:|javascript:/i.test(symbol) && symbol.includes('<rect width="10" height="10" fill="url(#lg-g)"/>') && symbol.includes('<linearGradient id="lg-g">'), 'logo SVG: parsed and rebuilt — shapes, paint and gradients kept, the eight vectors gone, ids prefixed', symbol);
    ok(dropped.includes('<script>') && dropped.includes('onload') && dropped.includes('onclick') && dropped.includes('<foreignobject>') && dropped.length >= 10, 'logo SVG: what was removed is counted for the jmd_brand warning (' + dropped.length + ')');
    ok(!symbol.includes('id="stage"') && sanitizeSvg('<svg viewBox="0 0 1 1"><g id="hud"/></svg>').symbol.includes('id="lg-hud"'), 'logo SVG: an id can never shadow a runtime id');
    // assets: real path under the real folder, images only
    const ra = resolveAssets(adversarial, deckDir);
    ok(Object.keys(ra.assets).length === 1 && ra.assets['img/ok.svg'].startsWith('data:image/svg+xml;base64,'), 'assets: only the image inside the folder is embedded');
    ok(ra.refused['../secret.png'] === 'outside the deck folder' && ra.refused['link.png'] === 'outside the deck folder' && ra.refused['notes.txt'].startsWith('not an image'), 'assets: `../`, a symlink pointing out, and a non-image are refused with their reason (confirmed hole, closed)', JSON.stringify(ra.refused));
    ok(resolveAssets('---\nformat: jmd/1\n---\n## x\n![e](etc/hosts)\n![p](etc/passwd.png)\n', '/').assets['etc/hosts'] === undefined && !JSON.stringify(resolveAssets(adversarial, sec).assets).includes('SECRET'), 'assets: dir "/" embeds nothing that is not an image, and the parent folder does not leak the secret through the symlink either');
    const lintOut = jmdLib.lint(adversarial, { dir: deckDir });
    ok(lintOut.findings.filter(f => f.rule === 'missing-asset').length === 3 && lintOut.findings.some(f => f.rule === 'missing-asset' && f.message.startsWith('outside the deck folder: ../secret.png')), 'lint: each refused asset is a missing-asset error saying why');
    ok(lintOut.findings.some(f => f.rule === 'literal-markup' && f.level === 'info' && f.slide === 1 && f.message.includes('</section>')) && lintOut.findings.filter(f => f.rule === 'literal-markup').length === 4, 'lint: HTML in a text is an info (literal-markup), once per slide — shown as-is, not formatting', JSON.stringify(lintOut.findings.filter(f => f.rule === 'literal-markup')));
    ok(JMD.lint(JMD.parse(fixed)).every(f => f.rule !== 'literal-markup') && JMD.lint(JMD.parse(tour)).every(f => f.rule !== 'literal-markup'), 'lint: the samples carry no literal-markup');
    // the built file: one script, ours, by hash — and the DOM once rendered
    const built = buildHtml({ jmd: adversarial, name: 'adversarial.jmd', brand: ANY_BRAND, dir: deckDir });
    const advPath = join(tmp, 'adversarial.james-jmd.html'); writeFileSync(advPath, built);
    const cspMeta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(built);
    const runtimeHash = /script-src 'sha256-([^']+)'/.exec(cspMeta ? cspMeta[1] : '');
    ok(cspMeta && runtimeHash && cspMeta[1] === contentSecurityPolicy(runtimeHash[1]) && /object-src 'none'/.test(cspMeta[1]) && /base-uri 'none'/.test(cspMeta[1]), 'the built file carries a CSP: one script by hash, no object, no base, no form');
    const lastScript = /<script>\n([\s\S]*?)\n<\/script>\n<\/body>/.exec(built);
    ok(lastScript && createHash('sha256').update('\n' + lastScript[1] + '\n').digest('base64') === runtimeHash[1], 'the hash in the CSP is the hash of the runtime script in the file');
    const violations = [];
    p = await open('about:blank'); await p.send('Log.enable'); p.on('Log.entryAdded', e => { if (/Content Security Policy/.test(e.entry.text)) violations.push(e.entry.text.slice(0, 120)); });
    await p.navigate('file://' + advPath); await p.settle();
    const dom = await p.eval(`JSON.stringify({
      slides: document.querySelectorAll('.slide').length,
      scripts: [...document.scripts].filter(s => !['application/json', 'text/jmd'].includes(s.type)).length,
      handlers: [...document.querySelectorAll('*')].reduce((n, el) => n + [...el.attributes].filter(a => /^on/i.test(a.name)).length, 0),
      badUrls: [...document.querySelectorAll('[href],[src]')].filter(el => /^(javascript|data):/i.test(el.getAttribute('href') || el.getAttribute('src') || '') && !(el.tagName === 'IMG' && /^data:image/.test(el.getAttribute('src')))).length,
      iframes: document.querySelectorAll('iframe,object,embed,foreignObject').length,
      links: [...document.querySelectorAll('.slide a')].map(a => a.getAttribute('href')),
      literal: document.querySelector('.slide').textContent
    })`);
    const d = JSON.parse(dom);
    ok(d.slides === 4 && d.scripts === 1 && d.handlers === 0 && d.badUrls === 0 && d.iframes === 0, 'rendered DOM: one script (ours), zero on* attributes, zero javascript:/data: URLs, zero frames', dom);
    ok(d.links.length >= 2 && d.links.every(h => h === '#') && d.literal.includes('<script>alert(3)</script>'), 'every javascript:/data: link becomes #, raw HTML shows as literal text', dom);
    ok(violations.length === 0, 'no CSP violation while rendering the adversarial deck: nothing reaches the DOM as code', violations.join(' | '));
    await p.close();
    // the CSP itself: a script that slips into the file does not run
    const slipped = built.replace('</body>', '<script>window.__pwned = 1</script>\n</body>');
    const slipPath = join(tmp, 'slipped.james-jmd.html'); writeFileSync(slipPath, slipped);
    violations.length = 0;
    p = await open('about:blank'); await p.send('Log.enable'); p.on('Log.entryAdded', e => { if (/Content Security Policy/.test(e.entry.text)) violations.push(e.entry.text.slice(0, 120)); });
    await p.navigate('file://' + slipPath); await p.settle();
    ok(await p.eval('window.__pwned === undefined') && await p.eval('document.querySelectorAll(".slide").length') === 4 && violations.length === 1, 'CSP: a foreign <script> added to the file is blocked (one violation), the runtime still renders', violations.join(' | '));
    await p.close();
    // the samples render with zero CSP noise, and the editor, export and print still work under the policy
    for (const f of ['four-blocks', 'product-tour', 'team-update', 'numbers']) {
      violations.length = 0;
      execSync(`node tools/build.mjs decks/samples/${f}.jmd`, BUILD);
      p = await open('about:blank'); await p.send('Log.enable'); p.on('Log.entryAdded', e => { if (/Content Security Policy/.test(e.entry.text)) violations.push(e.entry.text.slice(0, 120)); });
      await p.navigate('file://' + join(root, 'build', f + '.james-jmd.html')); await p.settle();
      ok(violations.length === 0 && await p.eval('document.querySelectorAll(".slide").length') > 0, `${f}: renders under the CSP with no violation`, violations.join(' | '));
      await p.close();
    }
    // the data blocks: the first that draw SVG from what the author wrote — labels, values, unit, series and cells all try
    const advData = ['---', 'format: jmd/1', 'layout: slide', `brand: ${ANY_BRAND}`, '---', '', '---', 'notes: n', '---', '## Chart',
      '::: chart {.bar .x" onload="alert(1)}', 'unit: k€"/><script>alert(2)</script>', 'series: <svg onload=alert(3)> | </text><script>alert(4)</script>',
      '- <script>alert(5)</script> | 12 | 3', '- "><img src=x onerror=alert(6)> | 7 | 4 {.hero" onclick="alert(7)}', '- </svg><foreignObject><b>x</b></foreignObject> | 9 onmouseover=alert(8) | 2', ':::',
      '', '---', 'notes: n', '---', '## Pie', '::: chart {.pie}', '- <script>alert(9)</script> | 3 {.hero}', '- [js](javascript:alert(10)) | 4', ':::',
      '', '---', 'notes: n', '---', '## Table', '::: table', '| <script>alert(11)</script> | </td></tr></table><script>alert(12)</script> |', '|---|---|',
      '| <svg onload=alert(13)> | [x](javascript:alert(14)) | {.hero" onclick="alert(15)}', ':::', ''].join('\n');
    const dataPath = join(tmp, 'adversarial-data.james-jmd.html'); writeFileSync(dataPath, buildHtml({ jmd: advData, name: 'adversarial-data.jmd', brand: ANY_BRAND }));
    violations.length = 0;
    p = await open('about:blank'); await p.send('Log.enable'); p.on('Log.entryAdded', e => { if (/Content Security Policy/.test(e.entry.text)) violations.push(e.entry.text.slice(0, 120)); });
    await p.navigate('file://' + dataPath); await p.settle();
    const dd = JSON.parse(await p.eval(`JSON.stringify({
      slides: document.querySelectorAll('.slide').length,
      scripts: [...document.scripts].filter(s => !['application/json', 'text/jmd'].includes(s.type)).length,
      handlers: [...document.querySelectorAll('*')].reduce((n, el) => n + [...el.attributes].filter(a => /^on/i.test(a.name)).length, 0),
      foreign: [...document.querySelectorAll('.chart-svg *')].map(el => el.tagName).filter(t => !['defs', 'linearGradient', 'stop', 'path', 'rect', 'text', 'line', 'polyline', 'polygon', 'circle'].includes(t)),
      svgs: document.querySelectorAll('.chart-svg').length, imgs: document.querySelectorAll('.slide img').length,
      links: [...document.querySelectorAll('.slide a')].map(a => a.getAttribute('href')),
      text: [...document.querySelectorAll('.slide')].map(s => s.textContent).join(' ')
    })`));
    ok(dd.slides === 3 && dd.svgs === 2 && dd.scripts === 1 && dd.handlers === 0 && dd.foreign.length === 0 && dd.imgs === 0, 'data blocks: one script (ours), zero on* attributes, nothing in a chart but the drawing\'s own elements, no image smuggled in', JSON.stringify({ ...dd, text: '' }));
    ok(dd.text.includes('<script>alert(5)</script>') && dd.text.includes('<script>alert(11)</script>') && dd.links.every(h => h === '#'), 'labels and cells show as literal text, a javascript: link in a cell or a key becomes #');
    ok(violations.length === 0, 'no CSP violation while rendering the hostile data blocks', violations.join(' | '));
    await p.close();
    // the diagram: labels, ids, classes, directives and links all try; a node's text is the only thing the author reaches
    const advDia = ['---', 'format: jmd/1', 'layout: slide', `brand: ${ANY_BRAND}`, '---', '', '---', 'notes: n', '---', '## Diagram', '::: diagram {.x" onload="alert(1)}',
      '%%{init: {"securityLevel": "loose", "theme": "base", "themeVariables": {"primaryColor": "url(javascript:alert(2))"}}}%%', 'flowchart TD',
      '  A["<img src=x onerror=alert(3)>"] -->|"</text><script>alert(4)</script>"| B{<svg onload=alert(5)>}', '  B --> C["</tspan></text></svg><foreignObject><b>x</b></foreignObject>"]:::hero" onclick="alert(6)',
      '  C --> D[["javascript:alert(7)"]]', '  click A href "javascript:alert(8)"', '  click B call alert(9)', '  style A fill:url(javascript:alert(10))', '  linkStyle 0 stroke:red', ':::', '',
      '---', 'notes: n', '---', '## Many', '::: diagram', 'graph LR', '  ' + Array.from({ length: 500 }, (_, k) => 'N' + k).join(' --> '), ':::', ''].join('\n');
    const diaPath = join(tmp, 'adversarial-diagram.james-jmd.html'); writeFileSync(diaPath, buildHtml({ jmd: advDia, name: 'adversarial-diagram.jmd', brand: ANY_BRAND }));
    violations.length = 0;
    p = await open('about:blank'); await p.send('Log.enable'); p.on('Log.entryAdded', e => { if (/Content Security Policy/.test(e.entry.text)) violations.push(e.entry.text.slice(0, 120)); });
    const t0 = Date.now(); await p.navigate('file://' + diaPath); await p.settle();
    const dg = JSON.parse(await p.eval(`JSON.stringify({
      slides: document.querySelectorAll('.slide').length,
      scripts: [...document.scripts].filter(s => !['application/json', 'text/jmd'].includes(s.type)).length,
      handlers: [...document.querySelectorAll('*')].reduce((n, el) => n + [...el.attributes].filter(a => /^on/i.test(a.name)).length, 0),
      foreign: [...document.querySelectorAll('.diagram-svg *')].map(el => el.tagName).filter(t => !['g', 'path', 'rect', 'text', 'tspan', 'polygon', 'circle'].includes(t)),
      svgs: document.querySelectorAll('.diagram-svg').length, imgs: document.querySelectorAll('.slide img').length, links: document.querySelectorAll('.slide a').length,
      hero: document.querySelectorAll('.dg-node.is-hero').length, js: document.querySelector('.diagram-svg').outerHTML.includes('javascript:') && [...document.querySelectorAll('.diagram-svg [href], .diagram-svg [style*="url"]')].length,
      text: document.querySelector('.diagram').textContent,
      lint: jamesJmd.state.lint.filter(f => f.level === 'error').map(f => f.rule)
    })`));
    ok(dg.slides === 2 && dg.svgs === 1 && dg.scripts === 1 && dg.handlers === 0 && dg.foreign.length === 0 && dg.imgs === 0 && dg.links === 0 && !dg.js && dg.hero === 1 && dg.lint.includes('diagram-syntax'), 'diagram: one script (ours), zero on* attributes, nothing in the drawing but its own elements, no link, no url(); `:::hero" onclick=…` is the hero class and a line not read, never an attribute', JSON.stringify({ ...dg, text: '' }));
    ok(dg.text.includes('<img src=x onerror=alert(3)>') && dg.text.includes('</text><script>alert(4)</script>') && dg.lint.filter(r => r === 'diagram-click').length === 2 && dg.lint.includes('max-items'), 'diagram: hostile labels show as text; both `click` lines are errors; 500 nodes is `max-items`, shown as its text, never laid out', dg.lint.join(','));
    ok(violations.length === 0 && Date.now() - t0 < 15000, 'no CSP violation, and a 500-node graph lays out without hanging the page', violations.join(' | ') + ' ' + (Date.now() - t0) + 'ms');
    await p.close();
    p = await open('file://' + join(root, 'build/four-blocks.james-jmd.html')); await p.settle();
    await p.eval('URL.createObjectURL = b => { window.__blob = b; return "blob:test"; }; HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; }; window.print = () => { window.__printed = 1; }; true');
    await p.key('E'); const editOpen = await p.eval('document.getElementById("edit").classList.contains("is-open")'); await p.key('Escape');
    await p.key('D'); await p.key('S'); const reExported = await p.eval('window.__blob.text()');
    await p.eval('window.print = () => { window.__printed = 1; window.__printedAs = document.title; }; true'); await p.key('D'); await p.key('P');
    ok(editOpen && /\.james-jmd\.html$/.test(await p.eval('window.__dl')) && await p.eval('window.__printed') === 1 && await p.eval('window.__printedAs') === (await p.eval('window.__dl')).replace(/\.james-jmd\.html$/, '') && /james-jmd$/.test(await p.eval('document.title')), 'under the CSP: the editor opens, D S exports, P prints — the PDF named like the page, the tab\'s title back after', JSON.stringify([await p.eval('window.__dl'), await p.eval('window.__printedAs')]));
    ok(/<meta http-equiv="Content-Security-Policy" content="[^"]*sha256-/.test(reExported) && new RegExp("sha256-" + runtimeHash[1].replace(/[+/=]/g, '\\$&')).test(reExported), 'the re-exported file keeps the CSP and the same runtime hash: it stays valid offline');
    await p.close();
  }

  console.log('\n13. Layouts: Doc (A4 pages), Story (9:16 screens), Webpage (one page) — the same blocks (spec/jmd.md)');
  {
    const onePager = readFileSync(join(root, 'decks/samples/one-pager.jmd'), 'utf8');
    const noLayout = fixed.replace('layout: slide\n', '');
    ok(JMD.layout(JMD.parse(onePager)) === 'doc' && JMD.layout(JMD.parse(fixed)) === 'slide' && JMD.layout(JMD.parse(noLayout)) === 'slide', 'layout: `doc`, `slide`, and no key = slide');
    ok(JMD.lint(JMD.parse(noLayout)).some(f => f.rule === 'layout' && f.level === 'info' && /write `layout: slide`/.test(f.message)) && !JMD.lint(JMD.parse(fixed)).some(f => f.rule === 'layout'), 'lint: a header without `layout:` gets the advice to write it (info, never counted) — the samples all carry it');
    const badLayout = JMD.lint(JMD.parse(fixed.replace('layout: slide', 'layout: poster')));
    ok(badLayout.some(f => f.rule === 'layout' && f.level === 'error' && /slide, doc, story, webpage/.test(f.message)), 'lint: an unknown layout is an error naming the four layouts', JSON.stringify(badLayout));
    ok(JMD.lint(JMD.parse(onePager)).every(f => f.level !== 'error'), 'lint: the one-pager sample is clean');
    execSync('node tools/build.mjs decks/samples/one-pager.jmd', BUILD);
    p = await open('file://' + join(root, 'build/one-pager.james-jmd.html')); await p.settle(300);
    ok(await p.eval('document.body.classList.contains("layout-doc")') && await p.eval('document.querySelectorAll(".slide").length') === 3, 'a Doc renders with the layout-doc class, 3 pages');
    ok(await p.eval('[...document.querySelectorAll(".slide")].every(s => getComputedStyle(s).opacity === "1")'), 'every page is visible at once: the pages stack, nothing hides');
    const rect = JSON.parse(await p.eval('(r => JSON.stringify({w: r.width, h: r.height}))(document.querySelector(".slide").getBoundingClientRect())'));
    ok(Math.abs(rect.h / rect.w - 297 / 210) < 0.01 && rect.w <= 794, `a page has the A4 ratio on screen (${Math.round(rect.w)}×${Math.round(rect.h)})`);
    ok(await p.eval('[...document.querySelectorAll("style")].some(s => /@page\\s*\\{\\s*size:\\s*210mm 297mm/.test(s.textContent))'), 'the runtime switched @page to A4 for print');
    ok(await p.eval('document.querySelector(".slide .slide-tag").textContent') === '01 / 03' && await p.eval('document.querySelector(".slide .slide-foot").textContent') === 'Northwind Ops — the one-pager', 'page chrome: `01 / 03` in the corner, the document title in the footer');
    ok(await p.eval('document.getElementById("counter").textContent') === '01 / 3' && await p.eval('document.body.classList.contains("motion-none")'), 'counter 01 / 3; no motion on a Doc');
    await p.key('ArrowRight'); await p.settle(200);
    ok(await p.eval('jamesJmd.state.i') === 1 && await p.eval('document.getElementById("stage").scrollTop') > 100 && await p.eval('document.querySelector(".slide.is-active .slide-tag").textContent') === '02 / 03', '→ scrolls the next page to the top of the window and makes it current');
    await p.eval('document.getElementById("stage").scrollTo(0, 0); true'); await p.settle(300);
    ok(await p.eval('jamesJmd.state.i') === 0, 'scrolling back up makes page 01 current again');
    await p.key('I');
    ok((await p.eval('document.getElementById("info").textContent')).includes('doc · A4 portrait, 3 pages'), 'the file card says the layout');
    await p.key('Escape');
    ok(JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).every(f => f.rule !== 'overflow'), 'no overflow on the sample pages (limit 1730 units)');
    // a page that runs past the paper: six metrics blocks, measured in the DOM against the page's own height
    const tall = onePager.replace(/\n---\nintent: decide[\s\S]*$/, '') + '\n---\nnotes: too much.\n---\n## Too much for one page\n' + Array(6).fill('::: metrics\n- 1 | one | a\n- 2 | two | b\n- 3 | three | c\n- 4 | four | d\n:::\n').join('\n');
    await p.eval(`jamesJmd.load(${JSON.stringify(tall)}, "tall.jmd"); true`); await p.settle(400);
    const over = JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).filter(f => f.rule === 'overflow');
    ok(over.length === 1 && over[0].slide === 3 && /limit 1730/.test(over[0].message) && /new page with `---`/.test(over[0].message), 'overflow on a Doc page: measured against the A4 page, the message suggests a new page', JSON.stringify(over));
    await p.eval('window.print = () => { window.__printed = (window.__printed || 0) + 1; }; true');
    await p.eval(`jamesJmd.load(${JSON.stringify(onePager)}, "one-pager.jmd"); true`); await p.settle(300);
    await p.key('D'); await p.key('P');
    ok(await p.eval('window.__printed') === 1, 'P prints a clean Doc');
    // back to a Slide deck in the same window: the stage returns to the single-slide stage
    await p.eval(`jamesJmd.load(${JSON.stringify(fixed)}, "four-blocks.jmd"); true`); await p.settle(200);
    ok(!(await p.eval('document.body.classList.contains("layout-doc")')) && await p.eval('[...document.querySelectorAll("style")].every(s => !/210mm/.test(s.textContent))') && await p.eval('document.querySelector(".slide .slide-tag").textContent') === '01', 'loading a Slide deck after a Doc restores the Slide stage and print size');
    await p.close();
    // the CLI: an A4 PDF, A4 PNGs
    cli('pdf decks/samples/one-pager.jmd -o build/one-pager.pdf');
    const docInfo = execSync('pdfinfo build/one-pager.pdf', { cwd: root }).toString();
    ok(/Pages:\s+3/.test(docInfo) && /\(A4\)/.test(docInfo), 'jmd pdf: 3 pages, A4', docInfo);
    cli('render decks/samples/one-pager.jmd -o build/one-pager-pages');
    const png = readFileSync(join(root, 'build/one-pager-pages/slide-02.png'));
    ok(png.readUInt32BE(16) === 793 && png.readUInt32BE(20) === 1122, 'jmd render: each page is a 793×1122 PNG (A4 at 96 dpi)', png.readUInt32BE(16) + '×' + png.readUInt32BE(20));
    ok(JSON.parse(cli('lint decks/samples/one-pager.jmd --dom --json')).ok === true, 'jmd lint --dom: the sample passes the DOM overflow check');

    // Story: 9:16, one screen per `---`, presented like slides, posted as 1080×1920 images or a carousel PDF
    const carousel = readFileSync(join(root, 'decks/samples/carousel.jmd'), 'utf8');
    ok(JMD.layout(JMD.parse(carousel)) === 'story' && JMD.lint(JMD.parse(carousel)).every(f => f.level !== 'error'), 'story: the carousel sample is clean');
    execSync('node tools/build.mjs decks/samples/carousel.jmd', BUILD);
    p = await open('file://' + join(root, 'build/carousel.james-jmd.html')); await p.settle(300);
    ok(await p.eval('document.body.classList.contains("layout-story")') && await p.eval('document.querySelectorAll(".slide").length') === 6 && await p.eval('document.querySelectorAll(".slide.is-active").length') === 1, 'a Story renders 6 screens, one active at a time');
    const srect = JSON.parse(await p.eval('(r => JSON.stringify({w: r.width, h: r.height}))(document.querySelector(".slide").getBoundingClientRect())'));
    ok(Math.abs(srect.h / srect.w - 16 / 9) < 0.01, `a screen has the 9:16 ratio (${Math.round(srect.w)}×${Math.round(srect.h)})`);
    ok(await p.eval('[...document.querySelectorAll("style")].some(s => /@page\\s*\\{\\s*size:\\s*1080px 1920px/.test(s.textContent))'), 'the runtime switched @page to 1080×1920 px');
    await p.key('ArrowRight');
    ok(await p.eval('document.querySelector(".slide.is-active .slide-tag").textContent') === '02 / 06' && !(await p.eval('document.body.classList.contains("motion-none")')), '→ moves to screen 02 / 06; motion stays on (a story is presented)');
    ok(JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).every(f => f.rule !== 'overflow'), 'no overflow on the sample screens (limit 1060 units)');
    const tallStory = carousel.replace(/\n---\nintent: act[\s\S]*$/, '') + '\n---\nnotes: too much.\n---\n## Too much for one screen\n' + Array(3).fill('::: cards\n- One | a line of text\n- Two | a line of text\n- Three | a line of text\n:::\n').join('\n');
    await p.eval(`jamesJmd.load(${JSON.stringify(tallStory)}, "tall.jmd"); true`); await p.settle(400);
    const sover = JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).filter(f => f.rule === 'overflow' && !f.block);
    ok(sover.length === 1 && sover[0].slide === 6 && /limit 1060/.test(sover[0].message) && /split the screen/.test(sover[0].message), 'overflow on a Story screen: measured against the 9:16 screen, the message says to split it', JSON.stringify(sover));
    await p.close();
    cli('pdf decks/samples/carousel.jmd -o build/carousel.pdf');
    const carInfo = execSync('pdfinfo build/carousel.pdf', { cwd: root }).toString();
    ok(/Pages:\s+6/.test(carInfo) && /810 x 1440 pts/.test(carInfo), 'jmd pdf: 6 pages of 1080×1920 px (810×1440 pt) — a carousel', carInfo);
    cli('render decks/samples/carousel.jmd -o build/carousel-screens');
    const spng = readFileSync(join(root, 'build/carousel-screens/slide-03.png'));
    ok(spng.readUInt32BE(16) === 1080 && spng.readUInt32BE(20) === 1920, 'jmd render: each screen is a 1080×1920 PNG', spng.readUInt32BE(16) + '×' + spng.readUInt32BE(20));

    // Webpage: one continuous page, `---` opens a section as tall as its content
    const landing = readFileSync(join(root, 'decks/samples/landing.jmd'), 'utf8');
    ok(JMD.layout(JMD.parse(landing)) === 'webpage' && JMD.lint(JMD.parse(landing)).every(f => f.level !== 'error'), 'webpage: the landing sample is clean');
    execSync('node tools/build.mjs decks/samples/landing.jmd', BUILD);
    p = await open('file://' + join(root, 'build/landing.james-jmd.html')); await p.settle(300);
    const heights = JSON.parse(await p.eval('JSON.stringify([...document.querySelectorAll(".slide")].map(s => Math.round(s.getBoundingClientRect().height)))'));
    ok(await p.eval('document.body.classList.contains("layout-webpage")') && heights.length === 6 && new Set(heights).size > 2 && heights.every(h => h > 100), `a Webpage renders 6 sections, each as tall as its content (${heights.join(', ')})`);
    ok(await p.eval('[...document.querySelectorAll(".slide")].every(s => getComputedStyle(s).opacity === "1")') && await p.eval('[...document.querySelectorAll(".slide-chrome")].filter(c => getComputedStyle(c).display !== "none").length') === 1 && await p.eval('[...document.querySelectorAll(".slide-tag")].every(t => getComputedStyle(t).display === "none")'), 'every section is visible; the brand chrome once, at the top; no page numbers');
    ok(await p.eval('[...document.querySelectorAll("style")].some(s => /210mm 297mm/.test(s.textContent))'), 'printed, a Webpage flows onto A4');
    const tallWeb = landing + '\n---\nnotes: long.\n---\n## A long section\n' + Array(6).fill('::: metrics\n- 1 | one | a\n- 2 | two | b\n- 3 | three | c\n- 4 | four | d\n:::\n').join('\n');
    await p.eval(`jamesJmd.load(${JSON.stringify(tallWeb)}, "tall.jmd"); true`); await p.settle(400);
    ok(JSON.parse(await p.eval('JSON.stringify(jamesJmd.state.lint)')).every(f => f.rule !== 'overflow') && await p.eval('document.querySelectorAll(".slide").length') === 7, 'a Webpage section has no bottom: six blocks in a row is not an overflow');
    await p.close();
    cli('pdf decks/samples/landing.jmd -o build/landing.pdf');
    const landInfo = execSync('pdfinfo build/landing.pdf', { cwd: root }).toString();
    ok(/Pages:\s+[12]\b/.test(landInfo) && /\(A4\)/.test(landInfo), 'jmd pdf: a Webpage prints onto one or two A4 sheets', landInfo);
    cli('render decks/samples/landing.jmd -o build/landing-sections');
    const wpng = readFileSync(join(root, 'build/landing-sections/slide-02.png')), wpng3 = readFileSync(join(root, 'build/landing-sections/slide-03.png'));
    ok(wpng.readUInt32BE(16) === 1280 && wpng.readUInt32BE(20) > 300 && wpng3.readUInt32BE(16) === 1280 && wpng3.readUInt32BE(20) !== wpng.readUInt32BE(20), `jmd render: a section is a 1280 × its-own-height PNG (${wpng.readUInt32BE(20)}, ${wpng3.readUInt32BE(20)})`);
  }

  console.log('\n14. Security: Chromium renders hostile content (spec/security.md §3)');
  {
    const { assertPublicHost, isPrivateAddress, requestOnce, guard, LIMITS } = await import('../lib/jmd.mjs');
    const { BLOCKED_URLS, sweep } = await import('./cdp.mjs');
    const { resolveAssets } = await import('./build.mjs');
    // a page that tries to reach a local server four ways; the render page (network: false) reaches nothing
    let hits = []; const pixel = createServer((q, r) => { hits.push(q.url); r.end('x'); }).listen(8797);
    const netPath = join(tmp, 'net.html');
    writeFileSync(netPath, '<!doctype html><html><body><img src="http://127.0.0.1:8797/img"><link rel="stylesheet" href="http://127.0.0.1:8797/css"><script>fetch("http://127.0.0.1:8797/fetch").catch(()=>{}); new Image().src="http://127.0.0.1:8797/beacon"; document.body.append("rendered")</script></body></html>');
    const failed = [];
    p = await browser.page('file://' + netPath, { network: false }); p.on('Network.loadingFailed', e => failed.push(e.blockedReason)); await p.settle(300);
    ok(hits.length === 0 && (await p.eval('document.body.lastChild.textContent')) === 'rendered', 'a render page reaches no host: image, stylesheet, fetch and beacon all blocked, the page still renders', hits.join(','));
    await p.close();
    p = await browser.page('file://' + netPath); await p.settle(300);
    ok(hits.length >= 3, 'the same page with the network on hits the server (the block above was the block, not a test artefact)', hits.join(','));
    await p.close(); pixel.close();
    ok(BLOCKED_URLS.includes('http://*') && BLOCKED_URLS.includes('https://*') && BLOCKED_URLS.includes('ws://*') && !BLOCKED_URLS.some(u => /^(file:|data:)/.test(u)), 'the block covers every scheme but file:// and data:');
    // the browser dies with its process: a node ended by SIGTERM (a client closing an MCP server) or Ctrl-C leaves no Chrome behind
    {
      const child = spawn(process.execPath, ['-e', 'import("./tools/cdp.mjs").then(async ({ Browser }) => { const b = await Browser.launch(); console.log(b.proc.pid + " " + b.profile); setInterval(() => {}, 1000); })'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
      const [pid, profile] = (await new Promise(r => child.stdout.once('data', d => r(String(d).trim())))).split(' ');
      const isAlive = p => { try { process.kill(+p, 0); return true; } catch { return false; } };
      child.kill('SIGTERM');
      for (let i = 0; i < 30 && isAlive(pid); i++) await new Promise(r => setTimeout(r, 100));
      ok(!isAlive(pid) && !isAlive(child.pid), 'SIGTERM on the node that launched Chrome ends Chrome too (no orphan reparented to init)');
      sweep(); // the parent quit before Chrome had left its profile: the next launch's sweep takes the folder
      ok(!existsSync(profile) || Date.now() - statSync(profile).mtimeMs < 60_000, 'its profile is removed, or younger than the minute a launch in progress is granted');
    }
    // the sweep: a profile whose Chrome is gone leaves; one just created, without a lock yet, stays
    {
      const dead = mkdtempSync(join(tmpdir(), 'jmd-chrome-')); symlinkSync('host-2147483000', join(dead, 'SingletonLock'));
      const fresh = mkdtempSync(join(tmpdir(), 'jmd-chrome-'));
      sweep();
      ok(!existsSync(dead) && existsSync(fresh), 'sweep: a profile locked by a dead pid is removed, a fresh one without a lock is kept');
      rmSync(fresh, { recursive: true, force: true });
    }
    // the deck the samples build: a deck with an https image renders and lints without a request (lib goes through network: false)
    const jmdLib = await import('../lib/jmd.mjs');
    hits = []; const tracker = createServer((q, r) => { hits.push(q.url); r.end('x'); }).listen(8798);
    const tracked = fixed.replace('::: metrics', '![pixel](http://127.0.0.1:8798/t.png)\n\n::: metrics');
    const rl = await jmdLib.lintDom(tracked);
    ok(hits.length === 0 && rl.slides === 4, 'jmd lint (dom) on a deck pointing at a tracker: zero outgoing request', hits.join(','));
    tracker.close(); jmdLib.closeBrowser();
    // SSRF: the fetch of a brand or a logo never joins the inside
    const refused = async u => { try { await assertPublicHost(u); return null; } catch (e) { return e.message; } };
    ok((await refused('https://127.0.0.1/brand.yaml') || '').includes('private address') && (await refused('https://169.254.169.254/latest/meta-data') || '').includes('private address') && (await refused('https://localhost/x') || '').includes('private address') && (await refused('https://10.0.0.1/x')) && (await refused('https://[::1]/x')), 'brand fetch: loopback, the metadata endpoint, localhost, RFC 1918 and ::1 are refused');
    ok(['0.0.0.0', '100.64.1.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '::ffff:10.0.0.1', 'fd12::1', 'fe80::1'].every(isPrivateAddress) && ['8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:1.1.1.1'].every(a => !isPrivateAddress(a)), 'private ranges: v4, v4-mapped v6, unique-local, link-local — and public ones pass');
    ok((await refused('https://example.com/brand.yaml')) === null, 'a public host passes');
    // the IPv6 forms that carry an IPv4 — what the URL parser hands the guard: `[::ffff:127.0.0.1]` arrives as `[::ffff:7f00:1]`
    const hex = ['https://[::ffff:7f00:1]/x', 'https://[::ffff:a9fe:a9fe]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[64:ff9b::7f00:1]/x', 'https://[64:ff9b:1::a9fe:a9fe]/x', 'https://[2002:7f00:1::]/x', 'https://[2001:0:1234::1]/x', 'https://[::]/x', 'https://[::ffff:0:0]/x'];
    const hexVerdicts = await Promise.all(hex.map(refused));
    ok(hexVerdicts.every(v => (v || '').includes('private address')), 'IPv4 inside IPv6 — mapped (hex and dotted), NAT64, 6to4, Teredo — is read and refused', hex.filter((_, i) => !hexVerdicts[i]).join(' '));
    ok(['::ffff:808:808', '::ffff:1.1.1.1', '2606:4700::1111', '2002:808:808::', '64:ff9b::808:808'].every(a => !isPrivateAddress(a)) && isPrivateAddress('not-an-address'), 'public IPv6 forms pass, an unreadable address is refused');
    // one resolution: the socket goes to the address the guard vetted, whatever DNS says next (a rebinding answer changes nothing)
    const pinHost = createServer((q, r) => r.end('pinned: yes')).listen(8798);
    const pinnedBody = await requestOnce('http://never-resolves.invalid:8798/brand.yaml', [{ address: '127.0.0.1', family: 4 }], 10_000).then(r => r.body.toString(), e => 'error: ' + e.message);
    pinHost.close();
    ok(pinnedBody === 'pinned: yes', 'the fetch connects to the vetted address, not to a second DNS resolution (a host that does not resolve is reached through its pinned address)', pinnedBody);
    const bigHost = createServer((q, r) => { r.write('x'.repeat(4000)); r.end('x'.repeat(4000)); }).listen(8799);
    const capped = await requestOnce('http://never-resolves.invalid:8799/big', [{ address: '127.0.0.1', family: 4 }], 5000).then(() => 'read it all', e => e.message);
    bigHost.close();
    ok(/larger than 5000/.test(capped), 'a body above the cap is cut while it streams, not after it was read', capped);
    // ceilings before the browser
    const many = '---\nformat: jmd/1\n---\n' + '---\nbg: white\n---\n## Slide\n'.repeat(LIMITS.slides + 1);
    let gErr = ''; try { guard(many); } catch (e) { gErr = e.message; } ok(gErr.includes(String(LIMITS.slides)), 'more than 200 slides is refused with the limit in the message');
    gErr = ''; try { guard('x'.repeat(LIMITS.sourceBytes + 1)); } catch (e) { gErr = e.message; } ok(gErr.includes('2 MB'), 'a source above 2 MB is refused with the limit in the message');
    gErr = ''; try { await jmdLib.build(many); } catch (e) { gErr = e.message; } ok(gErr.includes('200'), 'build refuses too, before touching anything');
    const heavy = join(tmp, 'heavy'); mkdirSync(heavy, { recursive: true });
    for (let i = 0; i < 3; i++) writeFileSync(join(heavy, `big${i}.png`), Buffer.alloc(7 * 1024 * 1024, i));
    gErr = ''; try { resolveAssets('---\nformat: jmd/1\n---\n## x\n![a](big0.png)\n![b](big1.png)\n![c](big2.png)\n', heavy); } catch (e) { gErr = e.message; }
    ok(gErr.includes('20 MB'), 'images above 20 MB together are refused with the limit in the message');
    { // the ceiling is checked on sizes: a sparse 3 GB file is refused without being read (reading it would take seconds and gigabytes)
      const sparse = join(heavy, 'sparse.png'); const fd = openSync(sparse, 'w'); ftruncateSync(fd, 3 * 1024 * 1024 * 1024); closeSync(fd);
      const t0 = Date.now(); gErr = ''; try { resolveAssets('---\nformat: jmd/1\n---\n## x\n![a](sparse.png)\n', heavy); } catch (e) { gErr = e.message; }
      ok(gErr.includes('20 MB') && Date.now() - t0 < 500, 'a 3 GB file is refused by its size, before it is read', `${Date.now() - t0} ms`);
    }
    { // a source with a header and no slide renders to a small image, not to a 0×0 canvas or a rejected viewport
      const empty = await jmdLib.render('---\nformat: jmd/1\nlayout: webpage\n---\n', { scale: 0.5 });
      const sheet = await jmdLib.render('---\nformat: jmd/1\n---\n', { scale: 0.5, sheet: true });
      ok(Array.isArray(empty) && empty.length === 0 && Buffer.isBuffer(sheet) && sheet.length > 60, 'render with zero slides: no per-slide image, and a sheet that is a valid PNG', `${empty && empty.length} / ${sheet && sheet.length}`);
    }
    ok(readFileSync(join(root, 'tools/cdp.mjs'), 'utf8').includes("'--disable-extensions'"), 'Chromium opens with the hardening flags');
    /* The container is the service's, not the format's: this file ships without mcp/ (PUBLIC.md), so the assertion is made
       where the Dockerfile is and skipped where it is not — never dropped, never a failure for the absence. */
    if (existsSync(join(root, 'mcp/Dockerfile'))) {
      const dockerfile = readFileSync(join(root, 'mcp/Dockerfile'), 'utf8');
      ok(!dockerfile.includes('\nUSER root') && /\nUSER jmd\n/.test(dockerfile), 'the container runs as jmd');
    }
  }

  // §15 — image banks (spec/images.md): a brand declares them, a deck says img:<bank>/<slug>, the build fetches and embeds; refusals are linter errors
  {
    const jmdLib = await import('../lib/jmd.mjs'); const im = await import('../tools/images.mjs');
    process.env.JMD_BRAND_HTTP = '1'; process.env.JMD_CACHE_DIR = join(tmp, 'imgcache');
    const png = readFileSync(join(root, 'decks/samples/assets', readdirSync(join(root, 'decks/samples/assets')).find(f => /\.(png|svg)$/.test(f))));
    const isSvg = png.slice(0, 5).toString() === '<?xml' || png.slice(0, 4).toString() === '<svg';
    const ext = isSvg ? 'svg' : 'png', mime = isSvg ? 'image/svg+xml' : 'image/png';
    let indexHits = 0, fileHits = 0;
    const index = `# test bank\n- slug: hero-team\n  file: photos/hero-team.${ext}\n  caption: L'équipe au complet, bras levés, en extérieur\n  tags: [équipe, joie, extérieur]\n  kind: photo\n  fit: [cover, wide]\n  status: approved\n  source: test\n  added: 2026-09-19\n\n- slug: old-logo\n  file: logos/old-logo.${ext}\n  caption: Ancien logo\n  tags: [logo]\n  kind: logo\n  fit: [inline]\n  status: retired\n  source: test\n  added: 2026-01-01\n\n- slug: sketch\n  file: illustrations/sketch.${ext}\n  caption: Un croquis pas encore validé, réunion d'équipe\n  tags: [croquis, réunion]\n  kind: illustration\n  fit: [right]\n  status: draft\n  source: test\n  added: 2026-09-19\n\n- slug: not-an-image\n  file: photos/not-an-image.${ext}\n  caption: Un fichier qui ment sur son type\n  tags: [piège]\n  kind: photo\n  fit: [right]\n  status: approved\n  source: test\n  added: 2026-09-19\n`;
    const bank = createServer((q, r) => {
      if (q.url === '/bank/images.yaml') { indexHits++; r.setHeader('content-type', 'text/yaml'); r.end(index); }
      else if (q.url === `/bank/photos/not-an-image.${ext}`) { r.setHeader('content-type', 'text/html'); r.end('<html>nope</html>'); }
      else if (/^\/bank\/(photos|logos|illustrations)\//.test(q.url)) { fileHits++; r.setHeader('content-type', mime); r.end(png); }
      else if (q.url === '/pic/ok.png') { r.setHeader('content-type', 'application/octet-stream'); r.end(png); } // the server's word is not trusted: the bytes are
      else if (q.url === '/pic/page.png') { r.setHeader('content-type', 'image/png'); r.end('<html>nope</html>'); }
      else { r.statusCode = 404; r.end(); }
    }).listen(8796);
    const brandYaml = 'name: Bank\nprimary: "#112233"\nimages:\n  test: http://127.0.0.1:8796/bank/\n';
    const brand = await jmdLib.resolveBrand(brandYaml);
    ok(brand.banks && brand.banks.test === 'http://127.0.0.1:8796/bank/', 'a brand declares its banks: images: { prefix: folder } parsed and normalized with a trailing slash');
    const deck = (refs) => '---\nformat: jmd/1\ntitle: Bank\n---\n# Bank\n\n' + refs.map((r, i) => `---\n---\n## Slide ${i + 1}\n\n![x](${r}){.right}`).join('\n\n') + '\n'; // one image per slide (one .right each)
    // lint: every kind of refusal is a missing-asset error that says why; a draft is a warning; a good one passes
    const l = jmdLib.lint(deck(['img:test/hero-team', 'img:test/nope', 'img:test/old-logo', 'img:test/sketch', 'img:other/x', 'img:test/not-an-image']), { images: await jmdLib.bankImages(deck(['img:test/hero-team', 'img:test/nope', 'img:test/old-logo', 'img:test/sketch', 'img:other/x', 'img:test/not-an-image']), brand) });
    const msg = rule => l.findings.filter(f => f.rule === rule).map(f => f.message);
    ok(l.errors === 4 && msg('missing-asset').some(m => /no image "nope"/.test(m)) && msg('missing-asset').some(m => /retired/.test(m)) && msg('missing-asset').some(m => /unknown bank "other"/.test(m)) && msg('missing-asset').some(m => /not an image/.test(m)), 'lint: an unknown slug, a retired image, an unknown bank, a file that is not an image — four missing-asset errors that say why', JSON.stringify(msg('missing-asset')));
    ok(l.warnings === 1 && msg('image-draft')[0].includes('draft'), 'lint: a draft image passes with a warning');
    ok(!l.findings.some(f => f.level === 'error' && /hero-team/.test(f.message)), 'lint: an approved image is not an error');
    const noBank = jmdLib.lint(deck(['img:test/hero-team']), { images: await jmdLib.bankImages(deck(['img:test/hero-team']), 'slate') });
    ok(noBank.errors === 1 && noBank.findings.find(f => f.level === 'error').message.includes('no image bank declared'), 'a brand without banks: img: is an error naming the cause (slate declares none)');
    // build: the image is embedded as a data URI, the deck depends on nothing
    const html = await jmdLib.build(deck(['img:test/hero-team']), { brand, name: 'bank.jmd' });
    ok(html.includes(`"img:test/hero-team":"data:${mime};base64,`) && !html.includes('127.0.0.1:8796/bank/photos'), 'build: the bank image is embedded as a data URI, no URL left in the page');
    // cache: a second build reads the index and the file from disk, not from the bank
    const before = { i: indexHits, f: fileHits };
    await jmdLib.build(deck(['img:test/hero-team']), { brand, name: 'bank.jmd' });
    ok(indexHits === before.i && fileHits === before.f && existsSync(process.env.JMD_CACHE_DIR), 'cache: the second build touches neither the index nor the file on the bank');
    // search: words against caption and tags, accents ignored, kind narrows, retired never shown
    const s1 = await jmdLib.imageSearch(brand, 'equipe exterieur');
    ok(s1.hits.length >= 1 && s1.hits[0].ref === 'img:test/hero-team' && s1.hits[0].url.endsWith(`/bank/photos/hero-team.${ext}`), 'search: "equipe exterieur" finds the team photo first, with its img: reference and file URL', JSON.stringify(s1.hits.map(h => h.ref)));
    const s2 = await jmdLib.imageSearch(brand, 'logo');
    ok(!s2.hits.some(h => h.ref === 'img:test/old-logo'), 'search: a retired image is never proposed');
    const s3 = await jmdLib.imageSearch(brand, 'réunion', { kind: 'illustration' });
    ok(s3.hits.length === 1 && s3.hits[0].status === 'draft', 'search: kind narrows, a draft is shown with its status');
    // vendor: the images copied next to the deck, the source rewritten, the deck then builds from the folder alone
    const vdir = join(tmp, 'vendor'); mkdirSync(vdir, { recursive: true });
    const v = await jmdLib.vendor(deck(['img:test/hero-team', 'img:test/nope']), brand, vdir);
    ok(v.written.length === 1 && v.written[0] === `assets/test/hero-team.${ext}` && existsSync(join(vdir, v.written[0])) && v.jmd.includes(`(assets/test/hero-team.${ext})`) && !v.jmd.includes('(img:test/hero-team)') && v.refused['img:test/nope'], 'vendor: the resolvable image copied to assets/<bank>/<slug>.<ext>, the reference rewritten, the unresolvable one reported');
    const vlint = jmdLib.lint(v.jmd.replace(/!\[x\]\(img:test\/nope\)\{\.right\}\n\n?/, ''), { dir: vdir });
    ok(vlint.errors === 0, 'a vendored deck lints from its folder alone, no bank needed', JSON.stringify(vlint.findings.filter(f => f.level === 'error')));
    const byKindWord = await jmdLib.imageSearch(brand, 'photos', {});
    ok(byKindWord.hits.length >= 1 && byKindWord.hits.every(h => h.kind === 'photo'), 'search: the kind as a word of the query ("photos", "logo client") finds that kind without the kind argument', JSON.stringify(byKindWord.hits.map(h => h.slug + ':' + h.kind)));
    // the reference form is strict
    ok(!im.REF.test('img:test/Hero') && !im.REF.test('img:test/hero.png') && !im.REF.test('img:hero') && im.REF.test('img:test/hero-team'), 'img:<bank>/<slug>: lowercase, dashes, no extension, no shortcut');
    // fetchBytes: https only, a body above the cap refused
    ok(await im.fetchBytes('http://example.com/x').then(() => false, e => /https only/.test(e.message)), 'fetchBytes refuses plain http outside tests\' loopback');
    // an image by URL (spec/images.md): fetched through the door, checked by its bytes, embedded; every refusal says why
    const U = 'http://127.0.0.1:8796/pic/';
    const urlLint = await jmdLib.lintDom(deck([U + 'ok.png', U + 'page.png', U + 'missing.png', 'http://example.com/p.png', 'https://10.0.0.1/p.png']), { brand });
    const why = Object.fromEntries(urlLint.findings.filter(f => f.rule === 'missing-asset').map(f => [f.slide, f.message]));
    ok(urlLint.errors === 4 && !why[2] && /not an image/.test(why[3]) && /HTTP 404/.test(why[4]) && /https only/.test(why[5]) && /private address/.test(why[6]), 'URL images: a good one passes; a page, a 404, plain http and a private host are missing-asset errors with the reason', JSON.stringify(why));
    const urlHtml = await jmdLib.build(deck([U + 'ok.png']), { brand });
    ok(urlHtml.includes(`"${U}ok.png":"data:${mime};base64,`) && !urlHtml.includes(`src="${U}`), 'build: the URL image is embedded as a data URI — the deck never loads it live');
    const urlVendor = await jmdLib.vendor(deck([U + 'ok.png']), brand, vdir);
    ok(urlVendor.written.length === 1 && /^assets\/url\/ok-[0-9a-f]{8}\.(png|svg)$/.test(urlVendor.written[0]) && existsSync(join(vdir, urlVendor.written[0])) && urlVendor.jmd.includes('(' + urlVendor.written[0] + ')'), 'vendor: a URL image lands in assets/url/, the source rewritten', JSON.stringify(urlVendor.written));
    ok(im.sniff(Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(8), 'latin1')) === 'image/png' && im.sniff(Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x">')) === 'image/svg+xml' && im.sniff(Buffer.from('<html><body>not an image</body></html>')) === null && im.sniff(Buffer.from('RIFF....WEBPVP8 ')) === 'image/webp', 'sniff: png, svg (after a prolog and a comment), webp by their bytes; html is not an image');
    bank.close();
  }

  // Pixel comparison against the internal reference deck, kept out of the repo (decks/private/, gitignored).
  const REF = join(root, 'decks/private/reference.jmd');
  if (existsSync(REF) && process.env.REFERENCE_PDF && existsSync(process.env.REFERENCE_PDF)) {
    console.log('\n11. Pixel comparison with the private reference deck');
    cli('pdf decks/private/reference.jmd -o build/reference.pdf');
    const cmp = execSync(`python3 tools/compare.py build/reference.pdf "${process.env.REFERENCE_PDF}" ${process.env.REFERENCE_PAGES || '4,5,6,16'}`, { cwd: root }).toString();
    const pct = [...cmp.matchAll(/^\s+\d+\s+\d+\s+([\d.]+)/gm)].map(x => +x[1]);
    ok(pct[0] < 0.05 && pct[2] < 0.05 && pct[3] < 0.05, 'timeline, statement, compare identical to the reference', cmp);
    ok(pct[1] < 11, 'metrics within the known 16/48 px eyebrow gap (decision 1)', cmp);
  } else console.log('\n  – no private reference deck / REFERENCE_PDF, pixel comparison skipped');
  if (!HOUSE) console.log('  – no house brand in this tree, the three type-calibrated assertions skipped (the two Garet faces, two click-to-edit gestures)');
} catch (e) {
  failed++; console.log('  ✗ crashed: ' + e.stack);
} finally {
  browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
