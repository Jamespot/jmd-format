#!/usr/bin/env node
/* jmd — command line for the .jmd format.
   jmd lint   <file.jmd> [--dom] [--json] [--brand x]   static rules; --dom adds the overflow check in headless Chrome; exit 1 on error
   jmd build  <file.jmd> [-o out.html] [--brand x]
   jmd pdf    <file.jmd> [-o out.pdf]  [--brand x]
   jmd render <file.jmd> [-o dir]      [--brand x] [--scale 2]     one PNG per slide
   jmd render <file.jmd> --sheet [-o out.png]                       one contact sheet of every slide
   jmd open   [file.jmd]                                            build to a temp file and open it in the default browser (no file: the empty runtime)
   jmd import <deck.pptx> [-o dir] [--brand x] [--lang fr]          a draft .jmd + media/ + brand-draft.yaml + import-report.md (stage 1, mechanical)
   jmd restructure <import-dir> [--brand x] [--model m]             stage 2: the local agent rewrites the draft into blocks (ANTHROPIC_API_KEY)
   jmd images <query…> [--brand x] [--kind photo]                   search the brand's image banks: img:<bank>/<slug>, caption, tags (spec/images.md)
   jmd vendor <file.jmd> [--brand x]                                copy the deck's bank images next to it and rewrite the references to local paths
   jmd spec   [agents|jmd]                                          print the contract / the grammar
   jmd stats | reindex | sweep                                      the store (spec/espace.md §2): what there is and what happened / remake the base
                                                                    from S3 / archive, aggregate, purge — needs the store's variables (make stats-staging) */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import * as jmd from '../lib/jmd.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '-o' || rest[i] === '--brand' || rest[i] === '--scale' || rest[i] === '--lang' || rest[i] === '--kind') flags[rest[i].replace(/^-+/, '')] = rest[++i];
  else if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = true;
  else pos.push(rest[i]);
}
const file = pos[0];
const opts = { brand: flags.brand || null }; // null → the deck's own `brand:`, else jamespot
// a brand is an id, a .yaml path, the YAML text, or an https URL (also in the deck's frontmatter) — resolved once here
if (['lint', 'build', 'pdf', 'render', 'open', 'images', 'vendor'].includes(cmd)) {
  try { opts.brand = await jmd.resolveBrand(opts.brand, file && existsSync(file) ? readFileSync(file, 'utf8') : ''); }
  catch (e) { console.error('brand: ' + e.message); process.exit(2); }
}
const src = () => { if (!file) { console.error('missing <file.jmd>'); process.exit(2); } opts.name = basename(file); opts.dir = dirname(file); return readFileSync(file, 'utf8'); };
const slug = () => basename(file).replace(/\.jmd$/, '');

switch (cmd) {
  case 'lint': {
    const r = flags.dom ? await jmd.lintDom(src(), opts) : jmd.lint(src(), { ...opts, images: await jmd.bankImages(src(), opts.brand) });
    jmd.closeBrowser();
    if (flags.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const f of r.findings) console.log(`${f.level === 'error' ? '✗' : f.level === 'info' ? '·' : '!'} slide ${f.slide}${f.block ? ' · ' + f.block : ''} · ${f.rule}: ${f.message}`);
      console.log(`${r.ok ? '✓' : '✗'} ${r.slides} slides, ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}${flags.dom ? '' : ' (static rules only; add --dom for overflow)'}`);
    }
    process.exit(r.ok ? 0 : 1);
  }
  case 'build': {
    const out = flags.o || `${slug()}.james-jmd.html`;
    writeFileSync(out, await jmd.build(src(), opts)); console.log(out); break;
  }
  case 'pdf': {
    const out = flags.o || `${slug()}.pdf`;
    writeFileSync(out, await jmd.pdf(src(), opts)); console.log(out); jmd.closeBrowser(); break;
  }
  case 'render': {
    if (flags.sheet) {
      const out = flags.o || `${slug()}-sheet.png`;
      writeFileSync(out, await jmd.render(src(), { ...opts, scale: +(flags.scale || 1 / 3), sheet: true }));
      console.log(out); jmd.closeBrowser(); break;
    }
    const dir = flags.o || `${slug()}-slides`; mkdirSync(dir, { recursive: true });
    const pngs = await jmd.render(src(), { ...opts, scale: +(flags.scale || 1) });
    pngs.forEach((b, i) => writeFileSync(join(dir, `slide-${String(i + 1).padStart(2, '0')}.png`), b));
    console.log(`${dir}/ — ${pngs.length} slides`); jmd.closeBrowser(); break;
  }
  case 'images': {
    const { hits, errors } = await jmd.imageSearch(opts.brand, pos.join(' '), { kind: flags.kind || null, limit: +(flags.limit || 12) });
    for (const e of errors) console.error(`bank ${e.bank}: ${e.error}`);
    if (!hits.length) { console.log('nothing found' + (Object.keys(opts.brand.banks || {}).length ? '' : ' — this brand declares no image bank (images: in its brand.yaml)')); break; }
    for (const h of hits) console.log(`${h.ref}\n  ${h.caption}\n  ${h.kind} · fit ${h.fit.join(', ')} · ${h.tags.slice(0, 8).join(', ')}${h.status !== 'approved' ? ' · ' + h.status : ''}\n  ${h.url}`);
    break;
  }
  case 'vendor': {
    const text = src(); const { jmd: out, written, refused } = await jmd.vendor(text, opts.brand, dirname(file));
    for (const [ref, why] of Object.entries(refused)) console.error(`${ref}: ${why}`);
    if (written.length) { writeFileSync(file, out); console.log(`${file} — ${written.length} image${written.length > 1 ? 's' : ''} copied next to it:\n  ${written.join('\n  ')}`); } else console.log('nothing to vendor: no resolvable img: reference');
    process.exit(Object.keys(refused).length ? 1 : 0);
  }
  case 'open': {
    const dir = mkdtempSync(join(tmpdir(), 'jmd-open-'));
    const out = join(dir, file ? `${slug()}.james-jmd.html` : 'james-jmd.html');
    writeFileSync(out, await jmd.build(file ? src() : '', file ? opts : { brand: opts.brand, name: '' }));
    const cmd = process.platform === 'darwin' ? ['open', [out]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', out]] : ['xdg-open', [out]];
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
    console.log(out); break;
  }
  case 'import': {
    if (!file) { console.error('missing <deck.pptx>'); process.exit(2); }
    const { importPptx } = await import('../lib/import-pptx.mjs');
    const dir = flags.o || basename(file).replace(/\.pptx$/i, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const r = await importPptx(file, dir, { brand: flags.brand || undefined, lang: flags.lang || undefined });
    console.log(`${r.jmd}\n${r.slides} slides, ${r.images} images (${r.skipped} decorations skipped) → ${dir}/media/, brand-draft.yaml, import-report.md`);
    break;
  }
  case 'restructure': {
    // stage 2 without a chat client: the local agent (mcp/agent.mjs, needs ANTHROPIC_API_KEY and `npm install` in mcp/)
    const dir = file ? resolve(file) : null;
    if (!dir) { console.error('missing <import-dir>'); process.exit(2); }
    process.env.JMD_OUT_DIR ||= dir; // the build lands next to the draft (read when the tools load)
    let agent, server;
    try { agent = await import('../mcp/agent.mjs'); server = await import('../mcp/server.mjs'); }
    catch (e) { console.error('jmd restructure needs the MCP package installed: cd mcp && npm install  (' + (e.message || e).split('\n')[0] + ')'); process.exit(2); }
    if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }
    const r = await agent.run({ task: server.restructureTask(dir, flags.brand || undefined), model: flags.model || undefined, tools: ['jmd_spec', 'jmd_draft', 'jmd_lint', 'jmd_build'],
      onEvent: c => console.error(`  ${c.tool} ${c.ms} ms${c.lint ? ` → ${c.lint.errors} error${c.lint.errors === 1 ? '' : 's'}, ${c.lint.warnings} warning${c.lint.warnings === 1 ? '' : 's'}${c.lint.rules.length ? ' (' + c.lint.rules.join(' ') + ')' : ''}` : ''}${c.isError ? ' ✗' : ''}`) });
    if (r.jmd) { const out = join(dir, basename(dir) + '.v2.jmd'); writeFileSync(out, r.jmd); console.log(out); }
    if (r.path) console.log(r.path);
    console.log(`${r.calls.length} calls, ${r.turns} turns, ${r.seconds.toFixed(0)} s, ${r.usage.input + r.usage.output} tokens (${r.model}), stopped: ${r.stopped}`);
    if (!r.path) { console.error('no deck was built'); process.exit(1); }
    break;
  }
  case 'spec': process.stdout.write(jmd.spec(pos[0] || 'agents')); break;
  /* The machine clients (spec/espace.md §6): a Jamespot platform that will call the four routes from its own servers.
     A command and not a page — the doctrine says no admin page, and an operator holding the store's variables is the only
     person who should be minting these. The secret is shown once, here, and kept only as a digest: losing it means making
     another client, which is the behaviour we want from a secret. */
  case 'client': {
    let openStore; // the store belongs to the hosted service; this tree may ship without it (PUBLIC.md)
    try { ({ openStore } = await import('../mcp/store.mjs')); }
    catch { console.error('this command needs the hosted service: it reads the deck store, which is not part of the format.'); process.exit(2); }
    const { randomBytes, createHash } = await import('node:crypto');
    const st = await openStore();
    if (!st) { console.error('no store: set the store\'s variables (make stats-staging does), or JMD_STORE=memory'); process.exit(2); }
    const verb = pos[0] || 'list';
    try {
      if (verb === 'add') {
        const platform = String(pos[1] || '').toLowerCase();
        if (!/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(platform)) { console.error('jmd client add <platform> — a hostname, such as acme.jamespot.pro'); process.exit(2); }
        const client_id = 'jmd-' + randomBytes(9).toString('base64url'), secret = randomBytes(32).toString('base64url');
        await st.machineClientPut({ client_id, secret_hash: createHash('sha256').update(secret).digest('base64url'), label: flags.label || platform, platform, by: process.env.USER || null });
        console.log(`client_id     ${client_id}\nclient_secret ${secret}\nplatform      ${platform}\n\nShown once. The platform asks for a token with it:\n  curl -u '${client_id}:<secret>' -d grant_type=client_credentials <base>/oauth/token`);
      } else if (verb === 'revoke') {
        const gone = await st.machineClientRevoke(String(pos[1] || ''));
        if (!gone) { console.error('no client with this id, or it was revoked already'); process.exit(1); }
        console.log(`revoked ${gone.client_id} (${gone.platform})`);
      } else {
        const rows = await st.machineClients();
        if (!rows.length) { console.log('no machine client yet — jmd client add <platform>'); break; }
        console.log('client_id                 platform                       created     last used   state');
        for (const r of rows) console.log(`${String(r.client_id).padEnd(26)}${String(r.platform).padEnd(31)}${String(r.created_at).slice(0, 10)}  ${r.used_at ? String(r.used_at).slice(0, 10) : '—         '}  ${r.revoked_at ? 'revoked ' + String(r.revoked_at).slice(0, 10) : 'active'}`);
      }
    } finally { await st.close(); }
    break;
  }
  case 'stats': case 'reindex': case 'sweep': {
    let openStore; // the store belongs to the hosted service; this tree may ship without it (PUBLIC.md)
    try { ({ openStore } = await import('../mcp/store.mjs')); }
    catch { console.error('this command needs the hosted service: it reads the deck store, which is not part of the format.'); process.exit(2); }
    const st = await openStore();
    if (!st) { console.error('no store: set CELLAR_ADDON_HOST / KEY_ID / KEY_SECRET, JMD_BUCKET and POSTGRESQL_ADDON_URI (make stats-staging does), or JMD_STORE=memory'); process.exit(2); }
    try {
      if (cmd === 'reindex') console.log(`${await st.reindex()} decks indexed from ${st.kind}`);
      else if (cmd === 'sweep') console.log(JSON.stringify(await st.sweep(), null, 1));
      else {
        const x = await st.stats(), pad = (v, n) => String(v ?? '').padEnd(n), num = (v, n = 6) => String(v ?? 0).padStart(n);
        if (flags.json) { console.log(JSON.stringify(x, null, 2)); break; }
        console.log(`jmd stats — ${st.kind}, ${new Date().toISOString().slice(0, 16)}\n`);
        console.log('decks                 status    layout    platform'); for (const r of x.decks) console.log(`${num(r.n)}                ${pad(r.status, 10)}${pad(r.layout, 10)}${r.platform}`);
        console.log('\ncalls, 7 days (and the 7 before)    tool              client'); for (const r of x.calls) console.log(`${num(r.this_week)} (${num(r.last_week, 4)})                    ${pad(r.tool, 18)}${r.client}`);
        const c = x.clean_builds, q = x.ratios;
        console.log(`\nclean at first lint: ${c.clean}/${c.total}${c.total ? ' (' + Math.round(100 * c.clean / c.total) + ' %)' : ''}   lint before build: ${q.lints}/${q.builds}   renders per build: ${q.renders}/${q.builds}   spec calls: ${q.specs}`);
        console.log('\nlint rules, 7 days'); for (const r of x.lint_rules) console.log(`${num(r.n)}  ${r.rule}`);
        console.log('\narchiving within 15 days'); for (const r of x.archiving_soon) console.log(`  ${r.id}  ${pad(r.title, 40)} ${r.platform}  last visit ${String(r.touched_at).slice(0, 10)}`); if (!x.archiving_soon.length) console.log('  none');
        console.log('\nby month                 platform             layout    metric'); for (const r of x.monthly) console.log(`${num(r.value)}  ${String(r.month).slice(0, 7)}   ${pad(r.platform, 20)} ${pad(r.layout, 10)}${r.metric}`);
      }
    } finally { await st.close(); }
    break;
  }
  default:
    console.log(`jmd ${jmd.VERSION} — format ${jmd.FORMAT}\n\n  jmd lint   <file.jmd> [--dom] [--json] [--brand x]\n  jmd build  <file.jmd> [-o out.html] [--brand x]\n  jmd pdf    <file.jmd> [-o out.pdf]\n  jmd render <file.jmd> [-o dir] [--scale 2] | --sheet [-o out.png]\n  jmd open   [file.jmd]\n  jmd import <deck.pptx> [-o dir] [--brand x]\n  jmd restructure <import-dir> [--brand x] [--model m]\n  jmd spec   [agents|jmd]\n  jmd stats [--json] | reindex | sweep   (the store: needs its variables, see make stats-staging)\n  jmd client add <platform> [--label x] | list | revoke <client_id>   (the machines that call the platform API)`);
    process.exit(cmd ? 2 : 0);
}
