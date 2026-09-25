/* jmd core — parser, blocks, string renderer, linter. Shared by the browser runtime and Node (CLI, MCP).
   Plain script: no import/export, it defines globalThis.JMD. Zero dependencies.
   Every node keeps its source line range (map) for V2 in-place editing. */
globalThis.JMD = (function () {
  'use strict';

  var VERSION = '1.5.0';
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
  function layout(doc) { var l = doc && doc.meta && doc.meta.layout; return PAGES[l] ? l : 'slide'; }

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
  function inline(s) {
    return esc(s)
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
    var nodes = [], L = slide.lines, base = slide.bodyStart || 0;
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
      render: function (b) {
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
    statement: {
      full: true,
      render: function (b) {
        var paras = [], attr = null, paraLine = null, attrLine = null;
        b.lines.forEach(function (l, k) {
          if (!l.trim()) return;
          if (/^—\s/.test(l)) { attr = l.replace(/^—\s*/, ''); attrLine = b.map[0] + 1 + k; return; }
          paras.push(l.trim()); if (paraLine == null) paraLine = b.map[0] + 1 + k;
        });
        return '<svg class="mark-blob mark-blob--statement" aria-hidden="true"><use href="#brand-mark"/></svg>' +
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
    // the watermark: a brand feature, never on a slide that has its own decoration
    var wm = ctx.brand.watermark || 'mark', decorated = full || right || cover;
    var watermark = wm === 'none' || decorated ? ''
      : '<div class="wm wm--' + esc(wm) + ' wm--' + (idx % 2 ? 'b' : 'a') + '" aria-hidden="true">' + (wm === 'mark' ? '<svg><use href="#' + (+ctx.brand.glyphs ? 'brand-glyph-' + (idx % 2 ? 2 : 1) : 'brand-mark') + '"/></svg>' : '') + '</div>';
    return '<section class="' + classes.join(' ') + '"' + notes + (intent ? ' data-intent="' + intent + '"' : '') + ' data-start="' + slide.map[0] + '">' + watermark + chrome + inner + tag + '</section>';
  }

  function render(doc, ctx) {
    ctx_lines_cache = doc.lines || null;
    var c = { brand: (ctx && ctx.brand) || {}, assets: (ctx && ctx.assets) || {}, section: doc.meta.section || '', sectionCount: 0, layout: layout(doc), total: doc.slides.length, title: doc.meta.title || '' };
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
    { name: 'timeline', hint: '- date — title | text · 6 max · {.now} {.next} on an item · {.chevrons} on the block', snippet: '::: timeline\n- 2024 — Step one | What happened.\n- 2025 — Step two | What happened. {.now}\n:::' },
    { name: 'cards', hint: '- title | text, or ### Title + bullets · 5 max (3 with a lead, ≤ 3 short bullets each) · {.numbered} {.right} on the block · {.wide} on a card', snippet: '::: cards\n- Title | One line of text.\n- Title | One line of text.\n- Title | One line of text.\n:::' },
    { name: 'compare', hint: '### Left + bullets, ### Right + bullets · 2 columns, ≤ 4 one-line bullets each · {.light}', snippet: '::: compare\n### Before\n- One point.\n- Another.\n\n### After\n- One point.\n- Another.\n:::' },
    { name: 'statement', hint: 'one sentence, alone on the slide · optional — attribution line', snippet: '::: statement\nOne sentence that carries the slide.\n— Who said it\n:::' },
    { name: 'section', hint: 'a divider: the part title · {.numbered}', snippet: '::: section\nPart title\n:::' },
    { name: 'pills', hint: '- word · 8 max', snippet: '::: pills\n- One\n- Two\n- Three\n:::' },
    { name: 'logos', hint: '- ![Name](file) · 40 max', snippet: '::: logos\n- ![Acme](assets/logo-acme.svg)\n- ![Globex](assets/logo-globex.svg)\n:::' },
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
      [title && title.text, lead && lead.text, m.notes].concat(s.nodes.filter(function (x) { return x.type === 'prose' || x.type === 'block'; }).flatMap(function (x) { return x.lines; }))
        .some(function (t) { var mm = t && /<\/?[a-zA-Z][^>]*>/.exec(t); if (mm) markup = mm[0]; return !!mm; });
      if (markup) info(n, null, 'literal-markup', 'the text contains HTML (`' + markup.slice(0, 20) + '`): it is shown as-is, the format has no raw HTML — use **bold**, *italic*, a new line');

      blocks.forEach(function (b) {
        var def = BLOCKS[b.name];
        if (!def) { err(n, b.name, 'unknown-block', 'block `' + b.name + '` is not in the vocabulary: ' + Object.keys(BLOCKS).join(', ')); return; }
        if (b.lines.some(function (l) { return /^:::\s*[A-Za-z]/.test(l); })) err(n, b.name, 'nested', 'nested block: only one level of `:::`');
        var count = def.count ? def.count(b) : items(b).length;
        if (def.max && count > def.max) err(n, b.name, 'max-items', count + ' items, maximum ' + def.max + ': remove an item or use another block');
        if (b.name === 'compare' && count < 2) err(n, b.name, 'two-columns', 'compare needs exactly two `###` columns');
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
  function fitOverflow(track, out, lay) {
    var page = PAGES[lay] || PAGES.slide, slides = track.querySelectorAll('.slide');
    if (!page.limit) return out;
    Array.prototype.forEach.call(slides, function (sec, i) {
      var body = sec.querySelector('.body-pad'); if (!body) return;
      body.style.zoom = ''; body.style.width = ''; sec.classList.remove('is-fit'); delete sec.dataset.fit;
      var last = body.lastElementChild; if (!last) return;
      var r0 = sec.getBoundingClientRect(), rb = body.getBoundingClientRect(), r1 = last.getBoundingClientRect();
      var scale = r0.width / page.w;
      var top = (rb.top - r0.top) / scale, bottom = (r1.bottom - r0.top) / scale, width = rb.width / scale;
      if (bottom <= page.limit) return;
      var s = Math.floor(((page.limit - top) / (bottom - top)) * 0.99 * 100) / 100; // a hair under, so the measure that follows is clean
      if (s < FIT_MIN) return;
      body.style.zoom = String(s); body.style.width = Math.round(width / s) + 'px';
      sec.classList.add('is-fit'); sec.dataset.fit = String(s);
      out.push({ level: 'warning', slide: i + 1, block: null, rule: 'fit', message: 'content reached ' + Math.round(bottom) + 'px, limit ' + page.limit + ': shown at ' + Math.round(s * 100) + ' % — shorten a text or remove an item to keep the type at full size' });
    });
    return out;
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
    });
    return out;
  }

  return { VERSION: VERSION, FORMAT_MAX: FORMAT_MAX, LAYOUTS: LAYOUTS, PAGES: PAGES, layout: layout, parse: parse, render: render, lint: lint, fitOverflow: fitOverflow, lintOverflow: lintOverflow, FIT_MIN: FIT_MIN, assets: assets, BLOCKS: BLOCKS, BGS: BGS, INTENTS: INTENTS, INTENT_BG: INTENT_BG, INTENT_ABOUT: INTENT_ABOUT, SHAPES: SHAPES, CONTEXT_HINTS: CONTEXT_HINTS, esc: esc, inline: inline };
})();
