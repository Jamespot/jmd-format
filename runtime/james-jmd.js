/* james-jmd.html — the browser application: navigation, notes, linter panel, open/drop, print, self-contained export.
   Depends on jmd-core.js (globalThis.JMD), inlined before this file by the build. */
(function () {
  'use strict';
  var RUNTIME_VERSION = JMD.VERSION;
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
  var editEl = document.getElementById('edit'), editSrc = document.getElementById('edit-src'), editLint = document.getElementById('edit-lint'), editTitle = document.getElementById('edit-title');
  var state = { doc: null, src: '', slides: [], i: 0, notesOpen: false, lint: [], editing: false, dirty: false, fileHandle: null, motion: null, layout: 'slide', editTarget: 'slide' }; // editTarget: 'slide' (the current slide's lines) | 'doc' (the document header)
  var page = function () { return JMD.PAGES[state.layout] || JMD.PAGES.slide; };
  var isDoc = function () { return page().flow === 'scroll'; }; // Doc and Webpage: the pages stack and scroll; Slide and Story: one screen at a time

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
  var STEP_ITEMS = '.metric, .card, .tl-step, .col, .slide-pill, .logos li, .logos img, .prose li, .prose p, .figure'; // the lead arrives with the title
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
    el.classList.remove('is-pending'); el.classList.add('is-shown'); return true;
  }
  function stepBack(sec) { // hide the last revealed; true if something was hidden
    var shown = sec.querySelectorAll('.is-shown'), el = shown[shown.length - 1]; if (!el) return false;
    el.classList.remove('is-shown'); el.classList.add('is-pending'); return true;
  }
  function next() { if (stepping(state.slides[state.i]) && stepNext(state.slides[state.i])) return; show(state.i + 1); }
  function prev() { if (stepping(state.slides[state.i]) && stepBack(state.slides[state.i])) return; show(state.i - 1); }

  function show(n) {
    if (!state.slides.length) return;
    var from = state.i;
    state.i = Math.max(0, Math.min(state.slides.length - 1, n));
    track.dataset.dir = state.i > from ? 'next' : state.i < from ? 'prev' : 'same';
    state.slides.forEach(function (s, k) { s.classList.toggle('is-active', k === state.i); });
    if (isDoc() && !show.fromScroll) { var sec = state.slides[state.i]; stage.scrollTo({ top: sec.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 24, behavior: 'auto' }); } // the page comes to the top of the window
    stepReset(state.slides[state.i]);
    counter.textContent = pad2(state.i + 1) + ' / ' + state.slides.length;
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
      ['file', state.name], m.author ? ['author', m.author] : null, ['slides', n + (withNotes ? ' · ' + withNotes + ' with notes' : '')],
      ['layout', state.layout === 'doc' ? 'doc · A4 portrait, ' + n + ' page' + (n === 1 ? '' : 's') : state.layout === 'story' ? 'story · 9:16, ' + n + ' screen' + (n === 1 ? '' : 's') : state.layout === 'webpage' ? 'webpage · one page, ' + n + ' section' + (n === 1 ? '' : 's') : 'slide · 16:9'], ['brand', (brand.name || '—') + (brand.id ? ' · ' + brand.id : '') + (m.brand && brand.id && m.brand !== brand.id ? ' (the deck asks for ' + m.brand + ')' : '')], ['theme', m.theme || '—'],
      ['story', (function () { var arc = state.slides.map(function (sec) { return sec.getAttribute('data-intent') || '·'; }); return arc.some(function (a) { return a !== '·'; }) ? arc.join(' › ') : '— (no intents)'; })()],
      ['language', m.lang || '—'], ['date', m.date || '—'], ['images', imgs ? imgs + ' embedded' : 'none'],
      ['size', fmtSize(fileSize) + ' · source ' + fmtSize(srcSize)],
      m.source ? ['imported from', m.source] : null, ['format', m.format || '—'], ['runtime', 'james-jmd ' + RUNTIME_VERSION]
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
    state.layout = JMD.layout(doc);
    JMD.LAYOUTS.forEach(function (l) { document.body.classList.toggle('layout-' + l, l === state.layout); });
    // the paper: Slide 1280×720 px (engine.css); Doc and Webpage A4 portrait; Story 1080×1920 px, the format of a story or a carousel page
    pageStyle.textContent = state.layout === 'doc' || state.layout === 'webpage' ? '@page{size:210mm 297mm;margin:0}' : state.layout === 'story' ? '@page{size:1080px 1920px;margin:0}' : '';
    if (!state.motion) { var saved = null; try { saved = localStorage.getItem('james-jmd.motion'); } catch (e) { } setMotion(saved || brand.motion || 'soft', false); } else setMotion(state.motion, false);
    track.innerHTML = render(doc, { brand: brand, assets: assets });
    state.slides = Array.prototype.slice.call(track.querySelectorAll('.slide'));
    document.title = (doc.meta.title || state.name) + ' — james-jmd';
    openEl.classList.remove('is-open');
    state.lint = lint(doc, { assets: assets, assetsAuthoritative: false });
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
  function toggleEdit() {
    if (!state.slides.length) return;
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
      lines[lineIdx] = parts[0] + cols.map(function (c) { return c.replace(/\|/g, '\\|'); }).join(' | ') + parts[2];
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
  track.addEventListener('mousedown', function (e) {
    if (!state.editing || e.button !== 0) return;
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
    download(state.name.replace(/\.jmd$/, '') + '.james-jmd.html', html, 'text/html');
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
    window.print();
  }

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
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'm' || k === 'M') cycleMotion();
    else if (k === '?' || k === 'h' || k === 'H') helpEl.classList.toggle('is-open');
    else if (k === 'Escape' && helpEl.classList.contains('is-open')) helpEl.classList.remove('is-open');
    else if (k === 'Home') show(0);
    else if (k === 'End') show(state.slides.length - 1);
    else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
    else if (k === 'n' || k === 'N') toggleNotes();
    else if (k === 'i' || k === 'I') toggleInfo();
    else if (k === 'e' || k === 'E') { e.preventDefault(); if (!state.editing) state.editTarget = 'slide'; toggleEdit(); } // preventDefault: the E must not land in the textarea
    else if (k === 'Escape' && state.editing) toggleEdit();
    else if (k === 'Escape' && infoEl.classList.contains('is-open')) toggleInfo();
    else if (k === 'p' || k === 'P') printPDF();
    else if (k === 's' || k === 'S') exportSelfContained();
    else if (k === 'o' || k === 'O') document.getElementById('open-file').click();
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('#notes, #info, #help, #open, #hud, #edit')) return;
    if (state.editing) { if (inlinePressed) { inlinePressed = false; return; } if (inline_ && !e.target.closest('.is-inline')) endInline(true); return; } // in edit mode, clicks edit; they don't navigate
    if (isDoc()) return; // a Doc scrolls; a click on it is a click
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

  window.jamesJmd = { version: RUNTIME_VERSION, fit: fit, editTarget: setEditTarget, parse: parse, lint: lint, render: render, load: load, show: show, next: next, prev: prev, motion: setMotion, edit: toggleEdit, applyEdit: editorApply, beginInline: beginInline, endInline: endInline, editorFill: editorFill, editSrc: editSrc, editTitle: editTitle, state: state };
})();
