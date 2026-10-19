/* james-jmd.html — the browser application: navigation, notes, linter panel, open/drop, print, self-contained export.
   Depends on jmd-core.js (globalThis.JMD), inlined before this file by the build. */
(function () {
  'use strict';
  var RUNTIME_VERSION = JMD.VERSION;
  // when this file was made — a file kept on a disk carries the runtime of that day, and the Info panel says which (generator meta, tools/build.mjs)
  var BUILT = (/frozen (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec((document.querySelector('meta[name=generator]') || {}).content || '') || [])[1] || '';
  var esc = JMD.esc, inline = JMD.inline, parse = JMD.parse, render = JMD.render, lint = JMD.lint, fitOverflow = JMD.fitOverflow, lintOverflow = JMD.lintOverflow;
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ───────────────────────── application ───────────────────────── */
  var track = document.getElementById('track'), stage = document.getElementById('stage');
  var counter = document.getElementById('counter');
  var notesEl = document.getElementById('notes');
  var notesTxt = document.getElementById('notes-txt');
  var openEl = document.getElementById('open');
  var hud = document.getElementById('hud');
  var brand = {}, assets = {};
  try { brand = JSON.parse(document.getElementById('brand').textContent || '{}'); } catch (e) { }
  try { assets = JSON.parse(document.getElementById('assets').textContent || '{}'); } catch (e) { }
  var template = '<!doctype html>\n' + document.documentElement.outerHTML; // pristine template, for the self-contained export
  /* Where one is, on a touch screen (1.17.0): no key to press, no counter one reads at a glance — the segmented bar of a story,
     one segment a screen, the ones seen filled; a tap on a segment goes there. Shown by engine.css on a coarse pointer only. */
  var progress = document.createElement('nav'); progress.id = 'progress'; progress.setAttribute('aria-label', 'Screens'); document.body.appendChild(progress);
  /* The bar is white over the dark band around a screen and over a dark screen, ink over a light one (2026-10-07: on a
     white slide it was gone). What is under it is measured, not guessed: a phone less tall than an iPhone puts the bar on the
     screen itself, a taller one in the band. */
  function tintProgress() {
    var sec = state.slides[state.i]; if (!sec || !progress.children.length) return;
    var pr = progress.getBoundingClientRect(), sr = sec.getBoundingClientRect(), light = false;
    if (pr.height && pr.bottom > sr.top && pr.top < sr.bottom) {
      var c = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(sec).backgroundColor);
      if (c) light = (0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3]) / 255 > 0.6;
    }
    progress.classList.toggle('is-light', light);
  }
  window.addEventListener('resize', function () { setTimeout(tintProgress, 50); });
  progress.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) show(Array.prototype.indexOf.call(progress.children, b)); });
  var editEl = document.getElementById('edit'), editSrc = document.getElementById('edit-src'), editLint = document.getElementById('edit-lint'), editTitle = document.getElementById('edit-title');
  var state = { doc: null, src: '', slides: [], i: 0, notesOpen: false, lint: [], editing: false, dirty: false, fileHandle: null, motion: null, layout: 'slide', editTarget: 'slide' }; // editTarget: 'slide' (the current slide's lines) | 'doc' (the document header)
  var page = function () { return JMD.PAGES[state.layout] || JMD.PAGES.slide; };
  var isDoc = function () { return page().flow === 'scroll'; }; // Doc and Webpage: the pages stack and scroll; Slide and Story: one screen at a time
  /* A phone held upright (1.17.0): a 16:9 slide on a screen 390 px wide is a strip whose body text is five pixels tall, stacked
     or not. The same source is also a Story — 9:16, made for that screen — so there a Slide deck is drawn as one, one screen at
     a time, a tap or a swipe to turn. Only for reading: nothing is written back, the source keeps `layout: slide`, and the
     phone turned sideways gets the slides again. A touch screen only, so a narrow window on a desktop stays what it is. */
  var PHONE = window.matchMedia ? window.matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 700px)') : null;
  function reflows(doc) { return JMD.layout(doc) === 'slide' && !!PHONE && PHONE.matches && !state.editing; }

  function fit() {
    var pad = state.notesOpen ? 150 : 0, side = state.editing ? 480 : 0, pg = page(), W = pg.w * pg.zoom, H = pg.h * pg.zoom; // the page in screen px
    stage.style.right = side + 'px'; // the stage shrinks to the free area, so the slide is centered in it (a margin would overflow under the panel)
    if (isDoc()) {
      // the pages shrink to the window's width, never grow past their own size
      var z = Math.min(1, (window.innerWidth - side - 48) / W);
      track.style.transform = ''; track.style.zoom = z; track.style.marginBottom = '0';
      stage.style.bottom = state.notesOpen ? pad + 'px' : '0';
      return;
    }
    var s = Math.min((window.innerWidth - side) / W, (window.innerHeight - pad) / H);
    track.style.zoom = ''; stage.style.bottom = '0';
    track.style.transform = 'scale(' + s + ')';
    track.style.marginBottom = state.notesOpen ? (pad * 0.6) + 'px' : '0';
  }
  /* ── motion: one global mode for the whole deck (brand default, M cycles it, remembered in this browser); never in the .jmd ── */
  var MOTIONS = ['none', 'soft', 'slide', 'zoom', 'step'];
  var STEP_ITEMS = '.metric, .card, .tl-step, .col, .slide-pill, .logos li, .logos img, .prose li, .prose p, .figure, .dg-step, .dg-card'; // a diagram: a node with the edges that reach it, or a form's card // the lead arrives with the title
  function setMotion(mode, remember) {
    if (MOTIONS.indexOf(mode) < 0) mode = 'soft';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) mode = 'none';
    state.motion = mode;
    MOTIONS.forEach(function (m) { document.body.classList.toggle('motion-' + m, m === mode && !isDoc()); }); // a Doc is read, not presented: no motion
    if (isDoc()) document.body.classList.add('motion-none');
    if (remember) { try { localStorage.setItem('james-jmd.motion', mode); } catch (e) { } }
    state.slides.forEach(stepReset);
  }
  function cycleMotion() {
    if (isDoc()) return;
    var next = MOTIONS[(MOTIONS.indexOf(state.motion) + 1) % MOTIONS.length];
    setMotion(next, true);
    counter.textContent = 'motion: ' + next; wake();
    clearTimeout(cycleMotion.t); cycleMotion.t = setTimeout(function () { counter.textContent = pad2(state.i + 1) + ' / ' + state.slides.length; }, 1400);
  }
  // step mode: the items of the current slide are revealed one by one on →, the slide changes when none is left
  function stepItems(sec) { return Array.prototype.slice.call(sec.querySelectorAll(STEP_ITEMS)).filter(function (el) { return !el.closest('.slide-pill') || el.classList.contains('slide-pill'); }); }
  // `explain` slides step their items whatever the global mode (except none): the intent modulates, the presenter still chooses
  function stepping(sec) { return !state.editing && !isDoc() && (state.motion === 'step' || (state.motion !== 'none' && !!sec && sec.getAttribute('data-intent') === 'explain')); }
  function stepReset(sec) {
    if (!sec) return;
    var items = stepItems(sec), on = stepping(sec);
    items.forEach(function (el) { el.classList.toggle('is-pending', on); el.classList.remove('is-shown'); });
  }
  function stepNext(sec) { // reveal one; true if something was revealed
    var el = sec.querySelector('.is-pending'); if (!el) return false;
    el.classList.remove('is-pending'); el.classList.add('is-shown'); follow(sec); return true;
  }
  function stepBack(sec) { // hide the last revealed; true if something was hidden
    var shown = sec.querySelectorAll('.is-shown'), el = shown[shown.length - 1]; if (!el) return false;
    el.classList.remove('is-shown'); el.classList.add('is-pending'); follow(sec); return true;
  }

  /* ── the glyph: one shape for the whole deck, posed by each slide's intent (engine.css). Presenting, it is not redrawn on
     every slide: it flies from the pose it had to the one it gets — and on `explain` it walks under each step as it arrives.
     Motion only: with motion none, in a Doc, in print or in the editor the poses are simply there. ── */
  var FLY = 'cubic-bezier(.65,0,.25,1)';
  function glyphOf(sec) { return sec ? sec.querySelector('.wm--mark .wm-g') : null; }
  function moving() { return !state.editing && !isDoc() && state.motion !== 'none'; }
  function poseOf(g) { var c = getComputedStyle(g); return { left: c.left, top: c.top, width: c.width, height: c.height, rotate: c.rotate, opacity: c.opacity, color: c.color }; }
  function fly(from, to) {
    var b = glyphOf(to); if (!b || from === to) return;
    b.getAnimations().forEach(function (x) { x.cancel(); }); // a flight still under way (a quick →→) lands at once
    if (!moving()) return;
    var a = glyphOf(from), end = poseOf(b), start = a ? poseOf(a) : Object.assign({}, end, { opacity: '0' });
    if (a) a.style.visibility = 'hidden'; // the leaving slide fades out: its copy must not stay behind as a ghost
    b.animate([start, end], { duration: a ? 900 : 450, easing: FLY });
    if (a) setTimeout(function () { a.style.visibility = ''; }, 200);
  }
  // explain: on the corner of the step just revealed, like a tick (a card, a timeline step), or beside it when the steps run down (a list)
  function follow(sec) {
    var g = glyphOf(sec); if (!g || sec.getAttribute('data-intent') !== 'explain') return;
    var shown = sec.querySelectorAll('.is-shown'), el = shown[shown.length - 1];
    var start = poseOf(g); g.getAnimations().forEach(function (a) { a.cancel(); }); // read before the reset: it hops from where it is, even mid-hop
    ['--gx', '--gy', '--gs'].forEach(function (p) { g.style.removeProperty(p); });
    if (!el || !moving()) return;
    var r0 = sec.getBoundingClientRect(), k = r0.width / page().w, r = el.getBoundingClientRect();
    var x = (r.left - r0.left) / k, y = (r.top - r0.top) / k, w = r.width / k, h = r.height / k, down = /^(LI|P)$/.test(el.tagName);
    g.style.setProperty('--gx', Math.round(down ? x - 30 : x + w - 6) + 'px');
    g.style.setProperty('--gy', Math.round(down ? y + h / 2 : y + 6) + 'px');
    g.style.setProperty('--gs', '36px');
    hop(g, start, poseOf(g));
  }
  // from one step to the next it hops: a quarter of the way up and over, along a curve (a quadratic Bézier sampled into keyframes)
  function hop(g, a, b) {
    var x0 = parseFloat(a.left), y0 = parseFloat(a.top), x1 = parseFloat(b.left), y1 = parseFloat(b.top);
    var lift = Math.min(160, Math.hypot(x1 - x0, y1 - y0) * 0.4), cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - lift, frames = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, u = 1 - t, f = { offset: t, left: (u * u * x0 + 2 * u * t * cx + t * t * x1) + 'px', top: (u * u * y0 + 2 * u * t * cy + t * t * y1) + 'px' };
      if (i === 0) Object.assign(f, { width: a.width, height: a.height, opacity: a.opacity, color: a.color });
      if (i === 16) Object.assign(f, { width: b.width, height: b.height, opacity: b.opacity, color: b.color });
      frames.push(f);
    }
    g.animate(frames, { duration: 650, easing: FLY });
  }
  function next() { if (stepping(state.slides[state.i]) && stepNext(state.slides[state.i])) return; show(state.i + 1); }
  function prev() { if (stepping(state.slides[state.i]) && stepBack(state.slides[state.i])) return; show(state.i - 1); }

  function show(n) {
    if (!state.slides.length) return;
    var from = state.i;
    state.i = Math.max(0, Math.min(state.slides.length - 1, n));
    var leaving = state.slides[from], arriving = state.slides[state.i];
    track.dataset.dir = state.i > from ? 'next' : state.i < from ? 'prev' : 'same';
    state.slides.forEach(function (s, k) { s.classList.toggle('is-active', k === state.i); });
    if (isDoc() && !show.fromScroll) { var sec = state.slides[state.i]; stage.scrollTo({ top: sec.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 24, behavior: 'auto' }); } // the page comes to the top of the window
    stepReset(state.slides[state.i]); follow(state.slides[state.i]);
    fly(leaving, arriving);
    counter.textContent = pad2(state.i + 1) + ' / ' + state.slides.length;
    Array.prototype.forEach.call(progress.children, function (b, k) { b.classList.toggle('is-done', k <= state.i); b.setAttribute('aria-current', k === state.i ? 'step' : 'false'); });
    tintProgress();
    notesTxt.innerHTML = state.slides[state.i].dataset.notes || '<span style="opacity:.4">No notes on this slide.</span>';
    try { history.replaceState(null, '', '#' + (state.i + 1)); } catch (e) { }
    if (state.editing) editorFill();
  }
  function toggleNotes() { state.notesOpen = !state.notesOpen; notesEl.classList.toggle('is-open', state.notesOpen); fit(); }

  var infoEl = document.getElementById('info'), helpEl = document.getElementById('help');
  helpEl.addEventListener('click', function () { helpEl.classList.remove('is-open'); });
  function counts(L) {
    var e = 0, w = 0; L.forEach(function (x) { if (x.level === 'error') e++; else if (x.level === 'warning') w++; });
    return { errors: e, warnings: w };
  }
  function statusText(c) { return c.errors ? c.errors + ' error' + (c.errors === 1 ? '' : 's') : c.warnings ? c.warnings + ' remark' + (c.warnings === 1 ? '' : 's') : 'clean'; }
  function statusClass(el, c) { el.classList.toggle('is-err', c.errors > 0); el.classList.toggle('is-warn', !c.errors && c.warnings > 0); el.classList.toggle('is-clean', !c.errors && !c.warnings); }
  function findingLine(x) {
    return '<div class="' + (x.level === 'error' ? 'err' : x.level === 'info' ? 'info' : 'warn') + '"><span class="s">' + pad2(x.slide) + '</span>' + esc((x.block ? x.block + ' — ' : '') + x.message) + '</div>';
  }
  var infoNote = null; // one line above the report (the PDF refusal)
  function reportHtml() {
    var L = state.lint, c = counts(L), html = '';
    if (infoNote) html += '<div class="note">' + esc(infoNote) + '</div>';
    if (!c.errors && !c.warnings) html += '<div class="ok">✓ valid jmd/1</div>';
    L.filter(function (x) { return x.level !== 'info'; }).forEach(function (x) { html += findingLine(x); });
    var infos = L.filter(function (x) { return x.level === 'info'; });
    if (infos.length) html += '<div class="info" style="margin-top:14px">' + infos.length + ' slide' + (infos.length === 1 ? '' : 's') + ' without speaker notes (N shows them while presenting)</div>';
    return html;
  }
  function showLint() { showInfo(); }
  function fmtSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  // the file's card — and, at the bottom, how the linter sees it (the report unfolds under it)
  function showInfo() {
    var m = state.doc ? state.doc.meta : {}, c = counts(state.lint), n = state.slides.length;
    var withNotes = state.slides.filter(function (s) { return s.dataset.notes; }).length;
    var imgs = Object.keys(assets).length;
    var fileSize = new Blob([document.documentElement.outerHTML]).size, srcSize = new Blob([state.src]).size;
    var rows = [
      ['file', state.name], ['runtime', 'james-jmd ' + RUNTIME_VERSION + (BUILT ? ' · built ' + BUILT : '')], m.author ? ['author', m.author] : null, ['slides', n + (withNotes ? ' · ' + withNotes + ' with notes' : '')],
      ['layout', state.layout === 'doc' ? 'doc · A4 portrait, ' + n + ' page' + (n === 1 ? '' : 's') : state.layout === 'story' ? 'story · 9:16, ' + n + ' screen' + (n === 1 ? '' : 's') : state.layout === 'webpage' ? 'webpage · one page, ' + n + ' section' + (n === 1 ? '' : 's') : 'slide · 16:9'], ['brand', (brand.name || '—') + (brand.id ? ' · ' + brand.id : '') + (m.brand && brand.id && m.brand !== brand.id ? ' (the deck asks for ' + m.brand + ')' : '')], ['theme', m.theme || '—'],
      ['story', (function () { var arc = state.slides.map(function (sec) { return sec.getAttribute('data-intent') || '·'; }); return arc.some(function (a) { return a !== '·'; }) ? arc.join(' › ') : '— (no intents)'; })()],
      ['language', m.lang || '—'], ['date', m.date || '—'], ['images', imgs ? imgs + ' embedded' : 'none'],
      ['size', fmtSize(fileSize) + ' · source ' + fmtSize(srcSize)],
      m.source ? ['imported from', m.source] : null, ['format', m.format || '—']
    ].filter(Boolean);
    var HEADER_ROWS = ['layout', 'brand', 'theme', 'language', 'date', 'author']; // what the document header sets: a click opens it in the editor
    infoEl.innerHTML = '<div class="lbl">Info</div><h2 data-edit="header" title="edit the header">' + esc(m.title || state.name) + '</h2><dl>' +
      rows.map(function (r) { var ed = HEADER_ROWS.indexOf(r[0]) >= 0 ? ' data-edit="header" title="edit the header"' : ''; return '<dt>' + esc(r[0]) + '</dt><dd' + ed + '>' + esc(String(r[1])) + '</dd>'; }).join('') + '</dl>' +
      '<div class="row"><span>' + (c.errors || c.warnings ? 'the linter has something to say' : 'the linter is happy') + '</span><button type="button" class="light' + (c.errors ? ' is-err' : c.warnings ? ' is-warn' : '') + '" id="info-lint">' + esc(statusText(c)) + '</button></div>' +
      '<div class="report" id="info-report">' + reportHtml() + '</div>';
  }
  function toggleInfo() { infoEl.classList.toggle('is-open'); if (!infoEl.classList.contains('is-open')) { infoEl.classList.remove('is-report'); infoNote = null; } }
  infoEl.addEventListener('click', function (e) {
    if (e.target.closest('#info-lint')) infoEl.classList.toggle('is-report');
    else if (e.target.closest('[data-edit="header"]') && state.slides.length) { toggleInfo(); openEditor('doc'); }
  });

  // the slide shows where its content stops fitting (edit mode): a dashed line at the limit
  function markOverflow() {
    state.slides.forEach(function (sec, i) {
      sec.classList.toggle('is-over', state.lint.some(function (x) { return x.rule === 'overflow' && x.slide === i + 1 && !x.block; }));
    });
  }
  var pageStyle = document.createElement('style'); document.head.appendChild(pageStyle); // the paper size follows the layout (engine.css prints Slide by default)
  function load(src, name) {
    state.src = src;
    state.name = name || state.name || 'deck';
    var doc = parse(src);
    state.doc = doc;
    // what is drawn: the source itself, or the same source as a Story on a phone held upright (the source is untouched)
    var view = reflows(doc) ? Object.assign({}, doc, { meta: Object.assign({}, doc.meta, { layout: 'story' }) }) : doc;
    state.reflowed = view !== doc;
    state.layout = JMD.layout(view);
    document.body.classList.toggle('is-reflowed', state.reflowed);
    JMD.LAYOUTS.forEach(function (l) { document.body.classList.toggle('layout-' + l, l === state.layout); });
    // the paper: Slide 1280×720 px (engine.css); Doc and Webpage A4 portrait; Story 1080×1920 px, the format of a story or a carousel page
    pageStyle.textContent = state.layout === 'doc' || state.layout === 'webpage' ? '@page{size:210mm 297mm;margin:0}' : state.layout === 'story' ? '@page{size:1080px 1920px;margin:0}' : '';
    if (!state.motion) { var saved = null; try { saved = localStorage.getItem('james-jmd.motion'); } catch (e) { } setMotion(saved || brand.motion || 'soft', false); } else setMotion(state.motion, false);
    track.innerHTML = render(view, { brand: brand, assets: assets });
    state.slides = Array.prototype.slice.call(track.querySelectorAll('.slide'));
    progress.innerHTML = state.slides.map(function (s, k) { return '<button type="button" aria-label="Screen ' + (k + 1) + '"><i></i></button>'; }).join('');
    document.title = (doc.meta.title || state.name) + ' — james-jmd';
    openEl.classList.remove('is-open');
    state.lint = lint(view, { assets: assets, assetsAuthoritative: false });
    fit();
    showLint();
    var start = parseInt(location.hash.slice(1), 10);
    show(!isNaN(start) ? start - 1 : 0);
    // overflow is measured once fonts are loaded, otherwise we'd measure the fallback font
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      if (state.doc !== doc) return;
      document.body.classList.add('is-measuring'); // no animation while measuring: a rising item would read 10px low
      fitOverflow(track, state.lint, state.layout); // a slide a little over the limit is shown smaller (warning), then measured
      lintOverflow(track, state.lint, state.layout);
      JMD.placeGlyphs(track, state.layout); // the poses that hang on a measure (act, decide): after the fit, which moves things
      document.body.classList.remove('is-measuring');
      showLint();
      markOverflow();
      if (state.editing) editorLint();
    });
  }

  /* ── the slide editor (V2): the current slide's source lines, edited in place ───────────────
     The source is rewritten by line-range replacement: what is not on this slide stays byte for byte. */
  function slideRange(i) {
    var s = state.doc.slides[i];
    return s ? [s.start, s.map[1]] : null;
  }
  // the document header: its `---` … `---` lines, or nothing yet (then the editor offers a minimal one, inserted at line 1)
  function headerRange() { return state.doc && state.doc.metaMap ? state.doc.metaMap : [0, 0]; }
  function editorFill() {
    var header = state.editTarget === 'doc', r = header ? headerRange() : slideRange(state.i); if (!r) return;
    var lines = state.src.split('\n');
    editSrc.value = r[1] > r[0] ? lines.slice(r[0], r[1]).join('\n') : '---\nformat: jmd/1\nlayout: slide\n---';
    editSrc.dataset.range = r[0] + ',' + r[1];
    editTitle.textContent = (header ? 'Document' + (r[1] > r[0] ? ' · lines ' + (r[0] + 1) + '–' + r[1] : ' · no header yet') : 'Slide ' + pad2(state.i + 1) + ' · lines ' + (r[0] + 1) + '–' + r[1]) + (state.dirty ? ' · edited' : '');
    editTarget.textContent = header ? 'slide' : 'document';
    editEl.classList.toggle('is-header', header);
    editorChips(); editorLint();
  }
  var editTarget = document.getElementById('edit-target');
  editTarget.addEventListener('click', function () { setEditTarget(state.editTarget === 'doc' ? 'slide' : 'doc'); });
  function setEditTarget(t) { if (inline_) endInline(true); state.editTarget = t; editorFill(); editSrc.focus(); }
  function openEditor(t) { state.editTarget = t; if (!state.editing) toggleEdit(); else editorFill(); }
  var editStatus = document.getElementById('edit-status');
  function slideFindings() { var n = state.editTarget === 'doc' ? 0 : state.i + 1; return state.lint.filter(function (x) { return x.slide === n && x.level !== 'info'; }); } // slide 0 = the document (format, layout, story)
  function editorLint() {
    var mine = slideFindings(), c = counts(mine);
    editStatus.textContent = statusText(c); statusClass(editStatus, c);
    editLint.innerHTML = mine.length ? mine.map(findingLine).join('') : '<div class="ok">✓ ' + (state.editTarget === 'doc' ? 'the header' : 'slide ' + pad2(state.i + 1)) + ' is clean</div>';
    if (!mine.length) editLint.classList.remove('is-open');
    editorHint();
  }
  editStatus.addEventListener('click', function () { editLint.classList.toggle('is-open'); });
  var editTimer = null;
  /* Every local change of the source goes through here — the panel (a line range) and the click-to-edit (a line, a column).
     A room (collab.js, the shared edit page) listens: it turns the change into a delta on the shared text. The rest of the
     page keeps reading a string. */
  function setSource(next) {
    if (next === state.src) return false;
    if (state.onSource) state.onSource(state.src, next);
    state.src = next;
    state.dirty = true; editEl.classList.add('is-dirty');
    return true;
  }
  /* Renaming, from wherever the page offers it: the same edit of the source as typing in the header, so it travels the one
     road every local change takes (`setSource` → the room's delta, or the file's own text). The deck is reloaded because a
     header change re-renders the whole thing, and the slide one was on is kept. Returns false when the name is the one it
     already had, or empty — the caller shows nothing rather than claiming it did something. */
  function setTitle(title) {
    var next = JMD.withTitle(state.src, title);
    var keep = state.i;
    if (!setSource(next)) return false;
    load(next, state.name);
    show(Math.min(keep, state.slides.length - 1));
    return true;
  }
  function editorApply() {
    var r = editSrc.dataset.range.split(',').map(Number);
    var lines = state.src.split('\n');
    var next = lines.slice(0, r[0]).concat(editSrc.value.split('\n'), lines.slice(r[1])).join('\n');
    var keep = state.i, cursor = editSrc.selectionStart;
    if (!setSource(next)) return;
    load(next, state.name); // a header edit (layout:, title:) re-renders the whole deck: the same matter, another page
    show(Math.min(keep, state.slides.length - 1));
    // the textarea was refilled from the new source: keep the caret where it was
    editSrc.selectionStart = editSrc.selectionEnd = Math.min(cursor, editSrc.value.length);
  }
  /* ── help: a palette of shapes (chips insert a minimal valid snippet) and a one-line hint that follows the caret ── */
  var editCtx = document.getElementById('edit-ctx'), editChips = document.getElementById('edit-chips');
  var SHAPES = JMD.SHAPES, CTX = JMD.CONTEXT_HINTS;
  function shape(name) { for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].name === name) return SHAPES[i]; return null; }
  function hintHtml(label, text) { return '<b>' + esc(label) + '</b> ' + esc(text); }
  // where is the caret: the frontmatter, inside a block, a title, a blank line, an item, or text
  function editorContext() {
    if (state.editTarget === 'doc') return { kind: 'header' };
    var v = editSrc.value, at = editSrc.selectionStart, before = v.slice(0, at).split('\n'), row = before.length - 1, lines = v.split('\n'), line = lines[row] || '';
    var fmEnd = -1, fm = 0; for (var i = 0; i < lines.length; i++) { if (lines[i].trim() === '---') { fm++; if (fm === 2) { fmEnd = i; break; } } }
    if (lines[0] && lines[0].trim() === '---' && row <= fmEnd) return { kind: 'frontmatter' };
    for (i = row; i >= 0; i--) {
      var m = /^:::\s*([a-z][\w-]*)/.exec(lines[i]);
      if (m) { var closed = false; for (var j = i + 1; j < row; j++) if (/^:::\s*$/.test(lines[j])) closed = true; if (!closed) return { kind: 'block', name: m[1], line: line }; break; }
      if (/^:::\s*$/.test(lines[i]) && i < row) break;
    }
    if (/^#{1,3}\s/.test(line)) return { kind: 'title' };
    if (!line.trim()) return { kind: 'blank' };
    if (/^\s*[-*]\s/.test(line)) return { kind: 'item' };
    return { kind: 'text' };
  }
  var RULES_OF = { title: ['title-length', 'no-title'], text: ['lead-length'], frontmatter: ['bg', 'same-bg', 'format'], blank: ['overflow', 'one-right-image', 'missing-asset', 'asset-not-embedded'], item: [], header: ['format', 'layout', 'story-monotone', 'story-fun', 'story-hook'] };
  CTX.header = 'layout: ' + JMD.LAYOUTS.join(' · ') + '  ·  title:  ·  brand: an id or a brand.yaml URL (applied at the next build)  ·  lang:  ·  date:  ·  author:';
  function editorHint() {
    var c = editorContext(), f = null, mine = slideFindings();
    // the linter speaks where the caret is: the block's own finding, or the one about this part of the slide
    if (c.kind === 'block') f = mine.filter(function (x) { return x.block === c.name; })[0];
    else f = mine.filter(function (x) { return !x.block && RULES_OF[c.kind].indexOf(x.rule) >= 0; })[0];
    editCtx.classList.toggle('is-err', !!f && f.level === 'error'); editCtx.classList.toggle('is-warn', !!f && f.level !== 'error');
    if (f) { editCtx.innerHTML = hintHtml(c.kind === 'block' ? c.name : c.kind === 'frontmatter' ? 'slide' : c.kind, f.message); return; }
    if (c.kind === 'block') { var sh = shape(c.name); editCtx.innerHTML = sh ? hintHtml(sh.name, sh.hint) : hintHtml(c.name, 'unknown block — ' + SHAPES.map(function (x) { return x.name; }).slice(0, 8).join(' ')); }
    else editCtx.innerHTML = hintHtml(c.kind === 'frontmatter' ? 'slide' : c.kind === 'header' ? 'document' : c.kind, CTX[c.kind]);
  }
  function insertSnippet(text) {
    var v = editSrc.value, st = editSrc.selectionStart, en = editSrc.selectionEnd;
    var before = v.slice(0, st), after = v.slice(en);
    // on its own lines, with a blank line on each side
    var pre = before === '' ? '' : /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    var post = after === '' ? '\n' : /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
    editSrc.setRangeText(pre + text + post, st, en, 'end');
    editSrc.focus();
    editSrc.dispatchEvent(new Event('input'));
    editorHint();
  }
  // the bg chip cycles the slide background, live
  function cycleBg() {
    var lines = editSrc.value.split('\n'), cur = null, at = -1, fm = 0;
    for (var i = 0; i < lines.length; i++) { if (lines[i].trim() === '---') { fm++; if (fm === 2) break; continue; } var m = /^bg:\s*(\S+)/i.exec(lines[i]); if (fm === 1 && m) { cur = m[1].toLowerCase(); at = i; } }
    var next = JMD.BGS[(JMD.BGS.indexOf(cur) + 1) % JMD.BGS.length];
    if (at >= 0) lines[at] = 'bg: ' + next;
    else if (lines[0] && lines[0].trim() === '---') lines.splice(1, 0, 'bg: ' + next);
    else lines.unshift('---', 'bg: ' + next, '---');
    var pos = editSrc.selectionStart;
    editSrc.value = lines.join('\n'); editSrc.selectionStart = editSrc.selectionEnd = Math.min(pos, editSrc.value.length);
    editChips.querySelector('.bg').textContent = 'bg: ' + next + ' ▸';
    editSrc.dispatchEvent(new Event('input'));
  }
  function currentBg() { var m = /(?:^|\n)bg:\s*(\S+)/i.exec(editSrc.value.split(/\n---\s*\n/)[0] || ''); return m ? m[1].toLowerCase() : 'white'; }
  // the header's `layout:` line, cycled: the deck re-renders on the next page — the same matter, read as slides, pages, screens or one page
  function currentLayout() { var m = /(?:^|\n)layout:\s*(\S+)/i.exec(editSrc.value); return m && JMD.PAGES[m[1].toLowerCase()] ? m[1].toLowerCase() : 'slide'; }
  function cycleLayout() {
    var lines = editSrc.value.split('\n'), at = -1, fmt = -1;
    for (var i = 0; i < lines.length; i++) { if (/^layout:/i.test(lines[i]) && at < 0) at = i; if (/^format:/i.test(lines[i]) && fmt < 0) fmt = i; }
    var next = JMD.LAYOUTS[(JMD.LAYOUTS.indexOf(currentLayout()) + 1) % JMD.LAYOUTS.length];
    if (at >= 0) lines[at] = 'layout: ' + next;
    else lines.splice(fmt >= 0 ? fmt + 1 : 1, 0, 'layout: ' + next); // under `format:`, where it reads first
    var pos = editSrc.selectionStart;
    editSrc.value = lines.join('\n'); editSrc.selectionStart = editSrc.selectionEnd = Math.min(pos, editSrc.value.length);
    editChips.querySelector('.layout').textContent = 'layout: ' + next + ' ▸';
    clearTimeout(editTimer); editorApply(); // now, not after the typing delay: the page changes under the eye
  }
  function editorChips() {
    editChips.innerHTML = state.editTarget === 'doc'
      ? '<button type="button" class="layout" title="cycle the layout: ' + JMD.LAYOUTS.join(' → ') + '">layout: ' + esc(currentLayout()) + ' ▸</button>'
      : SHAPES.map(function (sh) { return '<button type="button" data-shape="' + sh.name + '" title="' + esc(sh.hint) + '">' + sh.name + '</button>'; }).join('') +
        '<button type="button" class="bg" title="cycle the slide background">bg: ' + esc(currentBg()) + ' ▸</button>';
  }
  editChips.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('layout')) cycleLayout(); else if (b.classList.contains('bg')) cycleBg(); else insertSnippet(shape(b.dataset.shape).snippet);
  });
  editChips.addEventListener('mouseover', function (e) { var b = e.target.closest('button[data-shape]'); if (b) { var sh = shape(b.dataset.shape); editCtx.innerHTML = hintHtml(sh.name, sh.hint); } });
  editChips.addEventListener('mouseout', function () { editorHint(); });
  editSrc.addEventListener('keyup', editorHint);
  editSrc.addEventListener('click', editorHint);
  editSrc.addEventListener('input', function () { clearTimeout(editTimer); editTimer = setTimeout(editorApply, 180); editorHint(); });
  editSrc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { toggleEdit(); e.preventDefault(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); clearTimeout(editTimer); editorApply(); saveSource(); }
    else if (e.key === 'Tab') { e.preventDefault(); var st = editSrc.selectionStart; editSrc.setRangeText('  ', st, editSrc.selectionEnd, 'end'); editSrc.dispatchEvent(new Event('input')); }
    e.stopPropagation(); // keys typed in the editor never drive the deck
  });
  /* A deck page this server hosts is a **read** page: it carries no room, so nothing it changes is ever written anywhere.
     Opening the local editor there is worse than refusing it — a person edits a title, the screen follows, the tab is
     closed and the work is gone, which is exactly what happened (2026-09-27: *si je suis sur View et que je tape E*).
     So on `/deck/<id>` the gesture that asks to edit goes to **the editor**, the same door the menu offers; signed out that
     address is the sign-in with the way back. A file opened from disk and the 24-hour delivery keep their own editor —
     editing a file you hold and exporting it again is what they are for — and the edit page itself carries `JMDCollab`,
     which is the room that does the writing. */
  function hostedRead() {
    return !window.JMDCollab && /^https?:$/.test(location.protocol) && /^\/deck\/[A-Za-z0-9_-]{16}\/?$/.test(location.pathname)
      ? location.pathname.replace(/\/$/, '') + '/edit' : null;
  }
  function toggleEdit() {
    if (!state.slides.length) return;
    if (!state.editing) { var away = hostedRead(); if (away) { location.href = away; return; } }
    state.editing = !state.editing;
    editEl.classList.toggle('is-open', state.editing);
    document.body.classList.toggle('is-editing', state.editing);
    stepReset(state.slides[state.i]);
    if (state.editing) { infoEl.classList.remove('is-open'); editorFill(); setTimeout(function () { editSrc.focus(); }, 0); } else { if (inline_) endInline(true); stage.style.right = '0'; }
    fit();
  }
  /* ── in-place editing: click a text in the slide (edit mode), edit its source, it is written back to its line ── */
  var COLS = /(?<!\\)\s\|\s|(?<!\\)\|/;
  // the editable part of a source line: [prefix, text, suffix] — prefix = `## `, `- `, `— `, `key: `; suffix = ` {.mods}`
  function lineParts(line) {
    var m = /^(#{1,3}\s+|\s*[-*]\s+|—\s+|[A-Za-z][\w-]*:\s*)?([\s\S]*?)(\s*\{[^}]*\})?$/.exec(line);
    return [m[1] || '', m[2], m[3] || ''];
  }
  function pieceText(lineIdx, col) {
    var parts = lineParts(state.src.split('\n')[lineIdx] || '');
    if (col == null) return parts[1];
    var cols = parts[1].split(COLS).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
    return cols[col] || '';
  }
  function setPiece(lineIdx, col, text) {
    var lines = state.src.split('\n'), parts = lineParts(lines[lineIdx] || '');
    text = text.replace(/[\r\n]+/g, ' ');
    if (col == null) lines[lineIdx] = parts[0] + text + parts[2];
    else {
      var cols = parts[1].split(COLS).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
      while (cols.length <= col) cols.push('');
      cols[col] = text;
      var row = cols.map(function (c) { return c.replace(/\|/g, '\\|'); }).join(' | ');
      if (/^\|/.test(parts[1].trim())) row = row.trim(); // a table row `| a | b |`: its edge pipes stay at the edges
      lines[lineIdx] = parts[0] + row + parts[2];
    }
    setSource(lines.join('\n'));
  }
  var inline_ = null; // { el, line, col, srcBefore }
  function findPiece(line, col) {
    var sel = '.slide.is-active [data-line="' + line + '"]' + (col == null ? ':not([data-col])' : '[data-col="' + col + '"]');
    return track.querySelector(sel);
  }
  // Rendered-text offset under the pointer (before the element's text is swapped for its source).
  function caretOffsetAt(el, x, y) {
    var node, off;
    if (document.caretPositionFromPoint) { var cp = document.caretPositionFromPoint(x, y); if (!cp) return null; node = cp.offsetNode; off = cp.offset; }
    else if (document.caretRangeFromPoint) { var cr = document.caretRangeFromPoint(x, y); if (!cr) return null; node = cr.startContainer; off = cr.startOffset; }
    else return null;
    if (!el.contains(node)) return null;
    var r = document.createRange(); r.setStart(el, 0); r.setEnd(node, off);
    return r.toString().length;
  }
  // The rendered text is a subsequence of its source (marks like ** and link targets are skipped): align them.
  function sourceOffset(rendered, source, n) {
    var i = 0, j = 0;
    while (j < n && i < source.length) { if (source[i] === rendered[j]) j++; i++; }
    return i;
  }
  function placeCaret(el, at) {
    var t = el.firstChild, sel = window.getSelection(), range = document.createRange();
    if (t && t.nodeType === 3) { at = Math.max(0, Math.min(at == null ? t.length : at, t.length)); range.setStart(t, at); range.collapse(true); }
    else { range.selectNodeContents(el); range.collapse(false); }
    sel.removeAllRanges(); sel.addRange(range);
  }
  function beginInline(el, x, y) {
    var line = +el.dataset.line, col = el.dataset.col == null ? null : +el.dataset.col;
    if (inline_) { endInline(true); el = findPiece(line, col); if (!el) return; } // the slide was re-rendered: find the piece again
    var rendered = el.textContent, at = x == null ? null : caretOffsetAt(el, x, y);
    var source = pieceText(line, col);
    inline_ = { el: el, line: line, col: col, srcBefore: state.src };
    el.textContent = source; // the source text, markdown marks visible
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('is-inline');
    el.focus();
    placeCaret(el, at == null ? null : sourceOffset(rendered, source, at));
  }
  var inlineTimer = null;
  function inlineInput() {
    if (!inline_) return;
    setPiece(inline_.line, inline_.col, inline_.el.textContent);
    editorFill(); // the panel follows
  }
  function endInline(commit) {
    if (!inline_) return;
    clearTimeout(inlineTimer);
    var keep = state.i;
    if (commit) { setPiece(inline_.line, inline_.col, inline_.el.textContent); } else if (!state.onSource) { state.src = inline_.srcBefore; }
    inline_ = null;
    load(state.src, state.name); show(keep);
  }
  // The first press on a text opens it, with the caret where the pointer is; further presses on it are native (double-click selects a word).
  var inlinePressed = false;
  // A diagram's box is drawn, not typed: a press on it opens the slide's source with the box's line selected
  function focusSourceLine(line) {
    if (inline_) endInline(true);
    state.editTarget = 'slide'; editorFill();
    var r = editSrc.dataset.range.split(',').map(Number), rows = editSrc.value.split('\n'), row = line - r[0];
    if (row < 0 || row >= rows.length) return;
    var start = rows.slice(0, row).join('\n').length + (row ? 1 : 0), text = rows[row], lead = text.length - text.replace(/^\s+/, '').length;
    editSrc.focus(); editSrc.setSelectionRange(start + lead, start + text.length);
    editSrc.scrollTop = Math.max(0, row * (parseFloat(getComputedStyle(editSrc).lineHeight) || 18) - editSrc.clientHeight / 3);
    editorHint();
  }
  track.addEventListener('mousedown', function (e) {
    if (!state.editing || e.button !== 0) return;
    var dn = e.target.closest && e.target.closest('[data-node-line]');
    if (dn && dn.closest('.slide.is-active')) { e.preventDefault(); focusSourceLine(+dn.dataset.nodeLine); return; }
    var el = e.target.closest('[data-line]'); // only text pieces carry data-line (the slide itself carries data-start)
    if (!el || !el.closest('.slide.is-active')) { e.preventDefault(); if (inline_) endInline(true); return; } // off a text: no native selection or image drag, just commit
    if (inline_ && inline_.el === el) return;
    e.preventDefault(); inlinePressed = true;
    beginInline(el, e.clientX, e.clientY);
  }, true);
  track.addEventListener('click', function (e) {
    if (!state.editing) return;
    var el = e.target.closest('[data-line]');
    if (!el || !el.closest('.slide.is-active')) return;
    e.stopPropagation();
    if (inlinePressed || (inline_ && inline_.el === el)) { inlinePressed = false; return; }
    beginInline(el); // a click without a press (programmatic): caret at the end
  }, true);
  track.addEventListener('input', function (e) { if (inline_ && e.target === inline_.el) { clearTimeout(inlineTimer); inlineTimer = setTimeout(inlineInput, 150); } });
  track.addEventListener('keydown', function (e) {
    if (!inline_) return;
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); endInline(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endInline(false); }
  }, true);
  track.addEventListener('focusout', function (e) { if (inline_ && e.target === inline_.el) setTimeout(function () { if (inline_ && inline_.el === e.target) endInline(true); }, 0); });

  // Save the .jmd: File System Access API when available (the handle is kept for the session), download otherwise.
  function saveSource() {
    var name = state.name.replace(/\.jmd$/, '') + '.jmd';
    var done = function () { state.dirty = false; editEl.classList.remove('is-dirty'); editTitle.textContent = editTitle.textContent.replace(' · edited', ''); editLint.innerHTML = '<div class="saved">✓ saved ' + esc(name) + '</div>' + editLint.innerHTML; };
    if (window.showSaveFilePicker) {
      var p = state.fileHandle ? Promise.resolve(state.fileHandle) : window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'jmd presentation', accept: { 'text/markdown': ['.jmd'] } }] });
      p.then(function (h) { state.fileHandle = h; return h.createWritable(); }).then(function (w) { return w.write(state.src).then(function () { return w.close(); }); }).then(done).catch(function (e) { if (e && e.name !== 'AbortError') download(name, state.src, 'text/markdown'), done(); });
    } else { download(name, state.src, 'text/markdown'); done(); }
  }

  // Self-contained export: the pristine template + the source inside <script type="text/jmd">
  function exportSelfContained() {
    var html = template.replace(/<script type="text\/jmd" id="jmd"[^>]*>[\s\S]*?(<\/script>)/, function (_, b) {
      return '<script type="text/jmd" id="jmd" data-name="' + esc(state.name) + '">\n' + state.src.replace(/<\/script/gi, '<\\/script') + '\n' + b;
    }).replace(/<script type="application\/json" id="assets">[\s\S]*?<\/script>/, function () {
      return '<script type="application/json" id="assets">' + JSON.stringify(assets).replace(/</g, '\\u003c') + '<\/script>';
    });
    download(JMD.fileName(state.doc, '.james-jmd.html', { fallback: state.name }), html, 'text/html');
  }
  function download(name, content, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function printPDF() {
    if (state.lint.some(function (x) { return x.level === 'error'; })) {
      infoNote = 'The PDF waits for the errors below — they would print as they look.';
      showInfo(); infoEl.classList.add('is-open'); infoEl.classList.add('is-report');
      return;
    }
    // the PDF is named by the browser after the page's title: for the time of the print, the title is the deck's file name
    var tabTitle = document.title, back = function () { document.title = tabTitle; };
    document.title = JMD.fileName(state.doc, '', { fallback: state.name });
    window.addEventListener('afterprint', back, { once: true });
    window.print(); back();
  }

  /* Download (D): one menu for every way the deck leaves (spec/export.md). What a browser can make alone is always there —
     the deck as one page (what S saves) and the PDF (what P prints). PowerPoint and images need the server's Chromium,
     which reads the drawn page back: they are offered only on the deck's own page there (`/deck/<id>`, a published
     version, the edit page — which exports the deck as stored, a second behind the typing), never on a file opened from
     disk or a 24-hour link, where nothing would answer. A Webpage has no screens to give PowerPoint. S and P still work. */
  var dlEl = document.getElementById('dl'), dlList = document.getElementById('dl-list');
  function hostedDeck() {
    var m = /^\/deck\/([A-Za-z0-9_-]{16})(?:\/v\/(\d{1,4})|\/edit\/[A-Za-z0-9_-]{22})?\/?$/.exec(location.pathname);
    return m && /^https?:$/.test(location.protocol) ? '/deck/' + m[1] + (m[2] ? '/v/' + m[2] : '') : null;
  }
  function closeDownload() { dlEl.classList.remove('is-open'); }
  function toggleDownload() {
    if (dlEl.classList.toggle('is-open')) {
      var at = hostedDeck(), item = function (tag, attrs, title, about, key) {
        return '<' + tag + ' ' + attrs + ' data-key="' + key + '"><b>' + title + '</b><kbd>' + key + '</kbd><small>' + about + '</small></' + tag + '>';
      };
      /* Share in Jamespot (1.32.0), first: the server puts its address in the page it serves (`#dl-jamespot`, mcp/chrome.mjs)
         only for the deck's owner, signed in, where Jamespot answers — so a file, a stranger or a 24-hour link never sees it.
         The page may not post (its CSP), so it is a link, to a new tab: the round trip to Jamespot leaves the deck open. */
      var jp = document.getElementById('dl-jamespot'), jpHref = jp && /^\/home\/share\?id=[A-Za-z0-9_-]{16}$/.test(jp.getAttribute('href')) ? jp.getAttribute('href') : '';
      document.getElementById('dl-lbl').textContent = jpHref ? 'Share or download' : 'Download';
      dlList.innerHTML = (jpHref ? item('a', 'href="' + jpHref + '" target="_blank" rel="noopener" data-share-jamespot', 'Share in Jamespot', 'publish it in a group of your platform, as a link to this deck — never its edit link', 'J') : '')
        + item('button', 'type="button" data-dl="html"', 'Page · .html', 'the deck in one file — opens in any browser, offline, and keeps its source · runtime ' + RUNTIME_VERSION, 'S')
        + (at ? item('a', 'href="' + at + '/deck.pdf" download', 'PDF · .pdf', 'to send or print — every page, drawn by the server', 'P')
              : item('button', 'type="button" data-dl="pdf"', 'PDF · .pdf', 'through the print dialog: choose Save as PDF — waits for the errors the check reports', 'P'))
        + (at && state.layout !== 'webpage' ? item('a', 'href="' + at + '/deck.pptx" download', 'PowerPoint · .pptx', 'for PowerPoint, Keynote, OnlyOffice — the text stays editable, the motion stays here', 'X') : '')
        + (at ? item('a', 'href="' + at + '/images.zip" download', 'Images · .zip', 'one PNG per screen, in a zip', 'I') : '');
      var first = dlList.querySelector('a, button'); if (first) first.focus();
    }
  }
  /* A PowerPoint or the images take seconds — the server draws them — and a browser shows nothing until the file comes:
     it looked broken (2026-10-07). The page may not call the network (its CSP), so the link leaves with a token
     (`?t=`) and the server answers it with a cookie, `jmd-dl-<token>`: `ok` with the file, `busy`, `none` or `gone` with an
     empty answer (nothing saved). Meanwhile a strip says what is being drawn, the seconds, and a bar that moves on an
     estimate from the number of screens (it never claims 100 % before the answer); then the outcome in words. */
  var toastEl = document.getElementById('dl-toast'), toastT = null;
  function watchDownload(a) {
    var token = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 16);
    var base = a.getAttribute('href').split('?')[0], kind = /\.pptx$/.test(base) ? 'pptx' : /\.pdf$/.test(base) ? 'pdf' : 'png', pptx = kind === 'pptx';
    a.setAttribute('href', base + '?t=' + token);
    var what = { pptx: 'the PowerPoint', pdf: 'the PDF', png: 'the images' }[kind], n = state.slides.length || 1, est = pptx ? 1.5 + 0.45 * n : 1 + 0.3 * n;
    var t0 = Date.now(), name = 'jmd-dl-' + token + '=', txt = toastEl.querySelector('.t'), bar = toastEl.querySelector('i');
    var end = function (cls, words, ms) { clearInterval(toastT); txt.textContent = words; bar.style.width = '100%'; toastEl.className = 'is-open ' + cls; toastT = setTimeout(function () { toastEl.className = ''; }, ms); };
    clearInterval(toastT); clearTimeout(toastT); bar.style.width = '0'; toastEl.className = 'is-open'; txt.textContent = 'Drawing ' + what + ' · 0 s';
    toastT = setInterval(function () {
      var s = (Date.now() - t0) / 1000, c = document.cookie.split('; ').filter(function (x) { return x.indexOf(name) === 0; })[0];
      if (c) {
        var v = c.slice(name.length); document.cookie = name + '; Path=/; Max-Age=0';
        if (v === 'ok') end('is-done', 'Ready — ' + what + (kind === 'png' ? ' are' : ' is') + ' in your downloads', 3000);
        else end('is-err', v === 'busy' ? 'The server is drawing other files — try again in a few seconds' : v === 'none' ? 'This deck cannot leave as ' + { pptx: 'PowerPoint', pdf: 'a PDF', png: 'images' }[kind] : 'This deck is no longer on the server', 7000);
        return;
      }
      if (s > 120) { end('is-err', 'Nothing came back in two minutes — try again', 7000); return; }
      txt.textContent = 'Drawing ' + what + ' · ' + Math.floor(s) + ' s';
      bar.style.width = (s < est ? 90 * s / est : 90 + 5 * (1 - Math.exp(-(s - est) / est))) + '%';
    }, 200);
  }
  dlList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dl]'), a = e.target.closest('a');
    if (a && a.hasAttribute('data-share-jamespot')) { setTimeout(closeDownload, 0); return; } // a page in a new tab, not a file
    if (b) { closeDownload(); if (b.getAttribute('data-dl') === 'pdf') printPDF(); else exportSelfContained(); }
    else if (a) { watchDownload(a); setTimeout(closeDownload, 0); } // the href carries the token before the browser follows it
  });
  dlEl.addEventListener('click', function (e) { if (!e.target.closest('.box')) closeDownload(); });
  /* The menu without a mouse (2026-10-07): ↑ ↓ move (round the list), Enter takes the one in focus, each format has
     its letter — J sharing in Jamespot where it is offered, S the page, P the PDF, X PowerPoint (.pptX: P is the PDF's), I images — and Esc or D closes. Every file
     leaves through here: S and P are no longer keys of their own (2026-10-07: a PDF is a download, not a print). While the
     menu is open these keys are the menu's: an arrow does not move the slides behind it, Enter does not turn the page. */
  function downloadKey(e) {
    var k = e.key, items = [].slice.call(dlList.querySelectorAll('a, button')), at = items.indexOf(document.activeElement);
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Tab') {
      var step = k === 'ArrowUp' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
      items[((at < 0 ? (step > 0 ? -1 : 0) : at) + step + items.length) % items.length].focus();
    } else if (k === 'Home' || k === 'End') items[k === 'Home' ? 0 : items.length - 1].focus();
    else if (k === 'Enter' || k === ' ') { if (at >= 0) items[at].click(); }
    else if (k === 'Escape' || k === 'd' || k === 'D') closeDownload();
    else {
      var hit = items.filter(function (el) { return el.getAttribute('data-key') === k.toUpperCase(); })[0];
      if (!hit) return; // any other key: nothing, and not the slides either
      hit.focus(); hit.click(); closeDownload();
    }
    e.preventDefault();
  }
  document.getElementById('hud-dl').addEventListener('click', toggleDownload);
  if (hostedDeck()) document.body.classList.add('is-hosted'); // a deck the server keeps: opening a file from disk over it is not what this page is for (O still works)

  // Open: file picker, drag & drop, ?src=
  function readFile(f) {
    var r = new FileReader();
    r.onload = function () { load(String(r.result), f.name); };
    r.readAsText(f);
  }
  document.getElementById('open-file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) readFile(f); });

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (e.metaKey || e.ctrlKey) return;
    if (document.activeElement && document.activeElement.isContentEditable) return; // typing in the slide
    // typing in a field: the room's dialog (a deck's name, your name, a version's label) took Space, Backspace and Enter
    // to move the slides and swallowed them, so nothing could be typed and nothing submitted (#28, 2026-10-04)
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    if (dlEl.classList.contains('is-open')) { downloadKey(e); return; }
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'm' || k === 'M') cycleMotion();
    else if (k === '?' || k === 'h' || k === 'H') helpEl.classList.toggle('is-open');
    else if (k === 'Escape' && helpEl.classList.contains('is-open')) helpEl.classList.remove('is-open');
    else if (k === 'd' || k === 'D') toggleDownload();
    else if (k === 'Home') show(0);
    else if (k === 'End') show(state.slides.length - 1);
    else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
    else if (k === 'n' || k === 'N') toggleNotes();
    else if (k === 'i' || k === 'I') toggleInfo();
    else if (k === 'e' || k === 'E') { e.preventDefault(); if (!state.editing) state.editTarget = 'slide'; toggleEdit(); } // preventDefault: the E must not land in the textarea
    else if (k === 'Escape' && state.editing) toggleEdit();
    else if (k === 'Escape' && infoEl.classList.contains('is-open')) toggleInfo();
    else if (k === 'o' || k === 'O') document.getElementById('open-file').click();
    else if (k === 'q' || k === 'Q') toggleQr();
    else if (k === 'Escape' && qrOpen()) toggleQr();
  });
  /* The QR code of a shared deck (1.17.0): the server puts it in the page it serves (mcp/qr.mjs), drawn from the deck's own
     link, hidden; Q shows it over the slide so the room scans it, Q, Escape or a click put it away. A file opened from the
     disk has no address to scan, and no #qr: Q does nothing there. */
  function qrEl() { return document.getElementById('qr'); }
  function qrOpen() { var q = qrEl(); return !!q && q.classList.contains('is-open'); }
  function toggleQr() { var q = qrEl(); if (q) q.classList.toggle('is-open'); }
  // Share: the phone's own sheet (Messages, WhatsApp, AirDrop) where there is one, else the link copied
  function share() {
    var url = location.origin + location.pathname, title = (state.doc && state.doc.meta.title) || document.title;
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () { }); return; }
    var said = function (t) { counter.textContent = t; wake(); clearTimeout(share.t); share.t = setTimeout(function () { counter.textContent = pad2(state.i + 1) + ' / ' + state.slides.length; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { said('link copied'); }, function () { said(url); }); else said(url);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-qr], [data-share], #qr');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var menu = a.closest('details'); if (menu) menu.open = false;
    if (a.hasAttribute('data-share')) share(); else toggleQr();
  }, true);
  // a swipe turns the page where one screen shows at a time (Slide, Story); a Doc scrolls
  var touch0 = null;
  document.addEventListener('touchstart', function (e) { touch0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!touch0 || isDoc() || state.editing || qrOpen()) return;
    var t = e.changedTouches[0], dx = t.clientX - touch0.x, dy = t.clientY - touch0.y; touch0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) next(); else prev();
    swiped = Date.now(); // the click that may follow the touch must not turn the page a second time
  }, { passive: true });
  var swiped = 0;
  // the phone turned: the deck is drawn again in what that position calls for, on the same screen
  if (PHONE && PHONE.addEventListener) PHONE.addEventListener('change', function () { if (state.doc && !state.editing && reflows(state.doc) !== state.reflowed) load(state.src, state.name); });
  document.addEventListener('click', function (e) {
    if (e.target.closest('#notes, #info, #help, #dl, #open, #hud, #edit, #progress')) return;
    if (state.editing) { if (inlinePressed) { inlinePressed = false; return; } if (inline_ && !e.target.closest('.is-inline')) endInline(true); return; } // in edit mode, clicks edit; they don't navigate
    if (isDoc()) return; // a Doc scrolls; a click on it is a click
    if (Date.now() - swiped < 500) return;
    if (e.clientX < window.innerWidth * 0.25) prev(); else next();
  });
  // Doc: the page under the top of the window is the current one (the counter, the notes, the editor follow the scroll)
  var scrollT = null;
  stage.addEventListener('scroll', function () {
    if (!isDoc() || !state.slides.length || stage.scrollHeight - stage.clientHeight < 2) return; // everything fits: the current page is the one chosen, not the first
    clearTimeout(scrollT);
    scrollT = setTimeout(function () {
      var top = stage.getBoundingClientRect().top + 40, best = 0;
      state.slides.forEach(function (sec, k) { if (sec.getBoundingClientRect().top <= top) best = k; });
      if (best !== state.i) { show.fromScroll = true; show(best); show.fromScroll = false; }
    }, 80);
  });
  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', function () {
    var n = parseInt(location.hash.slice(1), 10);
    if (!isNaN(n) && n - 1 !== state.i) show(n - 1);
  });
  var idleT;
  // the HUD, the counter and the linter's light show on a key or a move, and fade while the slide is being watched
  function wake() {
    [hud, counter].forEach(function (el) { el.classList.remove('is-idle'); });
    clearTimeout(idleT);
    idleT = setTimeout(function () { [hud, counter].forEach(function (el) { el.classList.add('is-idle'); }); }, 3500);
  }
  ['mousemove', 'keydown', 'click'].forEach(function (ev) { document.addEventListener(ev, wake); });
  wake();

  // Startup: embedded source, or ?src=, or the "Open" screen
  var embedded = document.getElementById('jmd');
  // exact bytes: the template wraps the source in one newline on each side, nothing else is stripped
  var src = embedded ? embedded.textContent.replace(/<\\\/script/g, '<' + '/script').replace(/^\n/, '').replace(/\n$/, '') : '';
  var qs = new URLSearchParams(location.search).get('src');
  if (src) load(src, embedded.dataset.name);
  else if (qs) fetch(qs).then(function (r) { return r.text(); }).then(function (t) { load(t, qs.split('/').pop()); }).catch(function () { openEl.classList.add('is-open'); });
  else openEl.classList.add('is-open');
  fit();

  window.jamesJmd = { version: RUNTIME_VERSION, fit: fit, editTarget: setEditTarget, setTitle: setTitle, parse: parse, lint: lint, render: render, load: load, show: show, next: next, prev: prev, motion: setMotion, edit: toggleEdit, applyEdit: editorApply, beginInline: beginInline, endInline: endInline, editorFill: editorFill, editSrc: editSrc, editTitle: editTitle, state: state };
})();
