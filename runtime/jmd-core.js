/* jmd core — parser, blocks, string renderer, linter. Shared by the browser runtime and Node (CLI, MCP).
   Plain script: no import/export, it defines globalThis.JMD. Zero dependencies.
   Every node keeps its source line range (map) for V2 in-place editing. */
globalThis.JMD = (function () {
  'use strict';

  var VERSION = '1.32.0';
  var FORMAT_MAX = 1;
  // layouts (spec/jmd.md): the page the deck is made of — one table, the runtime and the CSS read it.
  //   w, h   the page in design units (the slide's px: every block's CSS is written in them); h 0 = as tall as its content
  //   zoom   design units → screen/paper px (engine.css applies the same figure): Doc 1280 × .62 = 794 = A4 wide; Story 640 × 1.687 = 1080 (× 1138 = 1919.8: under the 1920 of the paper, never a blank sheet)
  //   limit  where content must stop (overflow), in design units; 0 = no limit
  //   flow   screen: one page at a time (← →, motion) · scroll: the pages stack and scroll
  var LAYOUTS = ['slide', 'doc', 'story', 'webpage'];
  var PAGES = {
    slide: { w: 1280, h: 720, limit: 660, zoom: 1, flow: 'screen' },
    doc: { w: 1280, h: 1810, limit: 1730, zoom: 0.62, flow: 'scroll' },
    story: { w: 640, h: 1138, limit: 1060, zoom: 1.687, flow: 'screen' },
    webpage: { w: 1280, h: 0, limit: 0, zoom: 1, flow: 'scroll' }
  };
  /* The name every file of a deck leaves under — the page, the PDF, the PowerPoint, the images, in the browser and on the
     server alike (2026-10-07: one name, made in one place): its title as a person reads it, accents and spaces kept,
     only what a file system refuses replaced, 80 characters at most; no title → the source's own name, else "deck".
     `suffix` is what follows it (".pptx", ".james-jmd.html", " (images).zip"); `version` a published version's number. */
  function fileName(doc, suffix, opts) {
    opts = opts || {};
    var clean = function (s) { return String(s || '').normalize('NFC').replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim(); };
    var stem = clean(doc && doc.meta && doc.meta.title) || clean(String(opts.fallback || '').replace(/\.(jmd|md)$/i, '')) || 'deck';
    return stem + (opts.version ? ' (v' + opts.version + ')' : '') + (suffix || '');
  }

  function layout(doc) { var l = doc && doc.meta && doc.meta.layout; return PAGES[l] ? l : 'slide'; }

  /* Renaming a deck is **an edit of its source**, because that is where its name lives — `title:` in the document header,
     and `meta.title` is only what the store measured from it. One function, so the editor's Rename and `/me`'s make the
     same edit: the header's own `title:` line if it has one, a line added to the header if it has none, and a header if the
     deck has none at all. The name goes on a `key: value` line, so everything that would end that line early or rewrite the
     ones around it is taken out first — newlines, control characters, bidi overrides, zero-widths — and it is cut, like
     every deck value this codebase lets a person set. An empty name changes nothing: a deck with no title is a case the
     whole chain already handles, and losing a name by wiping a field is not a gesture anybody means to make. */
  function withTitle(src, title) {
    var t = String(title == null ? '' : title)
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\u202A-\u202E\uFEFF]/g, '')
      .trim().slice(0, 200).trim();
    if (!t) return src;
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    if (lines[0] !== '---') return '---\ntitle: ' + t + '\n---\n' + lines.join('\n');
    var j = 1;
    while (j < lines.length && lines[j] !== '---') j++;
    for (var i = 1; i < j; i++) if (/^title\s*:/i.test(lines[i])) { lines[i] = 'title: ' + t; return lines.join('\n'); }
    lines.splice(1, 0, 'title: ' + t);
    return lines.join('\n');
  }

  /* ───────────────────────── utils ───────────────────────── */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeUrl(u) {
    u = String(u).trim();
    return /^(https?:|mailto:|#|\/|\.)/i.test(u) ? u : '#';
  }
  // Inline Markdown, deliberately poor: links, bold, italic, code. No raw HTML gets through.
  // `[text](url){.cta}` → a link; `.cta` makes it a button.
  // An image inside a text (`![](x)` in a card title, a bullet, a cell) is not drawn — an image stands alone on its line —
  // and is not printed either: the linter says it (`inline-image`), the slide never shows the syntax (seen in the field, 2026-10-12).
  function inline(s) {
    return esc(String(s).replace(INLINE_IMG, '').replace(/\s{2,}/g, ' ').trim())
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)(\{[^}]*\})?/g, function (_, t, u, m) {
        var cls = mods(m || '').classes;
        return '<a href="' + esc(safeUrl(u)) + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>';
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  // `{.hero .now}` → { classes:[...] } — `{.Hero}` reads the same: what the format names is case-insensitive
  function mods(s) {
    var m = { classes: [] };
    (String(s).match(/\.[\w-]+/g) || []).forEach(function (c) { m.classes.push(c.slice(1).toLowerCase()); });
    return m;
  }
  var INLINE_IMG = /!\[[^\]]*\]\([^)\s]*\)(\{[^}]*\})?/g;
  var IMG = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*(\{[^}]*\})?\s*$/; // an image alone on its line

  /* ───────────────────────── parser ───────────────────────── */
  var KV = /^([A-Za-z][\w-]*):\s*(.*)$/;
  // Case: what the format names — keys, the values it enumerates, a brand id, a block, a modifier — is read in lowercase
  // (`Layout: Doc`, `Intent: Hook`, `::: Cards`, `{.Hero}` all work). What the author writes — a title, notes, a section
  // label, a URL — keeps its case; a brand URL is not an id, it is left alone.
  var ENUM_KEYS = ['format', 'layout', 'intent', 'bg', 'brand', 'theme', 'template'];
  function parseKV(lines) {
    var o = {};
    lines.forEach(function (l) {
      var m = KV.exec(l);
      if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
      if (ENUM_KEYS.indexOf(k) >= 0 && !/:\/\//.test(v)) v = v.toLowerCase();
      o[k] = v;
    });
    return o;
  }
  function isKVBlock(lines) {
    var some = false;
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (!KV.test(lines[i])) return false;
      some = true;
    }
    return some;
  }

  // Split the file: document frontmatter, then slides separated by `---`.
  // After a `---`, if every line up to the next `---` is `key: value`, that's the slide frontmatter.
  function parse(src) {
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var doc = { meta: {}, slides: [], map: [0, lines.length], lines: lines };
    var i = 0, inFence = false;

    if (lines[0] === '---') {
      var j = 1;
      while (j < lines.length && lines[j] !== '---') j++;
      doc.meta = parseKV(lines.slice(1, j));
      doc.metaMap = [0, j + 1];
      i = j + 1;
    }

    var cur = null;
    function newSlide(at) {
      cur = { meta: {}, lines: [], start: at, map: [at, at] };
      doc.slides.push(cur);
    }
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) inFence = !inFence;
      if (!inFence && l === '---') {
        newSlide(i);
        var k = i + 1;
        while (k < lines.length && lines[k] !== '---') k++;
        if (k < lines.length && isKVBlock(lines.slice(i + 1, k))) {
          cur.meta = parseKV(lines.slice(i + 1, k));
          cur.metaMap = [i + 1, k];
          i = k + 1;
        } else {
          i++;
        }
        cur.bodyStart = i;
        continue;
      }
      if (!cur) newSlide(i);
      cur.lines.push(l);
      cur.map[1] = i + 1;
      i++;
    }
    doc.slides = doc.slides.filter(function (s) { return s.lines.join('').trim() || Object.keys(s.meta).length; });
    doc.slides.forEach(parseSlideBody);
    return doc;
  }

  // Slide body → nodes: title, lead, block, image, prose
  function parseSlideBody(slide) {
    /* Where this slide's first line sits **in the document**, which is what every node's map is counted from — and what
       `data-line` carries, so a click on a text in the editor writes back to the line it came from. `bodyStart` exists only
       for a slide a `---` opened; the first slide of a deck whose body follows the front matter directly is opened by the
       `!cur` branch and has none, and falling back to 0 made every one of its nodes claim the top of the document. A click
       on that slide's title then rewrote line 0 — the front matter's own `---` — leaving the title on screen unchanged and
       the deck without a header (2026-09-27). The fallback is the slide's own start, which both branches always set. */
    var nodes = [], L = slide.lines, base = slide.bodyStart == null ? (slide.start || 0) : slide.bodyStart;
    var i = 0, prose = null;
    function flushProse() { if (prose && prose.lines.some(function (x) { return x.trim(); })) nodes.push(prose); prose = null; }
    while (i < L.length) {
      var l = L[i];
      var mBlock = /^:::\s*([A-Za-z][\w-]*)\s*(\{[^}]*\})?\s*$/.exec(l);
      if (mBlock) {
        flushProse();
        var start = i; i++;
        var body = [];
        while (i < L.length && !/^:::\s*$/.test(L[i])) { body.push(L[i]); i++; }
        nodes.push({ type: 'block', name: mBlock[1].toLowerCase(), attrs: mods(mBlock[2] || ''), lines: body, map: [base + start, base + i + 1] });
        i++;
        continue;
      }
      var mI = IMG.exec(l);
      if (mI) {
        flushProse();
        nodes.push({ type: 'image', alt: mI[1], src: mI[2], attrs: mods(mI[3] || ''), map: [base + i, base + i + 1] });
        i++;
        continue;
      }
      var mH = /^(#{1,3})\s+(.*)$/.exec(l);
      if (mH && !nodes.some(function (n) { return n.type === 'title'; })) {
        flushProse();
        nodes.push({ type: 'title', level: mH[1].length, text: mH[2].trim(), map: [base + i, base + i + 1] });
        i++;
        // lead: the first paragraph right after the title
        var k = i; while (k < L.length && !L[k].trim()) k++;
        if (k < L.length && !/^(:::|#|- |\* |\d+\. |```|!\[)/.test(L[k])) {
          var leadLines = []; var s0 = k;
          while (k < L.length && L[k].trim() && !/^(:::|#|- |```|!\[)/.test(L[k])) { leadLines.push(L[k]); k++; }
          nodes.push({ type: 'lead', text: leadLines.join(' '), map: [base + s0, base + k] });
          i = k;
        }
        continue;
      }
      if (!prose) prose = { type: 'prose', lines: [], map: [base + i, base + i + 1] };
      prose.lines.push(l); prose.map[1] = base + i + 1;
      i++;
    }
    flushProse();
    slide.nodes = nodes;
  }

  function splitItem(line) {
    var mM = /\s*\{([^}]*)\}\s*$/.exec(line);
    var attrs = mods(mM ? mM[1] : '');
    if (mM) line = line.slice(0, mM.index);
    var cols = line.split(/(?<!\\)\s\|\s|(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
    return { cols: cols, attrs: attrs };
  }
  // the `- a | b | c` items of a block, with their source line
  function items(block) {
    var out = [];
    block.lines.forEach(function (l, k) {
      var m = /^\s*[-*]\s+(.*)$/.exec(l);
      if (!m) return;
      var it = splitItem(m[1]);
      it.line = block.map[0] + 1 + k;
      out.push(it);
    });
    return out;
  }
  // heading form: `### Title` opens a column/card, `-` lines are its bullets, plain lines its text; `{.mod}` on the heading
  function sections(block) {
    var cols = [], cur = null;
    block.lines.forEach(function (l, k) {
      var mH = /^#{2,3}\s+(.*)$/.exec(l);
      if (mH) {
        var t = splitItem(mH[1]);
        cur = { title: t.cols.join(' | '), attrs: t.attrs, items: [], text: [], line: block.map[0] + 1 + k, itemLines: [], textLines: [] }; cols.push(cur); return;
      }
      var mI = /^\s*[-*]\s+(.*)$/.exec(l);
      if (mI) { if (!cur) { cur = { title: '', attrs: mods(''), items: [], text: [], line: null, itemLines: [], textLines: [] }; cols.push(cur); } cur.items.push(mI[1]); cur.itemLines.push(block.map[0] + 1 + k); return; }
      if (l.trim() && cur) {
        var t2 = splitItem(l);
        if (t2.attrs.classes.length) cur.attrs.classes = cur.attrs.classes.concat(t2.attrs.classes);
        cur.text.push(t2.cols.join(' | ')); cur.textLines.push(block.map[0] + 1 + k);
      }
    });
    return cols;
  }
  function hasHeadings(block) { return block.lines.some(function (l) { return /^#{2,3}\s/.test(l); }); }
  function has(attrs, c) { return attrs && attrs.classes.indexOf(c) >= 0; }
  // source mapping for in-place editing: which line (and which `|` column) a rendered text comes from
  function src(line, col) { return line == null ? '' : ' data-line="' + line + '"' + (col == null ? '' : ' data-col="' + col + '"'); }

  /* ───────────────────────── images ───────────────────────── */
  // ctx.assets: { path → data URI or URL }. Unresolved → an empty frame (the linter reports it).
  function imgTag(src, alt, ctx, cls) {
    var url = ctx && ctx.assets && ctx.assets[src];
    if (!url) return '<div class="img-missing' + (cls ? ' ' + cls : '') + '" data-src="' + esc(src) + '"><span>' + esc(alt || src) + '</span></div>';
    return '<img src="' + esc(url) + '" alt="' + esc(alt || '') + '"' + (cls ? ' class="' + cls + '"' : '') + '>';
  }

  /* ───────────────────────── card icons ─────────────────────────
     A small set of line icons (24×24, stroke 2). A card gets the one its title means; otherwise an abstract glyph, rotating. */
  var ICONS = {
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    chat: '<path d="M4 5h16v10H9l-5 4z"/>',
    book: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 5"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 15l4-5 3 3 5-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/>',
    plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    code: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M14 4l-4 16"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14l-1.5 7 5-3 5 3-1.5-7"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M13 7l3 3"/>',
    rocket: '<path d="M12 3c3 2 5 6 5 10l-2 2h-6l-2-2c0-4 2-8 5-10z"/><path d="M7 13l-3 2 2 3M17 13l3 2-2 3"/><path d="M12 18v3"/>',
    euro: '<path d="M18 7a6 6 0 1 0 0 10"/><path d="M4 10h9M4 14h9"/>',
    eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    // abstract glyphs, for cards no keyword matches: they rotate so neighbours differ
    spark: '<path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18"/>',
    ring: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>',
    diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
    wave: '<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>',
    dots: '<circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="3"/>'
  };
  var GLYPHS = ['spark', 'ring', 'diamond', 'wave', 'dots', 'square'];
  // keyword → icon; French and English, checked in order on the card title
  var ICON_WORDS = [
    [/s[ée]curit|secur|conformit|complian|rgpd|gdpr|nis2|dora|protect/i, 'shield'],
    [/certif|iso|label|award|prix|trophy|qualit/i, 'award'],
    [/chat|messag|conversation|tchat|discussion|talk|hello|standup|stand-up/i, 'chat'],
    [/mail|courriel|inbox|newsletter/i, 'mail'],
    [/document|docs?\b|formation|training|knowledge|wiki|manuel|guide|learn|book|lecture/i, 'book'],
    [/temps|time|heure|horaire|d[ée]lai|rythme|jour|semaine|daily|quotidien|rituel|ritual/i, 'clock'],
    [/[ée]quipe|team|squad|manager|people|collab|communaut|community|utilisateur|user|membre|rh\b|humain|personne/i, 'users'],
    [/indicat|kpi|mesur|metric|statisti|analytic|adoption|usage|croissance|growth|report|dashboard|tableau de bord|performance/i, 'chart'],
    [/outil|tool|param|setting|config|admin|maintenance|technique|technical|infra|it\b/i, 'gear'],
    [/roadmap|objectif|goal|milestone|jalon|priorit|arbitrage|strat/i, 'flag'],
    [/api|connect|int[ée]gration|plug|partenaire|partner|[ée]cosyst/i, 'plug'],
    [/mobile|phone|t[ée]l[ée]phone|app\b|ios|android/i, 'phone'],
    [/code|d[ée]velop|dev\b|open.?source|git|repo|logiciel|software|techno/i, 'code'],
    [/donn[ée]e|data|sauvegarde|backup|stockage|storage|base|h[ée]berg|hosting|cloud|serveur|server/i, 'database'],
    [/valid|check|recette|test|qa\b|v[ée]rif|ok\b|done|fait|termin/i, 'check'],
    [/cible|target|focus|pr[ée]cis|discovery|besoin|need/i, 'target'],
    [/version|release|mep|d[ée]ploi|deploy|livraison|delivery|cycle|it[ée]ration|sprint/i, 'rocket'],
    [/prix|tarif|price|co[uû]t|cost|budget|€|\$|financ|revenu|arr\b|mrr\b|vente|sales|commercial/i, 'euro'],
    [/vision|voir|see|watch|regard|transparen|visib|observ/i, 'eye'],
    [/design|maquette|mockup|figma|ux\b|ui\b|graphi|[ée]crit|write|r[ée]dac|spec/i, 'pen'],
    [/recherch|search|find|trouv|explor|audit/i, 'search'],
    [/agenda|calend|date|planning|schedule|[ée]v[ée]nement|event|r[ée]union|meeting|atelier|workshop/i, 'calendar'],
    [/maison|home|accueil|bureau|office|pr[ée]sentiel|local|site\b/i, 'home'],
    [/monde|world|global|international|pays|country|europe|souverain|sovereign/i, 'globe'],
    [/carte|map|territoire|r[ée]gion|parcours|journey|chemin|path/i, 'map'],
    [/couche|layer|architecture|structure|module|stack|plateforme|platform|organisation|organization/i, 'layers'],
    [/rapide|fast|vite|instant|urgence|alert|crise|crisis|incident|r[ée]activ|energy|[ée]nergie/i, 'bolt'],
    [/favori|star|best|top\b|excellence|premium|h[ée]ro|hero/i, 'star'],
    [/confiance|trust|priv[ée]|private|secret|mot de passe|password|acc[èe]s|access|identit|auth/i, 'lock'],
    [/c[œoe]ur|heart|amour|love|care|soin|bien-?[êe]tre|culture|valeur|value/i, 'heart']
  ];
  function iconFor(title, k) {
    var t = title || '';
    for (var i = 0; i < ICON_WORDS.length; i++) if (ICON_WORDS[i][0].test(t)) return ICON_WORDS[i][1];
    return GLYPHS[k % GLYPHS.length];
  }
  function iconSvg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.spark) + '</svg>'; }

  /* ───────────────────────── data: table and chart (spec/charts.md) ─────────────────────────
     Both are data, never code: a cell goes through inline() like every text, a chart value must read as a number, and the
     SVG is built here from numbers and escaped labels only — nothing the author writes reaches an attribute but a number. */
  var COLS = /(?<!\\)\s\|\s|(?<!\\)\|/; // the editor's split (runtime/james-jmd.js): data-col counts the same columns it rewrites
  var TABLE_SEP = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
  function isRow(l) { return /(^|[^\\])\|/.test(l); }
  // `| a | b |` or `a | b` → the cells, each with the column the editor counts (a leading `|` makes an empty column 0)
  function tableRow(l) {
    var mM = /\s*\{([^}]*)\}\s*$/.exec(l), attrs = mods(mM ? mM[1] : '');
    if (mM) l = l.slice(0, mM.index);
    var parts = l.trim().split(COLS).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
    var cells = parts.map(function (t, k) { return { text: t, col: k }; });
    if (/^\|/.test(l.trim())) cells.shift();
    if (/(^|[^\\])\|$/.test(l.trim()) && cells.length && !cells[cells.length - 1].text) cells.pop();
    return { cells: cells, attrs: attrs };
  }
  function table(b) {
    var rows = [], head = null, align = [];
    b.lines.forEach(function (l, k) {
      if (!l.trim() || !isRow(l)) return;
      if (TABLE_SEP.test(l.trim())) {
        if (rows.length === 1 && !head) {
          head = rows.pop();
          align = tableRow(l).cells.map(function (c) { var t = c.text; return /^:-+:$/.test(t) ? 'center' : /-:$/.test(t) ? 'right' : /^:-/.test(t) ? 'left' : ''; });
        }
        return;
      }
      var r = tableRow(l); r.line = b.map[0] + 1 + k; rows.push(r);
    });
    var width = Math.max(head ? head.cells.length : 0, rows.reduce(function (m, r) { return Math.max(m, r.cells.length); }, 0));
    return { head: head, rows: rows, align: align, width: width };
  }
  var TABLE_MAX = 12, TABLE_SPLIT_MAX = 24, TABLE_SPLIT_COLS = 3;
  function tableSplit(b, t) { return has(b.attrs, 'split') || (t || table(b)).rows.length > TABLE_MAX; }
  // a number as people write it in a cell or a chart: `1 200`, `3,5`, `42 %`, `-7`, `€5.2M` — the unit around it is not the value
  function num(s) {
    var m = /^[^\d\-+.,]*([-+]?\d[\d\s\u00A0\u202F]*(?:[.,]\d+)?)\s*[^\d]*$/.exec(String(s).trim());
    if (!m) return null;
    var v = parseFloat(m[1].replace(/[\s\u00A0\u202F]/g, '').replace(',', '.'));
    return isFinite(v) ? v : null;
  }

  var CHART_TYPES = ['bar', 'hbar', 'line', 'pie'];
  var CHART_MAX = { bar: 12, hbar: 8, line: 24, pie: 6 };
  var SERIES_MAX = 4;
  function chartType(b) { for (var i = 0; i < b.attrs.classes.length; i++) { var c = b.attrs.classes[i] === 'donut' ? 'pie' : b.attrs.classes[i]; if (CHART_TYPES.indexOf(c) >= 0) return c; } return 'bar'; }
  // `- label | value | value…` items; `series: A | B` names the columns, `unit: k€` follows every value
  function chart(b) {
    var opts = {};
    b.lines.forEach(function (l) { var m = /^\s*(series|unit)\s*:\s*(.*)$/i.exec(l); if (m) opts[m[1].toLowerCase()] = m[2].trim(); });
    var its = items(b).map(function (it) {
      return { label: it.cols[0] || '', raw: it.cols.slice(1), values: it.cols.slice(1).map(num), hero: has(it.attrs, 'hero'), line: it.line };
    });
    var n = its.reduce(function (m, it) { return Math.max(m, it.values.length); }, 0);
    var series = opts.series ? opts.series.split(COLS).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    return { type: chartType(b), items: its, n: n, series: series, unit: opts.unit || '' };
  }
  function fmt(v, dec) { // a value drawn on the chart: at most two decimals, the thousands spaced, the decimal mark of the deck's language
    var r = Math.round(v * 100) / 100, s = String(Math.abs(r)).split('.');
    return (r < 0 ? '\u2212' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + (s[1] ? (dec || '.') + s[1] : '');
  }
  function f1(x) { return String(Math.round(x * 10) / 10); }
  function cut(s, max) { s = String(s); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s; }
  // the step of an axis of about four ticks: 1, 2, 2.5 or 5 times a power of ten — the top tick sits just above the data
  function niceStep(v) { if (v <= 0) return 1; var raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  // the drawing box per layout, in design units (= the px of the type): the SVG is never scaled, so 16 reads as 16 everywhere
  function chartBox(ctx, right) {
    var lay = ctx && ctx.layout;
    if (lay === 'story') return { w: 544, h: 440 };
    if (lay === 'doc') return { w: 1060, h: right ? 460 : 520 };
    if (right) return { w: 544, h: 400 };
    return { w: 1088, h: lay === 'webpage' ? 400 : 360 };
  }
  // several series: their names, above the drawing (a pie names its slices in its own list)
  function chartLegend(c) {
    if (c.n < 2 || c.type === 'pie') return '';
    var keys = [];
    for (var s = 0; s < Math.min(c.n, SERIES_MAX); s++) keys.push('<span class="chart-key chart-s' + (s + 1) + '"><i></i>' + inline(c.series[s] || ('Series ' + (s + 1))) + '</span>');
    return '<div class="chart-legend">' + keys.join('') + '</div>';
  }
  function chartSvg(c, box, id) {
    var W = box.w, H = box.h, its = c.items, out = [], fs = 16, S = Math.min(c.n, SERIES_MAX) || 1;
    function k_(k) { return ' style="--k:' + Math.min(k, 23) + '"'; } // the order an element arrives in (engine.css, motion)
    // the gradients: one per series, ids unique in the page (`jc-<n>-`), the colors from classes — never from the source
    var defs = '<defs>' + Array.apply(null, Array(S)).map(function (_, s) {
      return '<linearGradient id="' + id + 'g' + (s + 1) + '" class="chart-grad chart-s' + (s + 1) + '" x1="0" y1="0" x2="' + (c.type === 'hbar' ? 1 : 0) + '" y2="' + (c.type === 'hbar' ? 0 : 1) + '"><stop offset="0"/><stop offset="1"/></linearGradient>' +
        '<linearGradient id="' + id + 'a' + (s + 1) + '" class="chart-area-grad chart-s' + (s + 1) + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>';
    }).join('') + '</defs>';
    out.push(defs);
    function fill(s) { return ' fill="url(#' + id + 'g' + (s + 1) + ')"'; }
    var vals = []; its.forEach(function (it) { it.values.slice(0, S).forEach(function (v) { if (v != null) vals.push(v); }); });
    var hi = vals.length ? Math.max.apply(null, vals) : 1, lo = vals.length ? Math.min.apply(null, vals) : 0;
    var unit = c.unit ? '\u00A0' + c.unit : '';
    function lbl(v) { return esc(fmt(v, c.dec) + unit); }
    var anyHero = its.some(function (it) { return it.hero; });
    if (c.type === 'pie') {
      var tot = its.reduce(function (s, it) { return s + Math.max(0, it.values[0] || 0); }, 0) || 1;
      var R = Math.min(H, 360) / 2 - 4, r0 = R * 0.58, cx = R + 4, cy = H / 2, a = -Math.PI / 2;
      its.forEach(function (it, k) {
        var v = Math.max(0, it.values[0] || 0), da = v / tot * Math.PI * 2; if (!da) return;
        var a2 = a + Math.min(da, Math.PI * 2 - 1e-4), big = da > Math.PI ? 1 : 0;
        var p = function (rr, t) { return f1(cx + rr * Math.cos(t)) + ' ' + f1(cy + rr * Math.sin(t)); };
        out.push('<path class="chart-slice chart-c' + (k % 6 + 1) + (it.hero ? ' is-hero' : '') + '"' + k_(k) + ' d="M' + p(R, a) + 'A' + f1(R) + ' ' + f1(R) + ' 0 ' + big + ' 1 ' + p(R, a2) + 'L' + p(r0, a2) + 'A' + f1(r0) + ' ' + f1(r0) + ' 0 ' + big + ' 0 ' + p(r0, a) + 'Z"/>');
        a += da;
      });
      // the hero's share in the hole: the one number the slice is there to say
      var hero = its.filter(function (it) { return it.hero; })[0];
      var center = hero ? '<text class="chart-total"' + k_(its.length) + ' x="' + f1(cx) + '" y="' + f1(cy) + '" text-anchor="middle" dominant-baseline="central" font-size="' + Math.round(r0 * 0.46) + '">' + Math.round(Math.max(0, hero.values[0] || 0) / tot * 100) + '\u00A0%</text>' : '';
      return '<svg class="chart-svg" viewBox="0 0 ' + f1(2 * R + 8) + ' ' + H + '" width="' + f1(2 * R + 8) + '" height="' + H + '" style="--cx:' + f1(cx) + 'px;--cy:' + f1(cy) + 'px" role="img" aria-hidden="true">' + out.join('') + center + '</svg>';
    }
    // bars say their value: the tallest one touches the top. A line reads against its ticks: the top tick sits just above it
    var span = Math.max(hi, 0) - Math.min(lo, 0) || 1, step = niceStep(span);
    var max = c.type === 'line' ? Math.ceil(Math.max(hi, 0) / step) * step || step : Math.max(hi, 0), min = c.type === 'line' ? Math.floor(Math.min(lo, 0) / step) * step : Math.min(lo, 0);
    if (max === min) max = min + 1;
    if (c.type === 'hbar') {
      var lw = Math.min(W * 0.32, 260), vw = 90, rowH = (H - 8) / Math.max(its.length, 1), bh = Math.min(rowH * 0.62, 44) / S;
      var x0 = lw + (W - lw - vw) * (-min / (max - min)), scale = (W - lw - vw) / (max - min);
      its.forEach(function (it, k) {
        var y = 4 + k * rowH + (rowH - bh * S) / 2;
        out.push('<text class="chart-label" x="' + f1(lw - 12) + '" y="' + f1(4 + k * rowH + rowH / 2) + '" text-anchor="end" dominant-baseline="central" font-size="' + fs + '">' + esc(cut(it.label, Math.floor(lw / (fs * 0.55)))) + '</text>');
        it.values.slice(0, S).forEach(function (v, s) {
          if (v == null) return;
          var xa = Math.min(x0, x0 + v * scale), w = Math.abs(v * scale), yy = y + s * bh;
          out.push('<rect class="chart-bar chart-s' + (s + 1) + (it.hero ? ' is-hero' : anyHero ? ' is-quiet' : '') + (v < 0 ? ' is-neg' : '') + '"' + k_(k) + fill(s) + ' x="' + f1(xa) + '" y="' + f1(yy) + '" width="' + f1(Math.max(w, 1)) + '" height="' + f1(bh - (S > 1 ? 2 : 0)) + '" rx="' + f1(Math.min(6, bh / 3)) + '"/>');
          out.push('<text class="chart-value"' + k_(k) + ' x="' + f1(v < 0 ? xa - 8 : xa + w + 8) + '" y="' + f1(yy + bh / 2) + '" text-anchor="' + (v < 0 ? 'end' : 'start') + '" dominant-baseline="central" font-size="' + (S > 1 ? fs - 2 : fs) + '">' + lbl(v) + '</text>');
        });
      });
      out.push('<line class="chart-axis" x1="' + f1(x0) + '" x2="' + f1(x0) + '" y1="0" y2="' + H + '"/>');
    } else {
      var top = 30, bottom = 40, left = c.type === 'line' ? 64 : 4, right = c.type === 'line' ? 24 : 4;
      var ph = H - top - bottom, pw = W - left - right, y = function (v) { return top + ph * (max - v) / (max - min); };
      var slot = pw / Math.max(its.length, 1), maxCh = Math.max(3, Math.floor(slot / (fs * 0.55)));
      if (c.type === 'line') for (var tv = min; tv <= max + step / 1e6; tv += step) (function (v) {
        out.push('<line class="chart-grid" x1="' + left + '" x2="' + (W - right) + '" y1="' + f1(y(v)) + '" y2="' + f1(y(v)) + '"/>');
        out.push('<text class="chart-tick" x="' + (left - 10) + '" y="' + f1(y(v)) + '" text-anchor="end" dominant-baseline="central" font-size="' + (fs - 2) + '">' + lbl(v) + '</text>');
      })(Math.round(tv * 1e6) / 1e6);
      // labels that would touch are thinned: one in two (or three…), the last always said
      var longest = its.reduce(function (m, it) { return Math.max(m, Math.min(String(it.label).length, maxCh)); }, 1);
      var every = Math.max(1, Math.ceil((longest * fs * 0.62 + 12) / slot));
      its.forEach(function (it, k) {
        if (k % every && k !== its.length - 1) return;
        if (k !== its.length - 1 && every > 1 && its.length - 1 - k < every) return; // never two labels side by side at the end
        out.push('<text class="chart-label" x="' + f1(left + slot * (k + 0.5)) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="' + fs + '">' + esc(cut(it.label, every > 1 ? longest : maxCh)) + '</text>');
      });
      if (c.type === 'bar') {
        var gw = Math.min(slot * 0.7, 120 * S), bw = gw / S;
        its.forEach(function (it, k) {
          it.values.slice(0, S).forEach(function (v, s) {
            if (v == null) return;
            var x = left + slot * k + (slot - gw) / 2 + s * bw, ya = Math.min(y(v), y(0)), hgt = Math.abs(y(v) - y(0));
            out.push('<rect class="chart-bar chart-s' + (s + 1) + (it.hero ? ' is-hero' : anyHero ? ' is-quiet' : '') + (v < 0 ? ' is-neg' : '') + '"' + k_(k) + fill(s) + ' x="' + f1(x + (S > 1 ? 1 : 0)) + '" y="' + f1(ya) + '" width="' + f1(bw - (S > 1 ? 2 : 0)) + '" height="' + f1(Math.max(hgt, 1)) + '" rx="' + f1(Math.min(8, bw / 4)) + '"/>');
            if (S === 1 || bw >= 44) out.push('<text class="chart-value"' + k_(k) + ' x="' + f1(x + bw / 2) + '" y="' + f1(v < 0 ? ya + hgt + 18 : ya - 9) + '" text-anchor="middle" font-size="' + (S > 1 ? fs - 3 : fs + 2) + '">' + lbl(v) + '</text>');
          });
        });
      } else {
        for (var s = 0; s < S; s++) {
          var pts = []; its.forEach(function (it, k) { var v = it.values[s]; if (v != null) pts.push([left + slot * (k + 0.5), y(v), v, it.hero]); });
          if (!pts.length) continue;
          var line = pts.map(function (q) { return f1(q[0]) + ',' + f1(q[1]); }).join(' ');
          // one series: the area under the line, in the series' color fading to nothing
          if (S === 1 && pts.length > 1) out.push('<polygon class="chart-area" fill="url(#' + id + 'a1)" points="' + f1(pts[0][0]) + ',' + f1(y(Math.max(min, 0))) + ' ' + line + ' ' + f1(pts[pts.length - 1][0]) + ',' + f1(y(Math.max(min, 0))) + '"/>');
          out.push('<polyline class="chart-line chart-s' + (s + 1) + '"' + k_(s) + ' pathLength="1" points="' + line + '"/>');
          pts.forEach(function (q, k) {
            out.push('<circle class="chart-dot chart-s' + (s + 1) + (q[3] ? ' is-hero' : '') + '"' + k_(Math.round(k * 12 / Math.max(pts.length, 1))) + ' cx="' + f1(q[0]) + '" cy="' + f1(q[1]) + '" r="' + (q[3] ? 8 : 5) + '"/>');
            // one series: every point says its value when there is room, else the first, the last and the hero; several: the last only
            var say = S === 1 ? (pts.length <= 12 || q[3] || k === 0 || k === pts.length - 1) : k === pts.length - 1;
            if (say) out.push('<text class="chart-value"' + k_(Math.round(k * 12 / Math.max(pts.length, 1))) + ' x="' + f1(q[0]) + '" y="' + f1(q[1] - 14) + '" text-anchor="middle" font-size="' + fs + '">' + lbl(q[2]) + '</text>');
          });
        }
      }
      out.push('<line class="chart-axis" x1="' + left + '" x2="' + (W - right) + '" y1="' + f1(y(0)) + '" y2="' + f1(y(0)) + '"/>');
    }
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-hidden="true">' + out.join('') + '</svg>';
  }
  // what a screen reader and a copy-paste get: the numbers as text, hidden under the drawing
  function chartText(c) {
    return '<table class="chart-data">' + (c.series.length ? '<tr><th></th>' + c.series.map(function (s) { return '<th>' + inline(s) + '</th>'; }).join('') + '</tr>' : '') +
      c.items.map(function (it) { return '<tr><th>' + inline(it.label) + '</th>' + it.raw.map(function (v) { return '<td>' + inline(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  }

  /* ───────────────────────── diagram: Mermaid read, drawn by us (spec/charts.md) ─────────────────────────
     The text is Mermaid's flowchart — what every model writes, what Docs, GitHub and Notion draw — but no Mermaid runs: a
     subset is read here, laid out in layers here, and the SVG is built from numbers and escaped labels only, like a chart.
     `style`, `classDef`, `linkStyle`, `class` and `%%{init}%%` put colors in the source: ignored, and the linter says so.
     `click` binds code to a node: refused. The one mark read is the hero: `{.hero}`, or Mermaid's `:::hero`. Nothing the author writes reaches an attribute. */
  var DIAGRAM_KINDS = ['flowchart', 'graph'];
  // the other Mermaid families: the block of ours that already draws them
  var DIAGRAM_ROUTE = { pie: '`::: chart {.pie}`', 'xychart-beta': '`::: chart`', xychart: '`::: chart`', timeline: '`::: timeline`', journey: '`::: timeline`', gantt: '`::: timeline` or `::: table`', mindmap: '`::: cards`', quadrantchart: '`::: compare`' };
  var DIAGRAM_MAX = { slide: 10, story: 7, doc: 14, webpage: 14 };
  var DIAGRAM_MIN_TYPE = 14;
  var DIAGRAM_GROW = 1.3;
  var DIAGRAM_LAYOUT_MAX = 60; // past it the layout is not even tried — the linter has said `max-items` long before; the text is shown // the most a diagram is grown to fill its box // the smallest type a fitted diagram may be read at, in design px
  var DIAGRAM_SHAPES = [ // [opener, closer, shape] — the longest opener first
    ['(((', ')))', 'circle'], ['([', '])', 'stadium'], ['((', '))', 'circle'], ['[(', ')]', 'cylinder'], ['[[', ']]', 'subroutine'],
    ['{{', '}}', 'hexagon'], ['[/', '/]', 'rect'], ['[/', '\\]', 'rect'], ['[\\', '\\]', 'rect'], ['[\\', '/]', 'rect'],
    ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'diamond'], ['>', ']', 'rect']
  ];
  var DG_ID = /^[\wÀ-ɏ]+(?:-[\wÀ-ɏ]+)*/;
  var DG_EDGE_TEXT = /^(<)?(--|==|-\.)\s+(.+?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-)/;
  var DG_EDGE = /^(<)?(-{2,}|={2,}|-\.+-|~{3,})(>|x(?=\s)|o(?=\s))?/; // `~~~` links without a line: it places, it does not draw
  // a label as Mermaid writes it: `<br>` is a new line, quotes and markdown backticks are wrapping, any other tag is text
  function dgLabel(s) { return String(s).replace(/^"([^]*)"$/, '$1').replace(/^`([^]*)`$/, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').trim(); }
  // split a line on `;` outside quotes and brackets
  function dgStatements(l) {
    var out = [], cur = '', q = false, depth = 0;
    for (var i = 0; i < l.length; i++) {
      var ch = l[i];
      if (ch === '"') q = !q;
      else if (!q && '[({'.indexOf(ch) >= 0) depth++;
      else if (!q && '])}'.indexOf(ch) >= 0) depth = Math.max(0, depth - 1);
      if (ch === ';' && !q && !depth) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function diagram(b) {
    var d = { kind: '', dir: 'TD', nodes: [], edges: [], byId: {}, groups: [], toFrame: [], ignored: [], refused: [], bad: [] }, open = [];
    function node(id, line) {
      if (!d.byId[id]) { d.byId[id] = { id: id, label: id, shape: 'rect', hero: false, line: line, k: d.nodes.length, group: null }; d.nodes.push(d.byId[id]); }
      var n = d.byId[id];
      if (open.length && !n.placed) { n.group = open[open.length - 1]; n.placed = true; } // a box is in the frame it is first named in (Mermaid's: a frame may just list ids drawn elsewhere)
      return n;
    }
    // `subgraph id [Title]`, `subgraph "Title"`, `subgraph Title` … `end`: a frame around the boxes named inside, frames in frames
    function frame(rest, line) {
      var m = /^([^\s\[\]"]+)\s*\[([^]*)\]$/.exec(rest), id, title;
      if (m) { id = m[1]; title = dgLabel(m[2]); } else { title = dgLabel(rest); id = title || 'frame-' + d.groups.length; }
      var g = { id: id, title: title, parent: open.length ? open[open.length - 1] : null, line: line, k: d.groups.length };
      d.groups.push(g); open.push(g);
    }
    function chain(s, line) {
      var pos = 0;
      function ws() { while (pos < s.length && /\s/.test(s[pos])) pos++; }
      function nodeAt() {
        var m = DG_ID.exec(s.slice(pos));
        if (!m) return null;
        pos += m[0].length;
        var n = node(m[0], line);
        for (var i = 0; i < DIAGRAM_SHAPES.length && !/^\{\.[\w-]/.test(s.slice(pos)); i++) { // `A{.hero}` is a modifier, not a decision labelled `.hero`
          var sh = DIAGRAM_SHAPES[i];
          if (s.slice(pos, pos + sh[0].length) !== sh[0]) continue;
          var p = pos + sh[0].length, end;
          while (s[p] === ' ') p++;
          if (s[p] === '"') { var qe = s.indexOf('"', p + 1); if (qe < 0) continue; end = s.indexOf(sh[1], qe + 1); if (end < 0 || s.slice(qe + 1, end).trim()) continue; }
          else end = s.indexOf(sh[1], p);
          if (end < 0) continue;
          n.label = dgLabel(s.slice(pos + sh[0].length, end)) || n.id; n.shape = sh[2]; n.line = line; // the line the editor opens: where the label is written
          pos = end + sh[1].length;
          break;
        }
        var c = /^:::([\w-]+)/.exec(s.slice(pos));
        if (c) { pos += c[0].length; if (c[1].toLowerCase() === 'hero') n.hero = true; else d.ignored.push(':::' + c[1]); }
        // `{.hero}`, the format's own modifier: what survives a channel that eats `:::` (SafeBrain masks it, spec/hosts.md)
        var md = /^\s*\{(\s*\.[\w-]+)+\s*\}/.exec(s.slice(pos));
        if (md) { pos += md[0].length; mods(md[0]).classes.forEach(function (k) { if (k === 'hero') n.hero = true; else d.ignored.push('{.' + k + '}'); }); }
        return n;
      }
      function group() {
        var list = [];
        for (;;) {
          ws(); var n = nodeAt(); if (!n) return list.length ? list : null;
          list.push(n); ws();
          if (s[pos] === '&') { pos++; continue; }
          return list;
        }
      }
      function edgeAt() {
        var rest = s.slice(pos), m = DG_EDGE_TEXT.exec(rest), e;
        if (m) e = { back: !!m[1], kind: m[2] === '==' ? 'thick' : m[2] === '-.' ? 'dotted' : 'solid', arrow: />$/.test(m[4]), label: dgLabel(m[3]) };
        else if ((m = DG_EDGE.exec(rest))) e = { back: !!m[1], kind: m[2][0] === '=' ? 'thick' : m[2][0] === '~' ? 'hidden' : m[2].indexOf('.') >= 0 ? 'dotted' : 'solid', arrow: !!m[3], label: '' };
        else return null;
        pos += m[0].length; ws();
        if (s[pos] === '|') { var pe = s.indexOf('|', pos + 1); if (pe > 0) { e.label = dgLabel(s.slice(pos + 1, pe)); pos = pe + 1; } }
        return e;
      }
      var from = group();
      if (!from) return false;
      for (;;) {
        ws(); if (pos >= s.length) return true;
        var e = edgeAt(); if (!e) return false;
        var to = group(); if (!to) return false;
        from.forEach(function (a) { to.forEach(function (z) { d.edges.push({ from: a, to: z, kind: e.kind, arrow: e.arrow, back: e.back, label: e.label, line: line }); }); });
        from = to;
      }
    }
    var head = true;
    b.lines.forEach(function (raw, k) {
      var line = b.map[0] + 1 + k, l = raw.trim();
      if (/^%%\{/.test(l)) { d.ignored.push('%%{init}%%'); return; }
      l = l.replace(/%%.*$/, '').trim();
      if (!l) return;
      if (head) {
        head = false;
        var m = /^([A-Za-z-]+)(?:\s+(TD|TB|BT|LR|RL))?\s*;?$/i.exec(l);
        d.kind = (m ? m[1] : l.split(/\s+/)[0]).toLowerCase();
        if (m && m[2]) d.dir = m[2].toUpperCase() === 'TB' ? 'TD' : m[2].toUpperCase();
        return;
      }
      if (DIAGRAM_KINDS.indexOf(d.kind) < 0) return;
      dgStatements(l).forEach(function (s) {
        var w = s.split(/\s+/)[0].toLowerCase();
        if (w === 'subgraph') { frame(s.slice(8).trim(), line); return; }
        if (w === 'end' && s.trim().toLowerCase() === 'end') { if (open.length) open.pop(); else d.bad.push({ text: s, line: line }); return; }
        if (w === 'direction') { d.ignored.push(w); return; }
        if (w === 'style' || w === 'classdef' || w === 'linkstyle' || w === 'class') { d.ignored.push(w); return; }
        if (w === 'click' || w === 'call' || w === 'href') { d.refused.push({ text: s, line: line }); return; }
        if (!chain(s, line)) d.bad.push({ text: s, line: line });
      });
    });
    if (d.groups.length) {
      // an arrow to a frame's id named a box that is not one: it is not drawn, and the linter says so
      var gid = {}; d.groups.forEach(function (g) { gid[g.id] = g; });
      var isFrame = function (n) { return n.label === n.id && n.shape === 'rect' ? gid[n.id] : null; }; // a bare id that is a frame's: the frame, not a box
      d.edges = d.edges.filter(function (e) { var f = isFrame(e.from) || isFrame(e.to); if (f) d.toFrame.push({ frame: f, line: e.line }); return !f; });
      d.nodes = d.nodes.filter(function (n) { return !isFrame(n); });
      d.nodes.forEach(function (n, k) { n.k = k; });
      var used = {}; d.nodes.forEach(function (n) { for (var g = n.group; g; g = g.parent) used[g.k] = 1; });
      d.groups = d.groups.filter(function (g) { return used[g.k]; }); // a frame with no box draws nothing
      d.groups.forEach(function (g, k) { g.k = k; g.depth = 0; for (var p = g.parent; p; p = p.parent) g.depth++; });
    }
    return d;
  }

  // the drawing box per layout, in design units, and the type the diagram is laid out at
  function diagramBox(ctx, right) {
    var lay = ctx && ctx.layout;
    if (lay === 'story') return { w: 560, h: 860, fs: 24 };
    if (lay === 'doc') return { w: 1060, h: right ? 520 : 760, fs: 18 };
    if (right) return { w: 544, h: 460, fs: 18 };
    return { w: 1100, h: lay === 'webpage' ? 560 : 430, fs: 20 };
  }
  function dgWrap(text, max) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      var cur = '';
      para.split(/\s+/).filter(Boolean).forEach(function (w) {
        if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
      });
      out.push(cur);
    });
    return out;
  }
  // least squares with a minimum gap between neighbours, order kept: pool adjacent violators on the shifted positions
  function dgPlace(want, gap) {
    var off = [0], n = want.length, i;
    for (i = 1; i < n; i++) off[i] = off[i - 1] + gap[i - 1];
    var blocks = [];
    for (i = 0; i < n; i++) {
      blocks.push({ sum: want[i] - off[i], n: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
        var top = blocks.pop(); blocks[blocks.length - 1].sum += top.sum; blocks[blocks.length - 1].n += top.n;
      }
    }
    var out = [], k = 0;
    blocks.forEach(function (bl) { for (var j = 0; j < bl.n; j++, k++) out.push(bl.sum / bl.n + off[k]); });
    return out;
  }
  // the frames a box sits in, outermost first; how many two such lists share
  function dgPath(g) { var p = []; for (; g; g = g.parent) p.unshift(g); return p; }
  function dgCommon(a, b) { var c = 0; while (c < a.length && c < b.length && a[c] === b[c]) c++; return c; }
  /* A layered layout (Sugiyama, small): cycles broken by a depth-first walk, ranks by longest path, a dummy node every rank a
     long edge crosses, the order of each rank by barycenters (the sweep with the fewest crossings kept), positions across the
     ranks by least squares toward the neighbours, gaps sized by the labels that sit in them. Laid out top-down, turned after. */
  function diagramLayout(d, fs, dir) {
    var horiz = dir === 'LR' || dir === 'RL', CW = fs * 0.58, LH = fs * 1.22, GR = d.groups || []; // a tree has no frames
    var maxCh = horiz ? 16 : 18;
    var V = d.nodes.map(function (n) {
      var lines = dgWrap(n.label, maxCh), sub = n.sub ? dgWrap(n.sub, Math.round(maxCh * 1.2)) : [];
      var tw = Math.max(Math.max.apply(null, lines.map(function (l) { return l.length; })) * CW, sub.length ? Math.max.apply(null, sub.map(function (l) { return l.length; })) * CW * 0.8 : 0);
      var th = lines.length * LH + (sub.length ? fs * 0.3 + sub.length * LH * 0.8 : 0);
      var w = tw + fs * 2.2, h = th + fs * 1.5;
      if (n.shape === 'stadium') w += fs;
      if (n.shape === 'subroutine') w += fs;
      if (n.shape === 'hexagon') w += h * 0.5;
      if (n.shape === 'cylinder') h += fs * 0.7;
      if (n.shape === 'diamond') { w = tw / 0.62 + fs * 1.4; h = th / 0.38 + fs * 0.8; }
      if (n.shape === 'circle') { w = h = Math.max(tw, th) + fs * 2; }
      w = Math.max(w, fs * 5);
      return { n: n, lines: lines, sub: sub, w: w, h: h, out: [], inn: [], dummy: false, path: dgPath(n.group) };
    });
    var E = [];
    d.edges.forEach(function (e) { if (e.from !== e.to) E.push({ e: e, u: V[e.from.k], v: V[e.to.k], rev: false }); });
    // cycles: an edge back to a node still on the walk's stack is laid out reversed
    var state = V.map(function () { return 0; });
    function dfs(i) { state[i] = 1; E.forEach(function (x) { if (x.u === V[i] && !x.rev) { var j = V.indexOf(x.v); if (state[j] === 1) x.rev = true; else if (!state[j]) dfs(j); } }); state[i] = 2; }
    V.forEach(function (_, i) { if (!state[i]) dfs(i); });
    E.forEach(function (x) { if (x.rev) { var t = x.u; x.u = x.v; x.v = t; } x.u.out.push(x); x.v.inn.push(x); });
    // ranks: longest path from the sources, then a sink pulled down to its first successor's rank minus one
    var rank = V.map(function () { return -1; });
    function rk(i) { if (rank[i] >= 0) return rank[i]; rank[i] = 0; var r = 0; V[i].inn.forEach(function (x) { r = Math.max(r, rk(V.indexOf(x.u)) + 1); }); return (rank[i] = r); }
    V.forEach(function (_, i) { rk(i); });
    V.forEach(function (v, i) { if (!v.inn.length && v.out.length) rank[i] = Math.min.apply(null, v.out.map(function (x) { return rank[V.indexOf(x.v)]; })) - 1; });
    V.forEach(function (v, i) { v.r = rank[i]; });
    var R = Math.max.apply(null, V.map(function (v) { return v.r; }).concat([0])) + 1;
    // long edges: one dummy per rank crossed; an edge's points are its chain
    var all = V.slice();
    E.forEach(function (x) {
      x.chain = [x.u];
      for (var r = x.u.r + 1; r < x.v.r; r++) { var dm = { dummy: true, w: fs * 0.6, h: fs, r: r, out: [], inn: [], path: x.u.path.slice(0, dgCommon(x.u.path, x.v.path)) }; all.push(dm); x.chain.push(dm); }
      x.chain.push(x.v);
      for (var k = 0; k + 1 < x.chain.length; k++) { x.chain[k].out.push({ v: x.chain[k + 1] }); x.chain[k + 1].inn.push({ u: x.chain[k] }); }
    });
    // the chain links, not the edges, drive the ordering: keep only them
    all.forEach(function (a) { a.up = a.inn.filter(function (l) { return !l.e; }).map(function (l) { return l.u; }); a.down = a.out.filter(function (l) { return !l.e; }).map(function (l) { return l.v; }); });
    var layers = []; for (var r0 = 0; r0 < R; r0++) layers.push([]);
    all.forEach(function (a) { layers[a.r].push(a); });
    function index() { layers.forEach(function (L) { L.forEach(function (a, i) { a.o = i; }); }); }
    function crossings() {
      var c = 0;
      for (var r = 0; r + 1 < R; r++) {
        var segs = []; layers[r].forEach(function (a) { a.down.forEach(function (z) { segs.push([a.o, z.o]); }); });
        for (var i = 0; i < segs.length; i++) for (var j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) c++;
      }
      return c;
    }
    index();
    var best = layers.map(function (L) { return L.slice(); }), bestC = crossings();
    for (var it = 0; it < 12 && bestC; it++) {
      var down = it % 2 === 0;
      for (var q = down ? 1 : R - 2; down ? q < R : q >= 0; q += down ? 1 : -1) {
        layers[q].forEach(function (a) { var nb = down ? a.up : a.down; a.bc = nb.length ? nb.reduce(function (s, z) { return s + z.o; }, 0) / nb.length : a.o; });
        layers[q].sort(function (a, z) { return a.bc - z.bc || a.o - z.o; });
        layers[q].forEach(function (a, i) { a.o = i; });
      }
      var c = crossings();
      if (c < bestC) { bestC = c; best = layers.map(function (L) { return L.slice(); }); }
    }
    layers = best; index();
    // frames: the boxes of one frame side by side in every rank, and the frames in the same order from rank to rank
    if (GR.length) {
      var gk = GR.map(function (g) { var t = 0, c = 0; all.forEach(function (a) { if (a.path.indexOf(g) >= 0) { t += a.o; c++; } }); return c ? t / c : 0; });
      var arrange = function (items, depth) {
        var blocks = [], by = {};
        items.forEach(function (a) {
          var g = a.path[depth];
          if (!g) { blocks.push({ key: a.o, items: [a] }); return; }
          if (!by[g.k]) blocks.push(by[g.k] = { g: g, items: [] });
          by[g.k].items.push(a);
        });
        blocks.forEach(function (b) { if (b.g) { b.key = b.items.reduce(function (t, a) { return t + a.o; }, 0) / b.items.length; b.items = arrange(b.items, depth + 1); } });
        blocks.sort(function (p, q) { return p.key - q.key; });
        var slots = [], gs = []; blocks.forEach(function (b, i) { if (b.g) { slots.push(i); gs.push(b); } });
        gs.sort(function (p, q) { return gk[p.g.k] - gk[q.g.k]; }); slots.forEach(function (i, j) { blocks[i] = gs[j]; });
        return [].concat.apply([], blocks.map(function (b) { return b.items; }));
      };
      layers = layers.map(function (L) { return arrange(L, 0); }); index();
    }
    // across: each node's size along the rank and across it, depending on the direction
    function across(a) { return horiz ? a.h : a.w; }
    function along(a) { return horiz ? a.w : a.h; }
    var sep = fs * 1.4, FP = fs * 0.55, FT = fs * 1.2; // a frame's padding, and the band its title sits in (above it, whatever the direction)
    function border(a, b) { var c = dgCommon(a.path, b.path), ends = a.path.length - c, starts = b.path.length - c; return (ends + starts) * FP + (horiz ? starts * FT : 0); }
    var label = function (t) { var ls = dgWrap(t, 16); return { lines: ls, w: Math.max.apply(null, ls.map(function (l) { return l.length; })) * fs * 0.52 + fs * 0.9, h: ls.length * fs * 1.12 + fs * 0.45 }; };
    E.forEach(function (x) { if (x.e.label) x.lab = label(x.e.label); });
    // in a frame, a box holds the room of the labels that leave it side by side: they stay inside the frame, under its title
    if (GR.length) V.forEach(function (a) { var ls = E.filter(function (x) { return x.lab && x.u === a; }).map(function (x) { return horiz ? x.lab.h : x.lab.w; }); if (ls.length) a.room = ls.reduce(function (t, w) { return t + w; }, 0) + (ls.length - 1) * fs * 0.5; });
    function slot(a) { return Math.max(across(a), a.room || 0); }
    layers.forEach(function (L) { var x = 0; L.forEach(function (a, i) { a.x = x + slot(a) / 2; x += slot(a) + sep + (L[i + 1] ? border(a, L[i + 1]) : 0); }); });
    function relax(L, nbOf) {
      if (!L.length) return;
      var want = L.map(function (a) { var nb = nbOf(a); return nb.length ? nb.reduce(function (s, z) { return s + z.x; }, 0) / nb.length : a.x; });
      var gap = []; for (var i = 0; i + 1 < L.length; i++) gap.push((slot(L[i]) + slot(L[i + 1])) / 2 + (L[i].dummy && L[i + 1].dummy ? fs * 0.6 : sep) + border(L[i], L[i + 1]));
      var x = dgPlace(want, gap); L.forEach(function (a, i) { a.x = x[i]; });
    }
    for (var pass = 0; pass < 8; pass++) {
      for (var r1 = 1; r1 < R; r1++) relax(layers[r1], function (a) { return a.up; });
      for (var r2 = R - 2; r2 >= 0; r2--) relax(layers[r2], function (a) { return a.down; });
    }
    // a frame is a rectangle over every rank it spans: a box of a rank that is not in it is pushed out of its width, to the side it is on
    if (GR.length) for (var cp = 0; cp < 3; cp++) {
      var ext = GR.map(function (g) {
        var e = { x0: Infinity, x1: -Infinity, r0: Infinity, r1: -Infinity };
        all.forEach(function (a) { var i = a.path.indexOf(g); if (i < 0) return; var lev = a.path.length - i; e.x0 = Math.min(e.x0, a.x - slot(a) / 2 - lev * (FP + (horiz ? FT : 0))); e.x1 = Math.max(e.x1, a.x + slot(a) / 2 + lev * FP); e.r0 = Math.min(e.r0, a.r); e.r1 = Math.max(e.r1, a.r); });
        return e;
      });
      layers.forEach(function (L, r) {
        GR.forEach(function (g, k) {
          var e = ext[k]; if (r < e.r0 || r > e.r1) return;
          var inside = L.map(function (a) { return a.path.indexOf(g) >= 0; }), first = inside.indexOf(true), last = inside.lastIndexOf(true), c = (e.x0 + e.x1) / 2;
          L.forEach(function (a, i) {
            if (inside[i]) return;
            var right = first >= 0 ? i > last : a.x > c;
            if (right) a.x = Math.max(a.x, e.x1 + sep + slot(a) / 2); else a.x = Math.min(a.x, e.x0 - sep - slot(a) / 2);
          });
        });
        for (var i = 1; i < L.length; i++) L[i].x = Math.max(L[i].x, L[i - 1].x + (slot(L[i - 1]) + slot(L[i])) / 2 + sep + border(L[i - 1], L[i])); // the order kept, the gaps kept
      });
    }
    // along: each rank as thick as its biggest node; each gap as wide as the labels that sit in it need
    var gaps = []; for (var g = 0; g + 1 < R; g++) gaps.push(fs * 2.4);
    E.forEach(function (x) {
      if (!x.lab) return;
      var gi = x.u.r; if (gi < gaps.length) gaps[gi] = Math.max(gaps[gi], (horiz ? x.lab.w + fs * 3 : x.lab.h + fs * 1.6));
    });
    // a frame's title: on one line across a left-to-right flow (the frame runs along it), wrapped to the frame's width down a
    // top-down one — never widening the frame over a box beside it; its band as tall as its lines
    var TF = fs * 0.72;
    GR.forEach(function (g) {
      g.tl = [g.title]; g.ft = FT;
      if (horiz || !g.title) return;
      var x0 = Infinity, x1 = -Infinity; V.forEach(function (a) { if (a.path.indexOf(g) >= 0) { x0 = Math.min(x0, a.x - slot(a) / 2); x1 = Math.max(x1, a.x + slot(a) / 2); } });
      g.tl = dgWrap(g.title, Math.max(8, Math.floor((x1 - x0 + FP * 0.4) / (TF * 0.56)))); g.ft = FT + (g.tl.length - 1) * TF * 1.2;
    });
    if (GR.length) {
      var span = GR.map(function () { return [Infinity, -Infinity]; });
      all.forEach(function (a) { a.path.forEach(function (g) { span[g.k][0] = Math.min(span[g.k][0], a.r); span[g.k][1] = Math.max(span[g.k][1], a.r); }); });
      var need = function (a, r, side, titled) { return a.path.filter(function (g) { return span[g.k][side] === r; }).reduce(function (t, g) { return t + FP + (titled ? g.ft : 0); }, 0); };
      for (var gb = 0; gb + 1 < R; gb++) {
        gaps[gb] += Math.max.apply(null, layers[gb].map(function (a) { return need(a, gb, 1, dir === 'BT'); }).concat([0])) + Math.max.apply(null, layers[gb + 1].map(function (a) { return need(a, gb + 1, 0, dir === 'TD'); }).concat([0]));
      }
    }
    var thick = layers.map(function (L) { return Math.max.apply(null, L.map(along).concat([fs])); });
    var mid = [], y = 0; layers.forEach(function (L, r) { L.forEach(function (a) { a.y = y + thick[r] / 2; }); mid.push(y + thick[r] + (gaps[r] || 0) / 2); y += thick[r] + (gaps[r] || 0); });
    // edges: ports spread on a node's side, a curve through the dummies, the arrow on the last stretch
    var AL = fs * 0.62;
    function ports(a, list, key) {
      list.sort(function (p, z) { return p[key].x - z[key].x; });
      var room = (d.ortho || (a.n && (a.n.shape === 'diamond' || a.n.shape === 'circle'))) ? 0 : Math.min(across(a) * 0.5, list.length * fs * 1.2);
      list.forEach(function (x, i) { x[key === 'next' ? 'p0' : 'p1'] = list.length > 1 ? (i / (list.length - 1) - 0.5) * room : 0; });
    }
    V.forEach(function (a) {
      var outs = E.filter(function (x) { return x.u === a; }).map(function (x) { x.next = x.chain[1]; return x; });
      var ins = E.filter(function (x) { return x.v === a; }).map(function (x) { x.prev = x.chain[x.chain.length - 2]; return x; });
      ports(a, outs, 'next'); ports(a, ins, 'prev');
    });
    E.forEach(function (x) {
      var pts = [{ x: x.u.x + x.p0, y: x.u.y + along(x.u) / 2 }];
      for (var k = 1; k + 1 < x.chain.length; k++) pts.push({ x: x.chain[k].x, y: x.chain[k].y });
      pts.push({ x: x.v.x + x.p1, y: x.v.y - along(x.v) / 2 });
      if (x.v.n.shape === 'diamond' || x.v.n.shape === 'circle') pts[pts.length - 1].y += 0;
      x.pts = pts;
      if (x.lab) x.labAt = { x: (pts[0].x + pts[1].x) / 2, y: mid[x.u.r] };
    });
    // the labels of one gap side by side, never on each other (two edges between the same boxes, a fan out of one box):
    // pushed apart along the gap like the boxes of a rank, and each edge bent through its own label
    for (var gl = 0; gl + 1 < R; gl++) {
      var LB = E.filter(function (x) { return x.lab && x.u.r === gl; }).sort(function (p, z) { return p.labAt.x - z.labAt.x; });
      if (!LB.length) continue;
      var lgap = []; for (var li = 0; li + 1 < LB.length; li++) lgap.push(((horiz ? LB[li].lab.h + LB[li + 1].lab.h : LB[li].lab.w + LB[li + 1].lab.w)) / 2 + fs * 0.5);
      var lx = dgPlace(LB.map(function (x) { return x.labAt.x; }), lgap);
      LB.forEach(function (x, i) { x.labAt.x = lx[i]; x.pts.splice(1, 0, { x: x.labAt.x, y: x.labAt.y }); });
    }
    // frames: around their boxes and the frames inside them, the innermost first; the title's band on the side that ends up on top
    var F = GR.slice().sort(function (p, q) { return q.depth - p.depth; }).map(function (g) {
      var r = { g: g, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }, take = function (cx, cy, w, h) { r.x0 = Math.min(r.x0, cx - w / 2); r.x1 = Math.max(r.x1, cx + w / 2); r.y0 = Math.min(r.y0, cy - h / 2); r.y1 = Math.max(r.y1, cy + h / 2); };
      V.forEach(function (a) { if (a.path.indexOf(g) >= 0) take(a.x, a.y, across(a), along(a)); });
      E.forEach(function (x) { if (x.lab && x.u.path.indexOf(g) >= 0 && x.v.path.indexOf(g) >= 0) take(x.labAt.x, x.labAt.y, horiz ? x.lab.h : x.lab.w, horiz ? x.lab.w : x.lab.h); }); // and the labels of the arrows inside it
      return r;
    });
    F.forEach(function (r) {
      F.forEach(function (c) { if (c.g.parent === r.g) { r.x0 = Math.min(r.x0, c.x0); r.x1 = Math.max(r.x1, c.x1); r.y0 = Math.min(r.y0, c.y0); r.y1 = Math.max(r.y1, c.y1); } });
      r.x0 -= FP; r.x1 += FP; r.y0 -= FP; r.y1 += FP;
      if (dir === 'TD') r.y0 -= r.g.ft; else if (dir === 'BT') r.y1 += r.g.ft; else r.x0 -= FT;
      var tw = Math.max.apply(null, r.g.tl.map(function (l) { return l.length; })) * TF * 0.56 + FP * 1.6, have = horiz ? r.y1 - r.y0 : r.x1 - r.x0; // the title on one line: a frame is at least as wide as it
      if (tw > have) { if (horiz) { r.y0 -= (tw - have) / 2; r.y1 += (tw - have) / 2; } else { r.x0 -= (tw - have) / 2; r.x1 += (tw - have) / 2; } }
    });
    // extent, then the turn: top-down is the frame everything above was computed in
    var minX = Infinity, maxX = -Infinity, minY = 0, maxY = y - (gaps[R - 1] || 0);
    all.forEach(function (a) { minX = Math.min(minX, a.x - across(a) / 2); maxX = Math.max(maxX, a.x + across(a) / 2); });
    E.forEach(function (x) { if (x.lab) { minX = Math.min(minX, x.labAt.x - (horiz ? x.lab.h : x.lab.w) / 2); maxX = Math.max(maxX, x.labAt.x + (horiz ? x.lab.h : x.lab.w) / 2); } });
    F.forEach(function (r) { minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1); minY = Math.min(minY, r.y0); maxY = Math.max(maxY, r.y1); });
    var pad = fs * 0.3, W = maxX - minX, H = maxY - minY;
    function turn(p) {
      var a = p.x - minX + pad, b = p.y - minY + pad;
      if (dir === 'BT') b = H + 2 * pad - b;
      if (dir === 'LR') return { x: b, y: a };
      if (dir === 'RL') return { x: H + 2 * pad - b, y: a };
      return { x: a, y: b };
    }
    var out = { w: (horiz ? H : W) + 2 * pad, h: (horiz ? W : H) + 2 * pad, fs: fs, dir: dir, AL: AL, nodes: [], edges: [], frames: [], clash: [] };
    F.slice().reverse().forEach(function (r) { // outermost first: drawn under the frames they hold
      var p = turn({ x: r.x0, y: r.y0 }), q = turn({ x: r.x1, y: r.y1 });
      out.frames.push({ g: r.g, x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y), FP: FP, FT: FT, TF: TF });
    });
    // what a frame covers that is not in it: a box ranked between two of its own, or a sibling frame — the linter says it
    var hit = function (a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; };
    F.forEach(function (r) {
      V.forEach(function (a) { if (a.path.indexOf(r.g) < 0 && hit(r, { x0: a.x - across(a) / 2, x1: a.x + across(a) / 2, y0: a.y - along(a) / 2, y1: a.y + along(a) / 2 })) out.clash.push({ frame: r.g, box: a.n }); });
      F.forEach(function (o) { if (o.g.k > r.g.k && dgPath(o.g).indexOf(r.g) < 0 && dgPath(r.g).indexOf(o.g) < 0 && hit(r, o)) out.clash.push({ frame: r.g, other: o.g }); });
    });
    V.forEach(function (a) { var c = turn(a); out.nodes.push({ n: a.n, lines: a.lines, sub: a.sub, x: c.x, y: c.y, w: a.w, h: a.h, r: a.r }); });
    E.forEach(function (x) {
      var pts = x.pts.map(turn);
      if (x.rev) pts.reverse();
      out.edges.push({ e: x.e, pts: pts, r: Math.min(x.u.r, x.v.r), lab: x.lab, labAt: x.labAt && turn(x.labAt) });
    });
    d.edges.forEach(function (e) { if (e.from === e.to) { var a = out.nodes[e.from.k]; out.edges.push({ e: e, self: true, x: a.x + a.w / 2, y: a.y, r: a.r }); } });
    return out;
  }
  function diagramSvg(d, box, dir) {
    var L = diagramLayout(d, box.fs, dir), fs = L.fs, horiz = dir === 'LR' || dir === 'RL';
    var s = Math.min(DIAGRAM_GROW, box.w / L.w, box.h / L.h), out = [], bk = L.nodes.map(function () { return []; }); // one step per node: it arrives with the edges that reach it (an explain slide shows them click by click) // shrunk to its box, grown a little into it: a small flow should not sit lost in a slide
    var f = function (p) { return f1(p.x) + ',' + f1(p.y); };
    var axis = { TD: [0, 1], BT: [0, -1], LR: [1, 0], RL: [-1, 0] }[dir];
    L.edges.forEach(function (x, k) {
      if (x.e.kind === 'hidden') return;
      var e = x.e, o = bk[e.to.k], cls = 'dg-edge dg-' + e.kind, kk = ' style="--k:' + (x.r + 0.55) + '"';
      if (x.self) {
        o.push('<path class="' + cls + '"' + kk + ' pathLength="1" d="M' + f1(x.x) + ',' + f1(x.y - fs * 0.5) + 'c' + f1(fs * 1.6) + ',' + f1(-fs * 1.2) + ' ' + f1(fs * 1.6) + ',' + f1(fs * 2.2) + ' 0,' + f1(fs) + '"/>');
        return;
      }
      var p = x.pts.slice(), last = p[p.length - 1], first = p[0];
      var endDir = p.length > 1 ? [Math.sign(last.x - p[p.length - 2].x) * Math.abs(axis[0]), Math.sign(last.y - p[p.length - 2].y) * Math.abs(axis[1])] : axis;
      var startDir = [-Math.sign(p[1].x - first.x) * Math.abs(axis[0]), -Math.sign(p[1].y - first.y) * Math.abs(axis[1])];
      var heads = [];
      function head(at, v) { // the arrow tip on the node's border, the line stopping at its base
        var bx = at.x - v[0] * L.AL, by = at.y - v[1] * L.AL, wx = -v[1] * L.AL * 0.5, wy = v[0] * L.AL * 0.5;
        heads.push('<polygon class="dg-head dg-' + e.kind + '" style="--k:' + (x.r + 1) + '" points="' + f(at) + ' ' + f1(bx + wx) + ',' + f1(by + wy) + ' ' + f1(bx - wx) + ',' + f1(by - wy) + '"/>');
        return { x: bx, y: by };
      }
      if (e.arrow) p[p.length - 1] = head(last, endDir);
      if (e.arrow && e.back) p[0] = head(first, startDir);
      var dpath = 'M' + f(p[0]);
      for (var i = 1; i < p.length; i++) {
        var a = p[i - 1], z = p[i];
        if (d.ortho) { var mid = horiz ? (a.x + z.x) / 2 : (a.y + z.y) / 2; dpath += horiz ? 'H' + f1(mid) + 'V' + f1(z.y) + 'H' + f1(z.x) : 'V' + f1(mid) + 'H' + f1(z.x) + 'V' + f1(z.y); continue; } // an org chart's elbows
        dpath += horiz ? 'C' + f1((a.x + z.x) / 2) + ',' + f1(a.y) + ' ' + f1((a.x + z.x) / 2) + ',' + f1(z.y) + ' ' + f(z)
          : 'C' + f1(a.x) + ',' + f1((a.y + z.y) / 2) + ' ' + f1(z.x) + ',' + f1((a.y + z.y) / 2) + ' ' + f(z);
      }
      o.push('<path class="' + cls + '"' + kk + (e.kind === 'dotted' ? '' : ' pathLength="1"') + ' d="' + dpath + '"/>'); // a dash pattern counts in pathLength units: only a line that draws itself gets one
      o.push.apply(o, heads);
    });
    L.edges.forEach(function (x) {
      if (!x.lab) return;
      var lw = x.lab.w, lh = x.lab.h, c = x.labAt, lf = fs * 0.82;
      bk[x.e.to.k].push('<g class="dg-label" style="--k:' + (x.r + 1) + '"><rect x="' + f1(c.x - lw / 2) + '" y="' + f1(c.y - lh / 2) + '" width="' + f1(lw) + '" height="' + f1(lh) + '" rx="' + f1(lh / 2) + '"/>' +
        dgText(x.lab.lines, c, lf, lf * 1.12) + '</g>');
    });
    L.nodes.forEach(function (a) {
      var n = a.n, x0 = a.x - a.w / 2, y0 = a.y - a.h / 2, sh;
      if (n.shape === 'diamond') sh = '<polygon points="' + f1(a.x) + ',' + f1(y0) + ' ' + f1(x0 + a.w) + ',' + f1(a.y) + ' ' + f1(a.x) + ',' + f1(y0 + a.h) + ' ' + f1(x0) + ',' + f1(a.y) + '"/>';
      else if (n.shape === 'circle') sh = '<circle cx="' + f1(a.x) + '" cy="' + f1(a.y) + '" r="' + f1(a.w / 2) + '"/>';
      else if (n.shape === 'hexagon') { var ix = a.h * 0.28; sh = '<polygon points="' + f1(x0 + ix) + ',' + f1(y0) + ' ' + f1(x0 + a.w - ix) + ',' + f1(y0) + ' ' + f1(x0 + a.w) + ',' + f1(a.y) + ' ' + f1(x0 + a.w - ix) + ',' + f1(y0 + a.h) + ' ' + f1(x0 + ix) + ',' + f1(y0 + a.h) + ' ' + f1(x0) + ',' + f1(a.y) + '"/>'; }
      else if (n.shape === 'cylinder') { var ry = fs * 0.35, rx = a.w / 2; sh = '<path d="M' + f1(x0) + ',' + f1(y0 + ry) + 'a' + f1(rx) + ',' + f1(ry) + ' 0 0,0 ' + f1(a.w) + ',0a' + f1(rx) + ',' + f1(ry) + ' 0 0,0 ' + f1(-a.w) + ',0v' + f1(a.h - 2 * ry) + 'a' + f1(rx) + ',' + f1(ry) + ' 0 0,0 ' + f1(a.w) + ',0v' + f1(-(a.h - 2 * ry)) + '"/>'; }
      else {
        var rr = n.shape === 'stadium' ? a.h / 2 : n.shape === 'round' ? Math.min(a.h / 2, fs * 0.9) : fs * 0.4;
        sh = '<rect x="' + f1(x0) + '" y="' + f1(y0) + '" width="' + f1(a.w) + '" height="' + f1(a.h) + '" rx="' + f1(rr) + '"/>';
        if (n.shape === 'subroutine') sh += '<path class="dg-inner" d="M' + f1(x0 + fs * 0.5) + ',' + f1(y0) + 'v' + f1(a.h) + 'M' + f1(x0 + a.w - fs * 0.5) + ',' + f1(y0) + 'v' + f1(a.h) + '"/>';
      }
      var ty = n.shape === 'cylinder' ? a.y + fs * 0.2 : a.y;
      bk[n.k].push('<g class="dg-node dg-' + n.shape + (n.root ? ' dg-root' : '') + (n.hero ? ' is-hero' : '') + '" style="--k:' + a.r + '"' + (n.line != null ? ' data-node-line="' + (+n.line) + '"' : '') + '>' + sh + dgNodeText(a, ty, fs) + '</g>');
    });
    L.frames.forEach(function (r) { // under everything, there from the start: a frame is the scene the steps happen in
      out.push('<g class="dg-frame"><rect x="' + f1(r.x) + '" y="' + f1(r.y) + '" width="' + f1(r.w) + '" height="' + f1(r.h) + '" rx="' + f1(fs * 0.7) + '"/></g>');
    });
    var titles = L.frames.filter(function (r) { return r.g.title; }).map(function (r) { // over the arrows: one that enters the frame from above passes under its title
      var tw = Math.max.apply(null, r.g.tl.map(function (l) { return l.length; })) * r.TF * 0.52 + r.TF * 0.7, th = r.g.tl.length * r.TF * 1.2, x0 = r.x + r.FP - r.TF * 0.5, y0 = r.y + r.FT * 0.55 - r.TF * 0.6;
      return '<g class="dg-frame-title"><rect x="' + f1(x0) + '" y="' + f1(y0) + '" width="' + f1(tw) + '" height="' + f1(th) + '" rx="' + f1(th / 2 > r.TF ? r.TF * 0.5 : th / 2) + '"/><text dominant-baseline="central" font-size="' + f1(r.TF) + '">' +
        r.g.tl.map(function (l, i) { return '<tspan x="' + f1(r.x + r.FP) + '" y="' + f1(r.y + r.FT * 0.55 + i * r.TF * 1.2) + '">' + esc(l) + '</tspan>'; }).join('') + '</text></g>';
    });
    L.nodes.map(function (a, k) { return { a: a, k: k }; }).sort(function (p, q) { return p.a.r - q.a.r || (horiz ? p.a.y - q.a.y : p.a.x - q.a.x); })
      .forEach(function (z) { out.push('<g class="dg-step">' + bk[z.k].join('') + '</g>'); });
    out.push.apply(out, titles);
    return { svg: '<svg class="diagram-svg" viewBox="0 0 ' + f1(L.w) + ' ' + f1(L.h) + '" width="' + f1(L.w * s) + '" height="' + f1(L.h * s) + '" data-fs="' + f1(fs) + '" data-s="' + s.toFixed(3) + '" role="img" aria-hidden="true">' + out.join('') + '</svg>', scale: s, fs: fs, w: L.w * s, h: L.h * s, clash: L.clash }; // data-fs, data-s: what fitOverflow needs to resize it to the room the slide has
  }
  // a node's words: its label, and under it, smaller, the role a tree gives it (`- name | role`)
  function dgNodeText(a, y, fs) {
    var LH = fs * 1.22, SF = fs * 0.8, SL = SF * 1.22, th = a.lines.length * LH + (a.sub.length ? fs * 0.3 + a.sub.length * SL : 0), y0 = y - th / 2 + LH / 2, out = [];
    a.lines.forEach(function (l, i) { out.push('<tspan x="' + f1(a.x) + '" y="' + f1(y0 + i * LH) + '">' + esc(l) + '</tspan>'); });
    var y1 = y0 + (a.lines.length - 1) * LH + LH / 2 + fs * 0.3 + SL / 2;
    a.sub.forEach(function (l, i) { out.push('<tspan class="dg-sub" x="' + f1(a.x) + '" y="' + f1(y1 + i * SL) + '" font-size="' + f1(SF) + '">' + esc(l) + '</tspan>'); });
    return '<text text-anchor="middle" dominant-baseline="central" font-size="' + f1(fs) + '">' + out.join('') + '</text>';
  }
  function dgText(lines, c, size, lh) {
    var y0 = c.y - (lines.length - 1) * lh / 2;
    return '<text x="' + f1(c.x) + '" y="' + f1(y0) + '" text-anchor="middle" dominant-baseline="central" font-size="' + f1(size) + '">' +
      lines.map(function (l, i) { return '<tspan x="' + f1(c.x) + '"' + (i ? ' dy="' + f1(lh) + '"' : '') + '>' + esc(l) + '</tspan>'; }).join('') + '</text>';
  }
  // what the drawing says, as text: a screen reader, a copy
  function diagramText(d) {
    var linked = {};
    var rows = d.edges.filter(function (e) { return e.kind !== 'hidden'; }).map(function (e) { linked[e.from.id] = linked[e.to.id] = 1; return '<li>' + esc(e.from.label) + (e.back ? ' ↔ ' : e.arrow ? ' → ' : ' — ') + esc(e.to.label) + (e.label ? ' (' + esc(e.label) + ')' : '') + '</li>'; });
    d.nodes.forEach(function (n) { if (!linked[n.id]) rows.push('<li>' + esc(n.label) + '</li>'); });
    (d.groups || []).forEach(function (g) { rows.push('<li>' + esc(g.title || g.id) + ' : ' + d.nodes.filter(function (n) { return dgPath(n.group).indexOf(g) >= 0; }).map(function (n) { return esc(n.label); }).join(', ') + '</li>'); });
    return '<ul class="chart-data">' + rows.join('') + '</ul>';
  }
  function diagramDir(d, ctx) { return ctx && ctx.layout === 'story' ? (d.dir === 'BT' ? 'BT' : 'TD') : d.dir; } // a Story screen is tall: it reads down

  /* The other grammar of `diagram`: a list given a form, the way a SmartArt is — `- title | text` items and the form as a
     modifier, `{.cycle}` `{.pyramid}` `{.matrix}`. The words are HTML (inline Markdown, edited in place like a card's, native
     text in a PowerPoint), the drawing around them is SVG from numbers only. */
  var DIAGRAM_FORMS = { cycle: [3, 6], radial: [3, 8], pyramid: [2, 6], funnel: [2, 6], matrix: [4, 4], tree: [2, 14], venn: [2, 3], target: [2, 5], steps: [2, 6] }; // [min, max] items — a tree is also held to its layout's DIAGRAM_MAX
  function diagramForm(b) { for (var i = 0; i < b.attrs.classes.length; i++) if (DIAGRAM_FORMS[b.attrs.classes[i]]) return b.attrs.classes[i]; return ''; }
  function shaped(b) {
    var opts = {};
    b.lines.forEach(function (l) { var m = /^\s*(center|x|y)\s*:\s*(.*)$/i.exec(l); if (m) opts[m[1].toLowerCase()] = { text: m[2].trim(), line: b.map[0] + 1 + b.lines.indexOf(l) }; });
    return { form: diagramForm(b), items: items(b).map(function (it) { return { title: it.cols[0] || '', text: it.cols[1] || '', hero: has(it.attrs, 'hero'), line: it.line }; }), opts: opts };
  }
  // `{.tree}`: the indent is the hierarchy — each item hangs from the last one written less indented; `- name | role`
  function tree(b) {
    var d = { kind: 'tree', dir: 'TD', nodes: [], edges: [], byId: {}, ignored: [], refused: [], bad: [], ortho: true }, stack = [];
    b.lines.forEach(function (l, k) {
      var m = /^(\s*)[-*]\s+(.*)$/.exec(l);
      if (!m) return;
      var ind = m[1].replace(/\t/g, '    ').length, it = splitItem(m[2]);
      var n = { id: 'n' + d.nodes.length, label: it.cols[0] || '', sub: it.cols[1] || '', shape: 'rect', hero: has(it.attrs, 'hero'), line: b.map[0] + 1 + k, k: d.nodes.length };
      d.nodes.push(n);
      while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
      if (stack.length) d.edges.push({ from: stack[stack.length - 1].n, to: n, kind: 'solid', arrow: false, back: false, label: '', line: n.line });
      else n.root = true;
      stack.push({ ind: ind, n: n });
    });
    return d;
  }
  function dgCard(it, k, style, cls) {
    return '<div class="dg-card' + (cls ? ' ' + cls : '') + (it.hero ? ' is-hero' : '') + '" style="--k:' + k + ';' + style + '"><b' + src(it.line, 0) + '>' + inline(it.title) + '</b>' +
      (it.text ? '<span' + src(it.line, 1) + '>' + inline(it.text) + '</span>' : '') + '</div>';
  }
  // the height a card will take, estimated the way the layout estimates a node: the cycle needs it before the page exists
  function dgCardH(it, w) {
    var t = dgWrap(it.title, Math.floor((w - 28) / (20 * 0.56))).length, x = it.text ? dgWrap(it.text, Math.floor((w - 28) / (16 * 0.52))).length : 0;
    return 26 + t * 25 + (x ? 6 + x * 21 : 0);
  }
  // `{.cycle}` and `{.radial}` share the ring: a cycle turns from card to card, a radial hangs its cards on a hub
  function cycleHtml(s, box, radial) {
    var n = s.items.length, W = box.w, H = box.h, cx = W / 2, cy = H / 2, cw, hs, rx, ry, at, rects;
    var ang = s.items.map(function (_, k) { return -Math.PI / 2 + 2 * Math.PI * k / n; });
    // the widest cards that do not touch: on a narrow screen the ring is tall and the cards of one row come close
    for (cw = Math.min(250, Math.round(W * 0.42)); ; cw -= 10) {
      hs = s.items.map(function (it) { return dgCardH(it, cw); });
      var mh = Math.max.apply(null, hs);
      rx = W / 2 - cw / 2 - 6; ry = H / 2 - mh / 2 - 6;
      rx = Math.min(rx, ry * 2.3); ry = Math.min(ry, rx * 2.3);
      at = function (a) { return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; };
      rects = s.items.map(function (_, k) { var p = at(ang[k]); return { x0: p.x - cw / 2 - 12, x1: p.x + cw / 2 + 12, y0: p.y - hs[k] / 2 - 12, y1: p.y + hs[k] / 2 + 12 }; });
      var touch = rects.some(function (r, i) { return rects.some(function (q, j) { return j > i && r.x0 + 12 < q.x1 - 12 && q.x0 + 12 < r.x1 - 12 && r.y0 + 12 < q.y1 - 12 && q.y0 + 12 < r.y1 - 12; }); });
      if (!touch || cw <= 150) break;
    }
    var inside = function (p, r) { return p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1; };
    var arcs = [], AL = 14, hubR = Math.max(62, Math.min(110, Math.min(rx, ry) * 0.5));
    if (radial) for (var j = 0; j < n; j++) { // a spoke from the hub to each card, out of both
      var c = at(ang[j]), run = [];
      for (var q2 = 0; q2 <= 60; q2++) { var pp = { x: cx + (c.x - cx) * q2 / 60, y: cy + (c.y - cy) * q2 / 60 }; if (Math.sqrt((pp.x - cx) * (pp.x - cx) + (pp.y - cy) * (pp.y - cy)) > hubR + 8 && !inside(pp, rects[j])) run.push(pp); }
      if (run.length > 1) arcs.push('<line class="dg-edge dg-spoke" style="--k:' + (j + 0.4) + '" pathLength="1" x1="' + f1(run[0].x) + '" y1="' + f1(run[0].y) + '" x2="' + f1(run[run.length - 1].x) + '" y2="' + f1(run[run.length - 1].y) + '"/>');
    }
    for (var k = 0; k < n && !radial; k++) { // the arc from card k to the next: the ring between the two, out of both cards
      var a0 = ang[k], a1 = k + 1 < n ? ang[k + 1] : ang[0] + 2 * Math.PI, pts = [];
      for (var i = 0; i <= 90; i++) { var p = at(a0 + (a1 - a0) * i / 90); if (!inside(p, rects[k]) && !inside(p, rects[(k + 1) % n])) pts.push(p); }
      if (pts.length < 3) continue;
      var tip = pts[pts.length - 1], prev = pts[pts.length - 2], dx = tip.x - prev.x, dy = tip.y - prev.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl; dy /= dl;
      while (pts.length > 2) { var q = pts[pts.length - 1]; if (Math.sqrt((q.x - tip.x) * (q.x - tip.x) + (q.y - tip.y) * (q.y - tip.y)) >= AL) break; pts.pop(); }
      var bx = tip.x - dx * AL, by = tip.y - dy * AL;
      arcs.push('<path class="dg-edge dg-arc" style="--k:' + (k + 0.6) + '" pathLength="1" d="M' + pts.map(function (q) { return f1(q.x) + ',' + f1(q.y); }).join('L') + 'L' + f1(bx) + ',' + f1(by) + '"/>' +
        '<polygon class="dg-head" style="--k:' + (k + 1) + '" points="' + f1(tip.x) + ',' + f1(tip.y) + ' ' + f1(bx - dy * AL * 0.5) + ',' + f1(by + dx * AL * 0.5) + ' ' + f1(bx + dy * AL * 0.5) + ',' + f1(by - dx * AL * 0.5) + '"/>');
    }
    var center = radial ? '<div class="dg-hub" style="left:' + f1(cx) + 'px;top:' + f1(cy) + 'px;width:' + f1(hubR * 2) + 'px;height:' + f1(hubR * 2) + 'px"' + (s.opts.center ? src(s.opts.center.line) : '') + '>' + (s.opts.center ? inline(s.opts.center.text) : '') + '</div>'
      : s.opts.center ? '<div class="dg-center" style="left:' + f1(cx) + 'px;top:' + f1(cy) + 'px;max-width:' + f1(Math.max(120, rx * 1.2 - cw / 2)) + 'px"' + src(s.opts.center.line) + '>' + inline(s.opts.center.text) + '</div>' : '';
    return '<div class="dg-stage" style="width:' + W + 'px;height:' + H + 'px"><svg class="diagram-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + arcs.join('') + '</svg>' + center +
      s.items.map(function (it, k) { var p = at(ang[k]); return dgCard(it, k, 'left:' + f1(p.x) + 'px;top:' + f1(p.y) + 'px;width:' + cw + 'px'); }).join('') + '</div>';
  }
  // `{.pyramid}` builds from its base, the first item on top; `{.funnel}` narrows from the first item down to the last
  function pyramidHtml(s, box, funnel) {
    var n = s.items.length, bh = Math.min(104, Math.floor(box.h / n)), ph = bh * n, pw = Math.min(Math.round(box.w * 0.44), Math.round(ph * 1.35)), top = funnel ? 0.2 : 0.08;
    var hw = function (y) { return pw / 2 * (top + (1 - top) * (funnel ? 1 - y / ph : y / ph)); }, cx = pw / 2, bands = [];
    var order = function (k) { return funnel ? k : n - 1 - k; };
    s.items.forEach(function (it, k) {
      var y0 = k * bh + (k ? 3 : 0), y1 = (k + 1) * bh - 3, t = n > 1 ? Math.round(funnel ? 38 + 62 * k / (n - 1) : 100 - 62 * k / (n - 1)) : 100;
      bands.push('<polygon class="dg-band' + (it.hero ? ' is-hero' : '') + '" style="--k:' + order(k) + ';--t:' + t + '%" points="' + f1(cx - hw(y0)) + ',' + f1(y0) + ' ' + f1(cx + hw(y0)) + ',' + f1(y0) + ' ' + f1(cx + hw(y1)) + ',' + f1(y1) + ' ' + f1(cx - hw(y1)) + ',' + f1(y1) + '"/>' +
        '<line class="dg-leader" style="--k:' + order(k) + '" x1="' + f1(cx + hw((y0 + y1) / 2) + 10) + '" x2="' + (pw + 28) + '" y1="' + f1((y0 + y1) / 2) + '" y2="' + f1((y0 + y1) / 2) + '"/>');
    });
    return '<div class="dg-pyramid" style="--bh:' + bh + 'px"><svg class="diagram-svg" viewBox="0 0 ' + (pw + 30) + ' ' + ph + '" width="' + (pw + 30) + '" height="' + ph + '" aria-hidden="true">' + bands.join('') + '</svg>' +
      '<div class="dg-rows">' + s.items.map(function (it, k) { return dgCard(it, order(k), ''); }).join('') + '</div></div>';
  }
  function matrixHtml(s) {
    var ax = function (o, cls) { if (!o) return ''; var p = o.text.split(COLS).map(function (x) { return x.trim(); }); return '<div class="dg-axis ' + cls + '"' + src(o.line) + '><span>' + inline(p[0] || '') + '</span>' + (p[1] ? '<span>' + inline(p[1]) + '</span>' : '') + '</div>'; };
    return '<div class="dg-matrix' + (s.opts.y ? ' has-y' : '') + (s.opts.x ? ' has-x' : '') + '">' + ax(s.opts.y, 'dg-axis--y') + '<div class="dg-grid">' + s.items.map(function (it, k) { return dgCard(it, k, ''); }).join('') + (s.opts.center ? '<div class="dg-grid-center"' + src(s.opts.center.line) + '>' + inline(s.opts.center.text) + '</div>' : '') + '</div>' + ax(s.opts.x, 'dg-axis--x') + '</div>';
  }
  // `{.venn}`: two or three circles that overlap; `center:` names what they share
  function vennHtml(s, box) {
    var n = s.items.length, H = Math.min(box.h, 460), W = box.w, cx = W / 2, cy = H / 2, r, cs;
    if (n === 2) { r = Math.min(H * 0.47, W * 0.27); cs = [{ x: cx - r * 0.62, y: cy, dx: -1, dy: 0 }, { x: cx + r * 0.62, y: cy, dx: 1, dy: 0 }]; }
    else { r = Math.min(H * 0.3, W * 0.2); var dd = r * 0.68; cs = [-90, 30, 150].map(function (a) { var t = a * Math.PI / 180; return { x: cx + dd * Math.cos(t), y: cy + dd * 0.92 * Math.sin(t) + r * 0.08, dx: Math.cos(t), dy: Math.sin(t) }; }); }
    var svg = cs.map(function (c, k) { return '<circle class="dg-set dg-v' + (k + 1) + (s.items[k].hero ? ' is-hero' : '') + '" style="--k:' + k + '" cx="' + f1(c.x) + '" cy="' + f1(c.y) + '" r="' + f1(r) + '"/>'; }).join('');
    var tw = Math.round(r * (n === 2 ? 0.95 : 0.9)), off = n === 2 ? r * 0.42 : r * 0.42;
    var center = s.opts.center ? '<div class="dg-center dg-center--venn" style="left:' + f1(cx) + 'px;top:' + f1(n === 2 ? cy : cy + r * 0.04) + 'px;max-width:' + f1(r * (n === 2 ? 0.7 : 0.6)) + 'px"' + src(s.opts.center.line) + '>' + inline(s.opts.center.text) + '</div>' : '';
    return '<div class="dg-stage dg-venn" style="width:' + W + 'px;height:' + H + 'px"><svg class="diagram-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + svg + '</svg>' + center +
      s.items.map(function (it, k) { var c = cs[k]; return dgCard(it, k, 'left:' + f1(c.x + c.dx * off) + 'px;top:' + f1(c.y + c.dy * off) + 'px;width:' + tw + 'px'); }).join('') + '</div>';
  }
  // `{.target}`: rings from the core out, the first item the core; each ring named beside it by a leader
  function targetHtml(s, box) {
    var n = s.items.length, H = Math.min(box.h, 480), R = H / 2 - 4, cx = R + 4, cy = H / 2, tx = R * 2 + 70, out = [];
    for (var k = n - 1; k >= 0; k--) out.push('<circle class="dg-ring' + (s.items[k].hero ? ' is-hero' : '') + '" style="--k:' + k + ';--t:' + Math.round(100 - 62 * k / Math.max(1, n - 1)) + '%" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(R * (k + 1) / n) + '"/>');
    var rows = s.items.map(function (_, k) { return cy - R + (k + 0.5) * (2 * R / n); });
    s.items.forEach(function (_, k) {
      var rm = R * (k + 0.55) / n, th = (-55 + 110 * (n > 1 ? k / (n - 1) : 0.5)) * Math.PI / 180, px = cx + rm * Math.cos(th), py = cy + rm * Math.sin(th);
      out.push('<polyline class="dg-leader dg-leader--solid" style="--k:' + k + '" points="' + f1(px) + ',' + f1(py) + ' ' + f1(R * 2 + 30) + ',' + f1(rows[k]) + ' ' + f1(tx - 10) + ',' + f1(rows[k]) + '"/><circle class="dg-dot" style="--k:' + k + '" cx="' + f1(px) + '" cy="' + f1(py) + '" r="5"/>');
    });
    return '<div class="dg-stage dg-target" style="width:100%;height:' + H + 'px"><svg class="diagram-svg" viewBox="0 0 ' + f1(tx) + ' ' + H + '" width="' + f1(tx) + '" height="' + H + '" aria-hidden="true">' + out.join('') + '</svg>' +
      s.items.map(function (it, k) { return dgCard(it, k, 'left:' + f1(tx) + 'px;top:' + f1(rows[k]) + 'px'); }).join('') + '</div>';
  }
  // `{.steps}`: a staircase, each step a level higher — a maturity, a progression
  function stepsHtml(s, box) {
    var n = s.items.length, H = Math.min(box.h, 440), lo = Math.round(H * 0.34), inc = n > 1 ? (H - lo) / (n - 1) : 0;
    return '<div class="dg-steps" style="height:' + H + 'px">' + s.items.map(function (it, k) {
      return dgCard(it, k, 'height:' + Math.round(lo + inc * k) + 'px;--t:' + Math.round(15 + 57 * k / Math.max(1, n - 1)) + '%', 15 + 57 * k / Math.max(1, n - 1) >= 48 ? 'is-deep' : ''); // the words turn light where the step turns deep
    }).join('') + '</div>';
  }
  function shapedHtml(b, ctx) {
    var s = shaped(b), box = diagramBox(ctx, has(b.attrs, 'right'));
    var f = s.form, body = f === 'cycle' || f === 'radial' ? cycleHtml(s, box, f === 'radial') : f === 'pyramid' || f === 'funnel' ? pyramidHtml(s, box, f === 'funnel')
      : f === 'venn' ? vennHtml(s, box) : f === 'target' ? targetHtml(s, box) : f === 'steps' ? stepsHtml(s, box) : matrixHtml(s);
    return '<figure class="diagram diagram--' + s.form + '">' + body + '</figure>';
  }

  /* A timeline in phases — the heading form, as `cards` has it: `### date — title` opens a phase, `-` lines are its details,
     plain lines its text; `{.now}` `{.next}` on the heading. The dots and their line stay on top, each phase's detail in a
     card under its dot — a project plan, a roadmap, the timeline + cards a user stacked by hand (2026-10-12) in one block. */
  function phasesHtml(b) {
    var ps = sections(b);
    return '<div class="timeline timeline--phases" style="--n:' + ps.length + '">' + ps.map(function (p, k) {
      var m = /^(.+?)\s+[—–]\s+(.+)$/.exec(p.title || ''), date = m ? m[1] : '', title = m ? m[2] : p.title;
      var cls = 'tl-step' + (has(p.attrs, 'now') ? ' is-now' : '') + (has(p.attrs, 'next') ? ' is-next' : '') + (has(p.attrs, 'hero') ? ' is-hero' : '');
      return '<div class="' + cls + '"><div class="dot">' + pad2(k + 1) + '</div>' +
        (date ? '<div class="tl-date"' + src(p.line) + '>' + inline(date) + '</div>' : '') +
        '<div class="tl-card">' + (title ? '<h4' + (date ? '' : src(p.line)) + '>' + inline(title) + '</h4>' : '') +
        p.text.map(function (t, j) { return '<p' + src(p.textLines[j]) + '>' + inline(t) + '</p>'; }).join('') +
        (p.items.length ? '<ul>' + p.items.map(function (t, j) { return '<li><span' + src(p.itemLines[j]) + '>' + inline(t) + '</span></li>'; }).join('') + '</ul>' : '') +
        '</div></div>';
    }).join('') + '</div>';
  }

  /* ───────────────────────── blocks ───────────────────────── */
  var BLOCKS = {
    metrics: {
      max: 4,
      render: function (b) {
        var its = items(b);
        return '<div class="metrics" style="--n:' + its.length + '">' + its.map(function (it) {
          return '<div class="metric' + (has(it.attrs, 'hero') ? ' metric--hero is-hero' : '') + '">' +
            '<div class="v"' + src(it.line, 0) + '>' + inline(it.cols[0] || '') + '</div>' +
            '<div class="l"' + src(it.line, 1) + '>' + inline(it.cols[1] || '') + '</div>' +
            (it.cols[2] ? '<div class="s"' + src(it.line, 2) + '>' + inline(it.cols[2]) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
      }
    },
    timeline: {
      max: 6,
      count: function (b) { return hasHeadings(b) ? sections(b).length : items(b).length; },
      render: function (b) {
        if (hasHeadings(b)) return phasesHtml(b);
        var its = items(b);
        return '<div class="timeline' + (has(b.attrs, 'chevrons') ? ' timeline--chevrons' : '') + '">' + its.map(function (it, k) {
          var c = it.cols, title, text;
          if (c.length >= 3) { title = c[0] + ' — ' + c[1]; text = c[2]; } else { title = c[0]; text = c[1] || ''; }
          var cls = 'tl-step' + (has(it.attrs, 'now') ? ' is-now' : '') + (has(it.attrs, 'next') ? ' is-next' : '');
          return '<div class="' + cls + '"><div class="dot">' + pad2(k + 1) + '</div><h4' + src(it.line, c.length >= 3 ? 1 : 0) + '>' + inline(title) + '</h4>' +
            (text ? '<p' + src(it.line, c.length >= 3 ? 2 : 1) + '>' + inline(text) + '</p>' : '') + '</div>';
        }).join('') + '</div>';
      }
    },
    compare: {
      max: 2,
      count: function (b) { return sections(b).length; },
      render: function (b) {
        var cols = sections(b), light = has(b.attrs, 'light');
        return '<div class="compare">' + cols.map(function (c, k) {
          return '<div class="col ' + (k === 0 || light ? 'col--light' : 'col--dark') + (has(c.attrs, 'hero') ? ' is-hero' : '') + '">' +
            (c.title ? '<h3' + src(c.line) + '>' + inline(c.title) + '</h3>' : '') +
            c.text.map(function (t, j) { return '<p' + src(c.textLines[j]) + '>' + inline(t) + '</p>'; }).join('') +
            (c.items.length ? '<ul>' + c.items.map(function (t, j) { return '<li><span' + src(c.itemLines[j]) + '>' + inline(t) + '</span></li>'; }).join('') + '</ul>' : '') + '</div>';
        }).join('') + '</div>';
      }
    },
    // `- title | text` items, or `### Title` + bullets/text; `{.wide}` spans the row; `{.numbered}` on the block
    cards: {
      max: 5,
      count: function (b) { return hasHeadings(b) ? sections(b).length : items(b).length; },
      render: function (b, ctx) {
        var brand = (ctx && ctx.brand) || {}, marker = brand['card-marker'] || 'glyphs', glyphs = +brand.glyphs || 0, alt = brand['card-fill'] === 'alternate';
        var start = ctx ? (ctx.cardBlocks = (ctx.cardBlocks || 0) + 1) - 1 : 0; // each cards block starts one shape further: no two slides look alike
        var cards = hasHeadings(b)
          ? sections(b).map(function (c) { return { title: c.title, text: c.text, items: c.items, attrs: c.attrs, line: c.line, textLines: c.textLines, itemLines: c.itemLines, col: null }; })
          : items(b).map(function (it) { return { title: it.cols[0] || '', text: it.cols[1] ? [it.cols[1]] : [], items: [], attrs: it.attrs, line: it.line, textLines: [it.line], itemLines: [], col: 0 }; });
        var n = cards.filter(function (c) { return !has(c.attrs, 'wide'); }).length || 1;
        var numbered = has(b.attrs, 'numbered');
        if (has(b.attrs, 'plain')) marker = 'none'; // the deck's own say over the theme's marker: no shape on these cards
        return '<div class="cards' + (brand['card-shadow'] === 'offset' ? ' cards--offset' : '') + '" style="--n:' + n + '">' + cards.map(function (c, k) {
          return '<div class="card' + (has(c.attrs, 'wide') ? ' card--wide' : '') + (has(c.attrs, 'hero') ? ' is-hero' : '') + (alt && !c.items.length && k % 2 === 0 ? ' card--vivid' : '') + '">' +
            (numbered ? '<div class="num">' + pad2(k + 1) + '</div>'
              : marker === 'mark' ? '<div class="num num--mark"><svg><use href="#brand-mark"/></svg></div>'
              : marker === 'glyphs' ? '<div class="num num--glyph"><svg><use href="#' + (glyphs ? 'brand-glyph-' + ((k + start) % glyphs + 1) : 'brand-mark') + '"/></svg></div>'
              : marker === 'letter' ? '<div class="num num--letter">' + esc((c.title || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?') + '</div>'
              : marker === 'none' ? ''
              : '<div class="num num--icon" data-icon="' + iconFor(c.title, k) + '">' + iconSvg(iconFor(c.title, k)) + '</div>') +
            (c.title ? '<h3' + src(c.line, c.col) + '>' + inline(c.title) + '</h3>' : '') +
            c.text.map(function (t, j) { return '<p' + src(c.textLines[j], c.col == null ? null : 1) + '>' + inline(t) + '</p>'; }).join('') +
            (c.items.length ? '<ul>' + c.items.map(function (t, j) { return '<li><span' + src(c.itemLines[j]) + '>' + inline(t) + '</span></li>'; }).join('') + '</ul>' : '') +
            '</div>';
        }).join('') + '</div>';
      }
    },
    pills: {
      max: 8,
      render: function (b) {
        return '<div class="pills">' + items(b).map(function (it) { return '<span class="slide-pill"' + src(it.line) + '>' + inline(it.cols.join(' · ')) + '</span>'; }).join('') + '</div>';
      }
    },
    // a wall of `- ![Name](file)` images
    logos: {
      max: 40,
      render: function (b, ctx) {
        var out = [];
        b.lines.forEach(function (l) {
          var m = /^\s*[-*]\s+!\[([^\]]*)\]\(([^)\s]+)\)/.exec(l);
          if (m) out.push('<div class="logo">' + imgTag(m[2], m[1], ctx) + '</div>');
        });
        return '<div class="logos' + (out.length > 18 ? ' logos--dense' : '') + '">' + out.join('') + '</div>';
      }
    },
    // a Markdown pipe table: the row above `|---|` is the header, `:--:` aligns, a column of numbers aligns right by itself; `{.hero}` on a row
    table: {
      max: TABLE_SPLIT_MAX, // 12 rows in one table; past that it folds in two (the linter holds the rest: TABLE_MAX, TABLE_SPLIT_COLS)
      count: function (b) { return table(b).rows.length; },
      render: function (b) {
        var t = table(b), numeric = [];
        for (var j = 0; j < t.width; j++) numeric[j] = t.rows.length > 0 && t.rows.every(function (r) { return !r.cells[j] || !r.cells[j].text || num(r.cells[j].text) != null; });
        function cell(tag, r, j, line) {
          var c = r.cells[j], a = t.align[j] || (numeric[j] && tag === 'td' ? 'right' : '');
          return '<' + tag + (a ? ' class="is-' + a + '"' : '') + (c ? src(line, c.col) : '') + '>' + (c ? inline(c.text) : '') + '</' + tag + '>';
        }
        function row(r, tag) { var cs = []; for (var j = 0; j < t.width; j++) cs.push(cell(tag, r, j, r.line)); return cs.join(''); }
        function one(rows, compact) {
          return '<div class="table-wrap"><table class="table' + (compact ? ' table--compact' : '') + '" style="--cols:' + t.width + '">' +
            (t.head ? '<thead><tr>' + row(t.head, 'th') + '</tr></thead>' : '') +
            '<tbody>' + rows.map(function (r) { return '<tr' + (has(r.attrs, 'hero') ? ' class="is-hero"' : '') + '>' + row(r, 'td') + '</tr>'; }).join('') + '</tbody></table></div>';
        }
        /* A long list folds in two (seen in the field, 2026-10-12: 14 companies became two hand-made pairs of columns, unequal, and a hero
           that lit both halves of a row): past 12 rows, or on `{.split}`, two tables of equal width, the header repeated,
           the first half the longer — a row's `{.hero}` lights that row alone. */
        if (tableSplit(b, t)) {
          var h = Math.ceil(t.rows.length / 2);
          return '<div class="table-split">' + one(t.rows.slice(0, h), has(b.attrs, 'compact') || h > 7) + one(t.rows.slice(h), has(b.attrs, 'compact') || h > 7) + '</div>';
        }
        return one(t.rows, has(b.attrs, 'compact') || t.rows.length > 7);
      }
    },
    // numbers drawn: `- label | value` items (several values = several series), `{.bar}` (default) `{.hbar}` `{.line}` `{.pie}` on the block
    chart: { // its maximum depends on its type: the linter says it (CHART_MAX)
      count: function (b) { return items(b).length; },
      render: function (b, ctx) {
        var c = chart(b), box = chartBox(ctx, has(b.attrs, 'right'));
        c.dec = /^(fr|de|es|it|pt|nl|pl|ru|sv|da|fi|nb|nn|no|cs|tr)\b/i.test((ctx && ctx.lang) || '') ? ',' : '.';
        var keys = c.type === 'pie' ? (function () {
          var tot = c.items.reduce(function (s, it) { return s + Math.max(0, it.values[0] || 0); }, 0) || 1;
          return '<ul class="chart-keys">' + c.items.map(function (it, k) {
            var v = it.values[0] || 0;
            return '<li class="chart-key chart-c' + (k % 6 + 1) + (it.hero ? ' is-hero' : '') + '"><i></i><span class="k"' + src(it.line, 0) + '>' + inline(it.label) + '</span><span class="p">' + Math.round(Math.max(0, v) / tot * 100) + '\u00A0%</span></li>';
          }).join('') + '</ul>';
        })() : '';
        return '<figure class="chart chart--' + c.type + '" style="--chart-h:' + box.h + 'px">' + chartLegend(c) +
          '<div class="chart-plot">' + chartSvg(c, box, 'jc-' + (ctx ? (ctx.charts = (ctx.charts || 0) + 1) : 1) + '-') + keys + '</div>' + chartText(c) + '</figure>';
      }
    },
    // boxes and arrows: a Mermaid flowchart, read and drawn here (no Mermaid runs); `{.right}` beside an image's column
    diagram: { // its maximum depends on the layout: the linter says it (DIAGRAM_MAX)
      count: function (b) { return diagramForm(b) ? items(b).length : diagram(b).nodes.length; },
      render: function (b, ctx) {
        var form = diagramForm(b);
        if (form && form !== 'tree') return shapedHtml(b, ctx);
        var d = form ? tree(b) : diagram(b);
        if ((!form && DIAGRAM_KINDS.indexOf(d.kind) < 0) || !d.nodes.length || d.nodes.length > DIAGRAM_LAYOUT_MAX || d.edges.length > 3 * DIAGRAM_LAYOUT_MAX) return '<figure class="diagram diagram--none"><pre>' + esc(b.lines.join('\n')) + '</pre></figure>';
        var dir = form ? diagramDir({ dir: has(b.attrs, 'lr') ? 'LR' : 'TD' }, ctx) : diagramDir(d, ctx), g = diagramSvg(d, diagramBox(ctx, has(b.attrs, 'right')), dir);
        return '<figure class="diagram diagram--' + dir.toLowerCase() + '" style="--chart-h:' + Math.round(g.h) + 'px">' + g.svg + diagramText(d) + '</figure>';
      }
    },
    statement: {
      full: true,
      render: function (b, ctx) {
        var paras = [], attr = null, paraLine = null, attrLine = null;
        b.lines.forEach(function (l, k) {
          if (!l.trim()) return;
          if (/^—\s/.test(l)) { attr = l.replace(/^—\s*/, ''); attrLine = b.map[0] + 1 + k; return; }
          paras.push(l.trim()); if (paraLine == null) paraLine = b.map[0] + 1 + k;
        });
        // a PNG logo is a picture, not a shape: no blob drawn from it (1.31.0)
        return (ctx && ctx.brand && ctx.brand['logo-kind'] === 'raster' ? '' : '<svg class="mark-blob mark-blob--statement" aria-hidden="true"><use href="#brand-mark"/></svg>') +
          '<div class="statement"><div class="mark">&ldquo;</div>' +
          '<p class="q"' + src(paras.length === 1 ? paraLine : null) + '>' + inline(paras.join(' ')) + '</p>' +
          (attr ? '<div class="attr"' + src(attrLine) + '>' + inline(attr) + '</div>' : '') + '</div>';
      }
    },
    // a divider slide: the part title, centered; `{.numbered}` adds the part number
    section: {
      full: true,
      render: function (b, ctx) {
        var text = [], textLines = [];
        b.lines.forEach(function (l, k) { if (l.trim()) { text.push(l.trim()); textLines.push(b.map[0] + 1 + k); } });
        ctx.sectionCount = (ctx.sectionCount || 0) + 1;
        return '<div class="divider">' +
          (has(b.attrs, 'numbered') ? '<div class="slide-eyebrow">' + pad2(ctx.sectionCount) + '</div>' : '') +
          '<h1 class="slide-h1"' + src(textLines[0]) + '>' + inline(text[0] || '') + '</h1>' +
          (text[1] ? '<p class="slide-lead">' + inline(text.slice(1).join(' ')) + '</p>' : '') + '</div>';
      }
    }
  };

  /* ───────────────────────── render ───────────────────────── */
  function renderProse(node) {
    var html = '', list = null;
    function flush() { if (list) { html += '<ul' + (list.length > 7 ? ' class="long"' : list.length <= 4 ? ' class="few"' : '') + '>' + list.map(function (t) { return '<li' + src(t.line) + '>' + inline(t.text) + '</li>'; }).join('') + '</ul>'; list = null; } }
    node.lines.forEach(function (l, k) {
      var mI = /^\s*[-*]\s+(.*)$/.exec(l);
      if (mI) { if (!list) list = []; list.push({ text: mI[1], line: node.map[0] + k }); return; }
      flush();
      if (l.trim()) html += '<p' + src(node.map[0] + k) + '>' + inline(l.trim()) + '</p>';
    });
    flush();
    return '<div class="prose">' + html + '</div>';
  }

  // the line of a `key:` in the slide frontmatter (for in-place editing of eyebrow)
  function metaLine(slide, key) {
    if (!slide.metaMap) return null;
    var src = ctx_lines_cache; if (!src) return null;
    for (var i = slide.metaMap[0]; i < slide.metaMap[1]; i++) if (new RegExp('^' + key + ':', 'i').test(src[i])) return i;
    return null;
  }
  var ctx_lines_cache = null;
  function renderSlide(slide, idx, ctx) {
    var m = slide.meta, intent = INTENTS.indexOf(m.intent) >= 0 ? m.intent : null;
    var bg = intent ? INTENT_BG[intent] : (m.bg || 'white'); // an intent sets the background itself
    if (m.section) ctx.section = m.section;
    var dark = bg === 'indigo' || bg === 'accent' || bg === 'sky';
    var chrome = '<div class="slide-chrome"><div class="lockup"><svg><use href="#brand-mark"/></svg>' + esc(ctx.brand.name || '') + '</div>' +
      '<div class="chrome-meta">' + esc(ctx.section || '') + '</div></div>';
    // Slide: the number in the corner. Doc and Story: page n / N — a page reads alone once printed or posted; Doc adds the
    // document's title in the footer. Webpage: no tag, the sections are one page.
    var tag = ctx.layout === 'doc' ? '<div class="slide-tag">' + pad2(idx + 1) + ' / ' + pad2(ctx.total) + '</div><div class="slide-foot">' + esc(ctx.title || '') + '</div>'
      : ctx.layout === 'story' ? '<div class="slide-tag">' + pad2(idx + 1) + ' / ' + pad2(ctx.total) + '</div>'
      : ctx.layout === 'webpage' ? ''
      : '<div class="slide-tag">' + pad2(idx + 1) + '</div>';
    var notes = m.notes ? ' data-notes="' + esc(inline(m.notes)) + '"' : '';

    var title = slide.nodes.find(function (n) { return n.type === 'title'; });
    var images = slide.nodes.filter(function (n) { return n.type === 'image'; });
    var right = images.find(function (n) { return has(n.attrs, 'right'); });
    var cover = images.find(function (n) { return has(n.attrs, 'cover'); });
    var rightBlock = slide.nodes.find(function (n) { return n.type === 'block' && has(n.attrs, 'right') && BLOCKS[n.name] && !BLOCKS[n.name].full; });
    var classes = ['slide', 'slide--' + bg];
    if (intent) classes.push('slide--' + intent, 'slide--intent');
    if (right) classes.push('slide--split');
    if (rightBlock) classes.push('slide--split-block');
    if (title && title.level === 1) classes.push('slide--cover');

    var full = slide.nodes.find(function (n) { return n.type === 'block' && BLOCKS[n.name] && BLOCKS[n.name].full; });
    var inner;
    if (full) {
      inner = BLOCKS[full.name].render(full, ctx);
    } else {
      var head = '';
      if (m.eyebrow || title) {
        var h = title && title.level === 1 ? 'h1' : 'h2', hc = title && title.level === 1 ? 'slide-h1' : 'slide-h2';
        head = '<div class="slide-head">' +
          (m.eyebrow ? '<div class="slide-eyebrow"' + src(metaLine(slide, 'eyebrow')) + '>' + inline(m.eyebrow) + '</div>' : '') +
          (title ? '<' + h + ' class="' + hc + '"' + src(title.map[0]) + '>' + inline(title.text) + '</' + h + '>' : '') +
          '</div>';
      }
      var body = slide.nodes.map(function (n) {
        if (n.type === 'title') return '';
        if (n.type === 'lead') return '<p class="slide-lead"' + src(n.map[1] - n.map[0] === 1 ? n.map[0] : null) + '>' + inline(n.text) + '</p>';
        if (n.type === 'prose') return renderProse(n);
        if (n.type === 'image') {
          if (n === right || n === cover) return '';
          return '<figure class="figure' + (has(n.attrs, 'wide') ? ' figure--wide' : '') + '">' + imgTag(n.src, n.alt, ctx) + (n.alt ? '<figcaption>' + inline(n.alt) + '</figcaption>' : '') + '</figure>';
        }
        if (n.type === 'block') {
          if (n === rightBlock) return '';
          if (BLOCKS[n.name]) return BLOCKS[n.name].render(n, ctx);
          return '<div class="prose"><p><em>unknown block: ' + esc(n.name) + '</em></p></div>';
        }
        return '';
      }).join('');
      inner = '<div class="body-pad">' + head + body + '</div>';
      if (right) inner += '<div class="split-media">' + imgTag(right.src, right.alt, ctx) + '</div>';
      if (rightBlock) inner += '<div class="split-block">' + BLOCKS[rightBlock.name].render(rightBlock, ctx) + '</div>';
      if (cover) inner += '<div class="cover-art">' + imgTag(cover.src, cover.alt, ctx) + '</div>';
    }
    // the watermark: a brand feature, never on a slide that has its own decoration. With `mark` it is the deck's glyph — one shape
    // for the whole deck, posed by the intent (engine.css), carried from slide to slide by the presenter; `celebrate` multiplies it
    var wm = ctx.brand.watermark || 'mark', decorated = full || right || cover;
    var glyph = '<use href="#' + (+ctx.brand.glyphs ? 'brand-glyph-1' : 'brand-mark') + '"/>';
    var watermark = wm === 'none' || decorated ? ''
      : '<div class="wm wm--' + esc(wm) + ' wm--' + (idx % 2 ? 'b' : 'a') + '" aria-hidden="true">' + (wm === 'mark' ? '<svg class="wm-g">' + glyph + '</svg>' + (intent === 'celebrate' ? new Array(7).join('<svg class="wm-bit">' + glyph + '</svg>') : '') : '') + '</div>';
    return '<section class="' + classes.join(' ') + '"' + notes + (intent ? ' data-intent="' + intent + '"' : '') + ' data-start="' + slide.map[0] + '">' + watermark + chrome + inner + tag + '</section>';
  }

  function render(doc, ctx) {
    ctx_lines_cache = doc.lines || null;
    var c = { brand: (ctx && ctx.brand) || {}, assets: (ctx && ctx.assets) || {}, section: doc.meta.section || '', sectionCount: 0, layout: layout(doc), total: doc.slides.length, title: doc.meta.title || '', lang: doc.meta.lang || '' };
    return doc.slides.map(function (s, i) { return renderSlide(s, i, c); }).join('\n');
  }

  /* ───────────────────────── assets ───────────────────────── */
  // every file a deck references: images alone on a line, logos
  function assets(doc) {
    var out = [];
    doc.slides.forEach(function (s, i) {
      s.nodes.forEach(function (n) {
        if (n.type === 'image') out.push({ slide: i + 1, src: n.src, line: n.map[0] });
        if (n.type === 'block' && n.name === 'logos') n.lines.forEach(function (l, k) {
          var m = /^\s*[-*]\s+!\[[^\]]*\]\(([^)\s]+)\)/.exec(l); if (m) out.push({ slide: i + 1, src: m[1], line: n.map[0] + 1 + k });
        });
      });
    });
    return out;
  }

  /* ───────────────────────── linter ───────────────────────── */
  var BGS = ['white', 'indigo', 'accent', 'sky', 'lavender', 'wash', 'butter'];
  // intents (spec/intents.md): what the slide is for; the theme turns it into form. No intent = the neutral form (bg: applies).
  var INTENTS = ['hook', 'problem', 'reveal', 'prove', 'explain', 'decide', 'recap', 'celebrate', 'fun', 'act'];
  var INTENT_BG = { hook: 'accent', problem: 'indigo', reveal: 'white', prove: 'wash', explain: 'white', decide: 'lavender', recap: 'butter', celebrate: 'accent', fun: 'highlight', act: 'indigo' };
  var INTENT_ABOUT = { hook: 'catch attention, give the vision', problem: 'show what is wrong', reveal: 'the key idea, one hero', prove: 'the evidence, dense and equal', explain: 'how it works, step by step', decide: 'the options and the decision', recap: 'three things to remember', celebrate: 'congratulate, thank, a milestone', fun: 'make people laugh', act: 'who does what, when' };

  /* ───────────────────────── shapes: what one can type ─────────────────────────
     One line of help and a minimal valid snippet per shape — the editor's palette and contextual hint read this table. */
  var SHAPES = [
    { name: 'metrics', hint: '- value | label | comment · 4 max · {.hero} on the one that matters', snippet: '::: metrics\n- 42 % | label | One line of context.\n- 3× | label | One line of context.\n:::' },
    { name: 'timeline', hint: '- date — title | text, or ### date — title + bullets (phases) · 6 max · {.now} {.next} on an item · {.chevrons} on the block', snippet: '::: timeline\n- 2024 — Step one | What happened.\n- 2025 — Step two | What happened. {.now}\n:::' },
    { name: 'cards', hint: '- title | text, or ### Title + bullets · 5 max (3 with a lead, ≤ 3 short bullets each) · {.numbered} {.plain} {.right} on the block · {.wide} on a card', snippet: '::: cards\n- Title | One line of text.\n- Title | One line of text.\n- Title | One line of text.\n:::' },
    { name: 'compare', hint: '### Left + bullets, ### Right + bullets · 2 columns, ≤ 4 one-line bullets each · {.light}', snippet: '::: compare\n### Before\n- One point.\n- Another.\n\n### After\n- One point.\n- Another.\n:::' },
    { name: 'statement', hint: 'one sentence, alone on the slide · optional — attribution line', snippet: '::: statement\nOne sentence that carries the slide.\n— Who said it\n:::' },
    { name: 'section', hint: 'a divider: the part title · {.numbered}', snippet: '::: section\nPart title\n:::' },
    { name: 'pills', hint: '- word · 8 max', snippet: '::: pills\n- One\n- Two\n- Three\n:::' },
    { name: 'logos', hint: '- ![Name](file) · 40 max', snippet: '::: logos\n- ![Acme](assets/logo-acme.svg)\n- ![Globex](assets/logo-globex.svg)\n:::' },
    { name: 'table', hint: '| a | b | rows · the row above |---|---| is the header · |--:| aligns right · 12 rows, 6 columns · 13–24 rows of ≤ 3 columns fold in two · {.split} · {.hero} on a row', snippet: '::: table\n| Offer | Users | Price |\n|---|---|---|\n| Starter | 10 | 5 € |\n| Pro | 100 | 9 € | {.hero}\n:::' },
    { name: 'chart', hint: '- label | value · {.bar} {.hbar} {.line} {.pie} on the block · unit: € · series: A | B for two columns of values · {.hero} on an item', snippet: '::: chart {.bar}\nunit: k€\n- Q1 | 120\n- Q2 | 180\n- Q3 | 240 {.hero}\n:::' },
    { name: 'diagram', hint: 'Mermaid: flowchart LR or TD, then A[Step] --> B{Choice} lines · -->|label| · -.-> dotted · A[Text]{.hero} · or a list with a form: {.tree} (indent) {.cycle} {.radial} {.pyramid} {.funnel} {.steps} {.venn} {.target} {.matrix} · center: x: y:', snippet: '::: diagram\nflowchart LR\n  A[Request] --> B{Approved?}\n  B -->|Yes| C[Publish]{.hero}\n  B -->|No| D[Revise]\n  D -.-> A\n:::' },
    { name: 'image', hint: '![alt](file){.right} beside the text · {.cover} decoration · {.wide} below', snippet: '![](assets/image.png){.right}' },
    { name: 'link', hint: '[Label →](url){.cta} a button · [text](url) inline', snippet: '[Learn more →](https://example.com){.cta}' }
  ];
  var CONTEXT_HINTS = {
    frontmatter: 'intent: ' + INTENTS.join(' · ') + '  ·  bg: ' + BGS.join(' · ') + ' (neutral form only — not with an intent)  ·  section: (sticky)  ·  eyebrow:  ·  notes:',
    title: '## slide title, one line · # cover title',
    blank: '::: name opens a block · ![](file){.right} an image · [text](url){.cta} a button · - bullet',
    text: 'lead paragraph · **bold** · [text](url) · keep it to two lines',
    item: '- item · a | b | c for columns · {.mod} at the end'
  };
  // ctx.assets: what is resolvable (Node: files on disk; browser: what is embedded). Missing → error (Node) or warning (browser).
  function lint(doc, ctx) {
    var out = [];
    function err(slide, block, rule, msg) { out.push({ level: 'error', slide: slide, block: block, rule: rule, message: msg }); }
    function warn(slide, block, rule, msg) { out.push({ level: 'warning', slide: slide, block: block, rule: rule, message: msg }); }
    function info(slide, block, rule, msg) { out.push({ level: 'info', slide: slide, block: block, rule: rule, message: msg }); } // advice, never counted

    var fv = /^jmd\/(\d+)$/.exec(doc.meta.format || '');
    if (!fv) err(0, null, 'format', 'missing or invalid `format: jmd/1` header');
    else if (+fv[1] > FORMAT_MAX) err(0, null, 'format', 'format jmd/' + fv[1] + ': this runtime reads up to jmd/' + FORMAT_MAX);
    if (doc.meta.layout && !PAGES[doc.meta.layout]) err(0, null, 'layout', 'unknown layout `' + doc.meta.layout + '`: ' + LAYOUTS.join(', ') + ' (no layout = slide)');
    else if (!doc.meta.layout && fv) info(0, null, 'layout', 'no `layout:` in the header — write `layout: slide`: one word the user changes to make it a doc, a story or a webpage');

    var run = 0, prevBg = null;
    doc.slides.forEach(function (s, i) {
      var n = i + 1, m = s.meta;
      if (m.bg && BGS.indexOf(m.bg) < 0) err(n, null, 'bg', 'unknown background `' + m.bg + '`: ' + BGS.join(', '));
      if (m.intent && INTENTS.indexOf(m.intent) < 0) err(n, null, 'intent', 'unknown intent `' + m.intent + '`: ' + INTENTS.join(', '));
      if (m.intent && m.bg && INTENTS.indexOf(m.intent) >= 0) info(n, null, 'intent-bg', 'the intent sets the background; `bg: ' + m.bg + '` is ignored');
      var bg = m.intent && INTENT_BG[m.intent] ? INTENT_BG[m.intent] : (m.bg || 'white');
      run = bg === prevBg ? run + 1 : 1; prevBg = bg;
      if (bg !== 'white' && run === 3) warn(n, null, 'same-bg', 'three consecutive slides on the ' + bg + ' background');
      if (!m.notes) info(n, null, 'no-notes', 'no speaker notes');

      var title = s.nodes.find(function (x) { return x.type === 'title'; });
      var blocks = s.nodes.filter(function (x) { return x.type === 'block'; });
      var exempt = blocks.some(function (b) { return b.name === 'statement' || b.name === 'quote' || b.name === 'section'; });
      if (!title && !exempt) err(n, null, 'no-title', 'slide without a title (except statement, quote, section)');
      if (title && title.text.length > 60) warn(n, null, 'title-length', 'title is ' + title.text.length + ' characters, 60 recommended');
      var lead = s.nodes.find(function (x) { return x.type === 'lead'; });
      if (lead && lead.text.length > 200) warn(n, null, 'lead-length', 'lead is ' + lead.text.length + ' characters, 200 recommended');
      var rights = s.nodes.filter(function (x) { return x.type === 'image' && has(x.attrs, 'right'); });
      if (rights.length > 1) err(n, null, 'one-right-image', 'only one image can sit on the right of a slide');

      // HTML in a text is shown as text — the format has no raw HTML (spec/security.md §1). Said once per slide, so `<b>` is not mistaken for formatting.
      var markup = null;
      [title && title.text, lead && lead.text, m.notes].concat(s.nodes.filter(function (x) { return x.type === 'prose' || x.type === 'block'; }).flatMap(function (x) { return x.name === 'diagram' ? x.lines.map(function (l) { return l.replace(/<br\s*\/?>/gi, ' '); }) : x.lines; }))
        .some(function (t) { var mm = t && /<\/?[a-zA-Z][^>]*>/.exec(t); if (mm) markup = mm[0]; return !!mm; });
      if (markup) info(n, null, 'literal-markup', 'the text contains HTML (`' + markup.slice(0, 20) + '`): it is shown as-is, the format has no raw HTML — use **bold**, *italic*, a new line');

      // An image inside a text — a card title, a bullet, a cell — is neither drawn nor printed (inline drops it): an image
      // stands alone on its line. Seen in the field (2026-10-12): an icon put in each card title to replace the theme's
      // marker, printed as `![](img:…)` on the slide; the marker is the block's to remove, `{.plain}`.
      var inImg = null;
      [title && title.text, lead && lead.text].concat(s.nodes.filter(function (x) { return x.type === 'prose' || (x.type === 'block' && x.name !== 'logos'); }).flatMap(function (x) { return x.lines; }))
        .some(function (t) { if (t && t.search(INLINE_IMG) >= 0 && !IMG.test(t)) inImg = t.trim(); INLINE_IMG.lastIndex = 0; return !!inImg; });
      if (inImg) err(n, null, 'inline-image', '`' + cut(inImg, 60) + '`: an image inside a text is not drawn — an image stands alone on its line, `![caption](src){.right}`; to take the theme\'s marker off cards, `::: cards {.plain}`');

      blocks.forEach(function (b) {
        var def = BLOCKS[b.name];
        if (!def) { err(n, b.name, 'unknown-block', 'block `' + b.name + '` is not in the vocabulary: ' + Object.keys(BLOCKS).join(', ')); return; }
        if (b.lines.some(function (l) { return /^:::\s*[A-Za-z]/.test(l); })) err(n, b.name, 'nested', 'nested block: only one level of `:::`');
        var count = def.count ? def.count(b) : items(b).length;
        if (def.max && count > def.max) err(n, b.name, 'max-items', count + ' items, maximum ' + def.max + ': remove an item or use another block');
        if (b.name === 'compare' && count < 2) err(n, b.name, 'two-columns', 'compare needs exactly two `###` columns');
        if (b.name === 'table') {
          var t = table(b);
          if (!t.rows.length) err(n, b.name, 'table-rows', 'a table without rows: write `| a | b |` lines, the header above a `|---|---|` line');
          if (t.width > 6) err(n, b.name, 'table-columns', t.width + ' columns, maximum 6: split the table, or keep the columns that carry the point');
          else if (tableSplit(b, t) && t.width > TABLE_SPLIT_COLS) err(n, b.name, t.rows.length > TABLE_MAX ? 'max-items' : 'table-columns', (t.rows.length > TABLE_MAX ? t.rows.length + ' rows: past ' + TABLE_MAX + ' a table folds in two, side by side, and ' : 'a `{.split}` table folds in two, side by side, and ') + 'each half holds ' + TABLE_SPLIT_COLS + ' columns at most, this one ' + t.width + ': keep the columns that carry the point, or two slides');
          if (has(b.attrs, 'split') && t.rows.length < 4) warn(n, b.name, 'table-split', '`{.split}` on ' + t.rows.length + ' rows: a fold is for a long list');
          b.attrs.classes.forEach(function (m) { if (['compact', 'split', 'right'].indexOf(m) < 0) warn(n, b.name, 'table-modifier', '`{.' + m + '}` is not a table modifier: {.compact} {.split}'); });
        }
        if (b.name === 'diagram' && diagramForm(b)) {
          var sf = diagramForm(b), sn = items(b).length, sr = DIAGRAM_FORMS[sf];
          if (sn < sr[0] || sn > sr[1]) err(n, b.name, 'max-items', 'a ' + sf + ' holds ' + (sr[0] === sr[1] ? sr[0] : sr[0] + ' to ' + sr[1]) + ' items, this one ' + sn + (sf === 'matrix' ? ': one per quadrant, top left, top right, bottom left, bottom right' : ''));
          if (/^\s*(flowchart|graph)\b/i.test(b.lines.join('\n').trim())) warn(n, b.name, 'diagram-form', '`{.' + sf + '}` draws `- title | text` items: the Mermaid lines are not read — remove the modifier to draw the flowchart');
          if (sf === 'tree' && sn >= sr[0]) {
            var tl = layout(doc), tmax = DIAGRAM_MAX[tl] || DIAGRAM_MAX.slide;
            if (sn > tmax) err(n, b.name, 'max-items', sn + ' people or boxes, maximum ' + tmax + ' on a ' + tl + ': show one branch per slide, or the levels that carry the point');
            else { var tf = diagramSvg(tree(b), diagramBox({ layout: tl }, has(b.attrs, 'right')), diagramDir({ dir: has(b.attrs, 'lr') ? 'LR' : 'TD' }, { layout: tl })); if (tf.fs * tf.scale < DIAGRAM_MIN_TYPE) err(n, b.name, 'diagram-dense', 'drawn at ' + Math.round(tf.fs * tf.scale) + ' px to fit, too small to read: fewer boxes on the widest level, shorter names, or one branch per slide'); }
          }
          if (sf === 'radial' && !shaped(b).opts.center) err(n, b.name, 'diagram-center', 'a radial hangs its items on a hub: name it with a `center:` line');
          b.attrs.classes.forEach(function (m) { if (m !== 'right' && !(m === 'lr' && sf === 'tree') && !DIAGRAM_FORMS[m]) warn(n, b.name, 'diagram-form', '`{.' + m + '}` is not a form: ' + Object.keys(DIAGRAM_FORMS).join(', ') + ' (`{.tree .lr}` left to right), or none for a Mermaid flowchart'); });
        } else if (b.name === 'diagram') {
          var dg = diagram(b), lay = layout(doc), dmax = DIAGRAM_MAX[lay] || DIAGRAM_MAX.slide;
          if (!dg.kind) err(n, b.name, 'diagram-empty', 'an empty diagram: write `flowchart TD` (or LR), then `A[Step] --> B[Next]` lines — or `- title | text` items under a form, `::: diagram {.cycle}`: ' + Object.keys(DIAGRAM_FORMS).join(', '));
          else if (dg.kind === '-') err(n, b.name, 'diagram-form', 'a list without a form: say which, `::: diagram {.cycle}` — ' + Object.keys(DIAGRAM_FORMS).join(', '));
          else if (DIAGRAM_KINDS.indexOf(dg.kind) < 0) err(n, b.name, 'diagram-type', DIAGRAM_ROUTE[dg.kind] ? 'a Mermaid `' + dg.kind + '` is drawn by ' + DIAGRAM_ROUTE[dg.kind] + ': use that block' : 'a Mermaid `' + dg.kind + '` is not drawn: only `flowchart` (or `graph`) — draw it as boxes and arrows, or bring an image');
          else {
            if (!dg.nodes.length) err(n, b.name, 'diagram-empty', 'a diagram without nodes: write `A[Step] --> B[Next]` lines under `' + dg.kind + '`');
            dg.bad.forEach(function (x) { err(n, b.name, 'diagram-syntax', 'line ' + x.line + ': `' + cut(x.text, 60) + '` is not read — write `A[Text] --> B[Text]`, a label as `-->|label|`, one statement a line'); });
            dg.refused.forEach(function (x) { err(n, b.name, 'diagram-click', 'line ' + x.line + ': `' + x.text.split(/\s+/)[0] + '` binds code to a node, and a deck is data — remove the line'); });
            var ign = dg.ignored.filter(function (w, i) { return dg.ignored.indexOf(w) === i; });
            dg.toFrame.forEach(function (x) { warn(n, b.name, 'diagram-subgraph', 'line ' + x.line + ': an arrow to the frame `' + x.frame.id + '` is not drawn — point it at a box inside the frame'); });
            ign = ign.filter(function (w) { return w !== 'direction'; });
            if (ign.length) warn(n, b.name, 'diagram-style', ign.join(', ') + ' ignored: the brand colors the diagram — `{.hero}` (or `:::hero`) is the one mark read');
            if (dg.nodes.length > dmax) err(n, b.name, 'max-items', dg.nodes.length + ' nodes, maximum ' + dmax + ' on a ' + lay + ': split the diagram over two ' + (lay === 'story' ? 'screens' : 'slides') + ', or keep the steps that carry the point');
            else if (dg.nodes.length) {
              var dctx = { layout: lay }, fit = diagramSvg(dg, diagramBox(dctx, has(b.attrs, 'right')), diagramDir(dg, dctx));
              fit.clash.forEach(function (c) { warn(n, b.name, 'diagram-subgraph', 'the frame `' + (c.frame.title || c.frame.id) + '` covers ' + (c.box ? 'the box `' + c.box.label.replace(/\n/g, ' ') + '`, which is not in it' : 'the frame `' + (c.other.title || c.other.id) + '`') + ' — link its boxes to each other, or move that box into it'); });
              if (fit.fs * fit.scale < DIAGRAM_MIN_TYPE) err(n, b.name, 'diagram-dense', 'drawn at ' + Math.round(fit.fs * fit.scale) + ' px to fit, too small to read: fewer nodes, shorter labels, or the other direction (' + (/LR|RL/.test(dg.dir) ? 'TD' : 'LR') + ')');
            }
          }
        }
        if (b.name === 'chart') {
          var c = chart(b), cmax = CHART_MAX[c.type];
          if (!c.items.length) err(n, b.name, 'chart-items', 'a chart without values: write `- label | value` lines');
          if (c.items.length > cmax) err(n, b.name, 'max-items', c.items.length + ' values, maximum ' + cmax + ' for a ' + c.type + ' chart' + (c.type === 'pie' ? ': group the small ones in one slice' : ': keep the ones that carry the point'));
          if (c.n > SERIES_MAX) err(n, b.name, 'chart-series', c.n + ' series, maximum ' + SERIES_MAX);
          if (c.type === 'pie' && c.n > 1) err(n, b.name, 'chart-series', 'a pie has one series: one value per slice');
          c.items.forEach(function (it) {
            if (!it.raw.length) err(n, b.name, 'chart-value', '`' + it.label + '` has no value: write `- ' + it.label + ' | 42`');
            it.raw.forEach(function (r, k) {
              if (it.values[k] == null && r !== '') err(n, b.name, 'chart-value', '`' + r + '` (' + it.label + ') is not a number: write the number alone, the unit once in `unit:`');
              else if (c.type === 'pie' && it.values[k] < 0) err(n, b.name, 'chart-value', 'a pie slice cannot be negative (' + it.label + '): use a bar chart');
            });
          });
          b.attrs.classes.forEach(function (m) { if (['right', 'donut'].indexOf(m) < 0 && CHART_TYPES.indexOf(m) < 0) warn(n, b.name, 'chart-type', '`{.' + m + '}` is not a chart type: ' + CHART_TYPES.join(', ') + ' (bar when none)'); });
        }
      });

      // Content that fell out of its block. A fence written with anything but three ASCII colons (`:: cards`, `:[ip 1] cards`
      // after a channel replaced the `:::`) is prose to the parser, and so are the `###` under it: the deck builds and prints
      // them as text. Seen in the field — an agent copied a mangled contract six times and the lint said clean.
      var strays = 0, fenceMark = null;
      s.nodes.forEach(function (p) { // the lead too: a mangled opener right under the title lands there
        if (p.type !== 'prose' && p.type !== 'lead') return;
        (p.type === 'lead' ? [p.text] : p.lines).forEach(function (l, k) {
          var t = l.trim(), line = p.map[0] + 1 + k;
          var mOpen = /^([^a-z0-9\s#*\-!\[`(<]\S*(?:\s+\S+)*?)\s+([a-z][\w-]*)\s*(\{[^}]*\})?$/i.exec(t);
          if (mOpen && BLOCKS[mOpen[2].toLowerCase()]) {
            strays++; fenceMark = mOpen[1];
            err(n, null, 'stray-fence', 'line ' + line + ' looks like a block opener: write `::: ' + mOpen[2].toLowerCase() + '` — three ASCII colons, nothing else before the name');
          } else if (t === ':::') {
            strays++;
            err(n, null, 'stray-fence', 'line ' + line + ': a `:::` that closes nothing — remove it, or open a block above it with `::: name`');
          } else if (t && (t === fenceMark || /^[:\s]+$/.test(t))) {
            strays++;
            err(n, null, 'stray-fence', 'line ' + line + ' looks like a block closer: write `:::` alone on its line');
          }
        });
      });
      if (!strays) {
        var loose = 0;
        s.nodes.filter(function (x) { return x.type === 'prose'; }).forEach(function (p) { p.lines.forEach(function (l) { if (/^#{1,6}\s/.test(l)) loose++; }); });
        if (loose) err(n, null, 'loose-heading', loose + ' `#` heading' + (loose > 1 ? 's' : '') + ' outside a block, printed as text: one `##` title per slide; other headings live in a block (`cards`, `compare`)');
      }
    });

    // the story: warnings on the arc, only once the deck uses intents at all
    var arc = doc.slides.map(function (s) { return INTENTS.indexOf(s.meta.intent) >= 0 ? s.meta.intent : null; });
    if (arc.some(Boolean) && doc.slides.length >= 4) {
      var N = arc.length, firstTitle = doc.slides[0].nodes.find(function (x) { return x.type === 'title'; });
      if (arc[0] !== 'hook' && !(firstTitle && firstTitle.level === 1)) warn(1, null, 'story-open', 'the deck opens without a hook (or a cover)');
      if (arc[N - 1] !== 'act' && arc[N - 1] !== 'recap') warn(N, null, 'story-close', 'the deck closes without act or recap');
      arc.forEach(function (a, i) { if (a === 'problem' && arc[i + 1] === 'problem' && arc[i + 2] !== 'reveal') warn(i + 2, null, 'story-tension', 'two problem slides in a row with no reveal after them'); });
      var counts = {}; arc.forEach(function (a) { if (a) counts[a] = (counts[a] || 0) + 1; });
      Object.keys(counts).forEach(function (a) { if (counts[a] > N / 2) warn(0, null, 'story-monotone', counts[a] + ' of ' + N + ' slides are `' + a + '`'); });
      if ((counts.fun || 0) > Math.max(1, Math.floor(N / 10))) warn(0, null, 'story-fun', counts.fun + ' fun slides in ' + N + ': one per ten is plenty');
      if ((counts.hook || 0) > 1) warn(0, null, 'story-hook', counts.hook + ' hook slides: one opens the deck');
    }

    if (ctx && ctx.assets) {
      assets(doc).forEach(function (a) {
        if (ctx.assets[a.src]) return;
        // ctx.refused (Node): why a file is not embedded — not found, outside the deck folder, not an image; never embedded silently
        if (ctx.refused && ctx.refused[a.src] && /^(img:|up:|https?:\/\/)/.test(a.src)) err(a.slide, null, 'missing-asset', ctx.refused[a.src] + ': ' + a.src);
        else if (ctx.assetsAuthoritative) err(a.slide, null, 'missing-asset', ((ctx.refused && ctx.refused[a.src]) || 'file not found') + ': ' + a.src + ' (paths are relative to the .jmd, inside its folder)');
        else warn(a.slide, null, 'asset-not-embedded', a.src + ' is not embedded in this file: build it next to its images');
      });
    }
    return out;
  }

  // Auto-fit, before the overflow is measured: a slide whose content runs a little past the limit is shown with its body
  // reduced (CSS zoom on .body-pad, the rendered width kept), down to FIT_MIN — beyond that the slide is really too full and
  // the overflow stays an error. What fits this way is a warning (`fit`): the file is made, the type is a little smaller, the
  // author is told. Why: the model writes without measuring; nine overflows out of ten are a few lines over, and a second
  // build for them is a call some hosts do not leave. A statement or a divider is one sentence: never fitted.
  var FIT_MIN = 0.85;
  /* A flowchart takes the height its slide has left (1.30.0): drawn for a fixed box, it is shrunk when the slide runs over — never
     under DIAGRAM_MIN_TYPE — and grown into the room left below, within its column and DIAGRAM_GROW. Its own size first, the
     whole slide's zoom (fit) only after. Measured in design px; the size it was drawn at is kept to start from on every pass. */
  function roomDiagrams(body, measure, limit, scale) {
    var svgs = [].slice.call(body.querySelectorAll('svg.diagram-svg[data-fs]'));
    if (!svgs.length) return;
    svgs.forEach(function (g) {
      if (!g.dataset.w) { g.dataset.w = g.getAttribute('width'); g.dataset.h = g.getAttribute('height'); }
      g.setAttribute('width', g.dataset.w); g.setAttribute('height', g.dataset.h);
    });
    var size = function (g, k) { g.setAttribute('width', (g.dataset.w * k).toFixed(1)); g.setAttribute('height', (g.dataset.h * k).toFixed(1)); };
    var floor = function (g) { return DIAGRAM_MIN_TYPE / (g.dataset.fs * g.dataset.s); }, ceil = function (g) { return DIAGRAM_GROW / g.dataset.s; };
    var bottom = measure(), tall = svgs.reduce(function (t, g) { return t + +g.dataset.h; }, 0);
    if (bottom > limit) {
      for (var pass = 0; pass < 3 && bottom > limit; pass++) { // side by side, two diagrams do not add up: measured again after each try
        var k = Math.max(0, (tall - (bottom - limit)) / tall);
        svgs.forEach(function (g) { size(g, Math.min(1, Math.max(floor(g), k * (g.getAttribute('height') / g.dataset.h)))); });
        bottom = measure();
      }
    } else if (svgs.length === 1) { // one diagram, room below: it grows into it, as wide as its column lets it
      var g = svgs[0], col = g.parentNode.getBoundingClientRect().width / scale, w = +g.dataset.w, h = +g.dataset.h;
      var grow = Math.min(1 + (limit - bottom) / h, col / w, ceil(g));
      if (grow > 1.02) { size(g, grow); if (measure() > limit) size(g, 1); }
    }
  }
  function fitOverflow(track, out, lay) {
    var page = PAGES[lay] || PAGES.slide, slides = track.querySelectorAll('.slide');
    if (!page.limit) return out;
    Array.prototype.forEach.call(slides, function (sec, i) {
      var body = sec.querySelector('.body-pad'); if (!body) return;
      body.style.zoom = ''; body.style.width = ''; sec.classList.remove('is-fit'); delete sec.dataset.fit;
      var last = body.lastElementChild; if (!last) return;
      var r0 = sec.getBoundingClientRect(), scale = r0.width / page.w;
      var measure = function () { return (last.getBoundingClientRect().bottom - r0.top) / scale; };
      roomDiagrams(body, measure, page.limit, scale);
      var rb = body.getBoundingClientRect();
      var top = (rb.top - r0.top) / scale, bottom = measure(), width = rb.width / scale;
      if (bottom <= page.limit) return;
      var s = Math.floor(((page.limit - top) / (bottom - top)) * 0.99 * 100) / 100; // a hair under, so the measure that follows is clean
      if (s < FIT_MIN) return;
      body.style.zoom = String(s); body.style.width = Math.round(width / s) + 'px';
      sec.classList.add('is-fit'); sec.dataset.fit = String(s);
      out.push({ level: 'warning', slide: i + 1, block: null, rule: 'fit', message: 'content reached ' + Math.round(bottom) + 'px, limit ' + page.limit + ': shown at ' + Math.round(s * 100) + ' % — shorten a text or remove an item to keep the type at full size' });
    });
    return out;
  }

  // The glyph's poses that depend on where things landed: `act` beside its button, `decide` behind the recommended option
  // (the `.hero` item, else the last — the rule engine.css applies). Numbers read off the DOM, never off the source; in design
  // px, so the screen's scale does not matter. Run after fitOverflow (a fitted body moves its button).
  function placeGlyphs(track, lay) {
    var page = PAGES[lay] || PAGES.slide;
    Array.prototype.forEach.call(track.querySelectorAll('.slide'), function (sec) {
      var g = sec.querySelector('.wm--mark .wm-g'); if (!g) return;
      ['--gx', '--gy', '--gs', '--gr', '--gc', '--go'].forEach(function (p) { g.style.removeProperty(p); });
      var it = sec.getAttribute('data-intent'), el, pose = null;
      var r0 = sec.getBoundingClientRect(), k = r0.width / page.w;
      var box = function (e) { var r = e.getBoundingClientRect(); return { x: (r.left - r0.left) / k, y: (r.top - r0.top) / k, w: r.width / k, h: r.height / k }; };
      if (it === 'act' && (el = sec.querySelector('a.cta'))) {
        var b = box(el); pose = { gx: b.x + b.w + 64, gy: b.y + b.h / 2, gs: 72, gr: -20, gc: 'var(--jp-yellow-500)', go: 1 };
      } else if (it === 'decide' && (el = sec.querySelector('.card.is-hero, .col.is-hero') || [].slice.call(sec.querySelectorAll('.cards > .card, .compare > .col')).pop())) {
        var d = box(el); pose = { gx: d.x + d.w / 2, gy: d.y + d.h / 2, gs: Math.min(Math.max(d.w, d.h) * 1.4, page.w * 0.6), gr: 45, gc: 'var(--brand-accent)', go: 0.24 };
      }
      if (!pose) return;
      g.style.setProperty('--gx', Math.round(pose.gx) + 'px'); g.style.setProperty('--gy', Math.round(pose.gy) + 'px');
      g.style.setProperty('--gs', Math.round(pose.gs / (parseFloat(getComputedStyle(g).getPropertyValue('--wm-k')) || 1)) + 'px');
      g.style.setProperty('--gr', pose.gr + 'deg'); g.style.setProperty('--gc', pose.gc); g.style.setProperty('--go', String(pose.go));
    });
  }

  // Overflow measured in the DOM: the last body element must stay above the bottom margin of the page (the rects are read at
  // screen scale, so the zoom that makes a Doc page A4 is already in them). A webpage has no bottom: only the boxes are checked.
  function lintOverflow(track, out, lay) {
    var page = PAGES[lay] || PAGES.slide, slides = track.querySelectorAll('.slide');
    Array.prototype.forEach.call(slides, function (sec, i) {
      var body = sec.querySelector('.body-pad, .statement, .divider');
      if (!body) return;
      var last = body.lastElementChild; if (!last) return;
      var r0 = sec.getBoundingClientRect(), r1 = last.getBoundingClientRect();
      var scale = r0.width / page.w;
      var bottom = (r1.bottom - r0.top) / scale;
      if (page.limit && bottom > page.limit) out.push({ level: 'error', slide: i + 1, block: null, rule: 'overflow', message: 'content reaches ' + Math.round(bottom) + 'px, limit ' + page.limit + ': shorten a text or remove an item' + (page.flow === 'scroll' ? ', or start a new page with `---`' : lay === 'story' ? ', or split the screen in two with `---`' : '') });
      Array.prototype.forEach.call(sec.querySelectorAll('.metric, .card, .col, .tl-step'), function (el) {
        if (el.scrollHeight > el.clientHeight + 1) out.push({ level: 'error', slide: i + 1, block: el.className.split(' ')[0], rule: 'overflow', message: 'text overflows its box (' + el.className + ')' });
      });
      Array.prototype.forEach.call(sec.querySelectorAll('.table-wrap'), function (el) {
        if (el.scrollWidth > el.clientWidth + 1) out.push({ level: 'error', slide: i + 1, block: 'table', rule: 'overflow', message: 'the table is wider than the page: fewer columns, or shorter cells' });
      });
    });
    return out;
  }

  return { VERSION: VERSION, FORMAT_MAX: FORMAT_MAX, LAYOUTS: LAYOUTS, PAGES: PAGES, layout: layout, fileName: fileName, withTitle: withTitle, parse: parse, render: render, lint: lint, fitOverflow: fitOverflow, lintOverflow: lintOverflow, placeGlyphs: placeGlyphs, FIT_MIN: FIT_MIN, assets: assets, BLOCKS: BLOCKS, BGS: BGS, INTENTS: INTENTS, INTENT_BG: INTENT_BG, INTENT_ABOUT: INTENT_ABOUT, SHAPES: SHAPES, CONTEXT_HINTS: CONTEXT_HINTS, esc: esc, inline: inline };
})();
