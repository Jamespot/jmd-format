/* Minimal headless-Chrome driver over the DevTools protocol — node's native WebSocket, zero dependencies.
   Used by the test suite, the CLI (overflow lint, screenshots, PDF) and the MCP server. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readlinkSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, constants as osConstants } from 'node:os';

export const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'));

/* The browser renders hostile content (spec/security.md §3): no extensions, no plugins, no remote fonts, no background traffic.
   `--no-sandbox` only where Chromium's sandbox cannot run — as root, or in a container whose seccomp profile refuses user namespaces
   (CHROME_NO_SANDBOX=1, set by mcp/Dockerfile); on a workstation the sandbox stays on. */
const HARDENING = ['--disable-extensions', '--disable-plugins', '--no-remote-fonts', '--disable-background-networking', '--disable-sync', '--disable-default-apps', '--disable-component-update', '--no-pings', '--disable-features=Translate,OptimizationHints,MediaRouter', '--noerrdialogs'];
const noSandbox = () => process.env.CHROME_NO_SANDBOX === '1' || (typeof process.getuid === 'function' && process.getuid() === 0);
/** Everything a page may not reach: every scheme but the deck's own file:// and data:. */
export const BLOCKED_URLS = ['http://*', 'https://*', 'ws://*', 'wss://*', 'ftp://*', 'blob:*', 'filesystem:*'];

/* A headless Chrome outlives the node that spawned it. Every browser this process launched is closed when the process
   ends — on 'exit', and on the signals that end it without one: SIGTERM from Claude Code or Claude Desktop closing an
   MCP server, Ctrl-C on the CLI. Node quits on those without running 'exit' handlers; left alone, each session leaves a
   Chrome behind, reparented to init, until the desktop browser cannot open a tab any more. */
const live = new Set();
let hooked = false;
function hook() {
  if (hooked) return; hooked = true;
  process.on('exit', () => { for (const b of live) b.close(); });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => {
    for (const b of live) b.close();
    // nobody else handles the signal: quit as node would have (the HTTP server has its own graceful stop and exits itself)
    if (process.listenerCount(sig) === 1) process.exit(128 + osConstants.signals[sig]);
  });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function parentOf(pid) {
  try {
    if (process.platform === 'linux') return +readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ')[1];
    if (process.platform !== 'win32') return +execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
  } catch { }
  return null;
}
/** What earlier runs left in the temp dir, cleared before a launch: the profile of a Chrome that is gone (close() removes it,
    but Chrome rewrites a few files while it shuts down, and a killed parent removed nothing), and a Chrome still running
    with no parent — its node died by signal — which is ended here. A profile with no lock yet may be a launch in progress
    in another process: it stays for a minute. Never from PID 1 (a container without init): there every child looks orphaned. */
export function sweep() {
  let names = []; try { names = readdirSync(tmpdir()).filter(n => n.startsWith('jmd-chrome-')); } catch { return; }
  for (const n of names) {
    const dir = join(tmpdir(), n);
    if ([...live].some(b => b.profile === dir)) continue;
    let pid = 0; try { pid = +readlinkSync(join(dir, 'SingletonLock')).split('-').pop(); } catch { }
    if (pid && alive(pid)) {
      if (process.pid === 1 || parentOf(pid) !== 1) continue;
      try { process.kill(pid); } catch { }
    } else if (!pid) { try { if (Date.now() - statSync(dir).mtimeMs < 60_000) continue; } catch { continue; } }
    try { rmSync(dir, { recursive: true, force: true }); } catch { }
  }
}

export class Browser {
  static async launch({ port = 0 } = {}) {
    hook(); sweep();
    const b = new Browser();
    b.profile = mkdtempSync(join(tmpdir(), 'jmd-chrome-'));
    b.proc = spawn(CHROME, ['--headless=new', '--disable-gpu', ...(noSandbox() ? ['--no-sandbox'] : []), ...HARDENING, `--remote-debugging-port=${port}`, `--user-data-dir=${b.profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    live.add(b);
    try {
      b.port = await new Promise((res, rej) => {
        let buf = '';
        b.proc.stderr.on('data', d => { buf += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)/.exec(buf); if (m) res(+m[1]); });
        b.proc.on('exit', () => rej(new Error('Chrome exited — is it installed? Set CHROME to its path.')));
        setTimeout(() => rej(new Error('Chrome did not start')), 15000).unref();
      });
    } catch (e) { b.close(); throw e; }
    return b;
  }
  /** A new tab on `url`. `network: false` — the page reaches nothing but file:// and data: (the deck is self-contained by design):
      the tab opens blank, the block is set, then it navigates, so the block covers the document's own loads too. */
  async page(url, { network = true } = {}) {
    const t = await (await fetch(`http://127.0.0.1:${this.port}/json/new?${network ? url : 'about:blank'}`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise(res => ws.addEventListener('open', res));
    const p = new Page(ws, t.id, this.port);
    await p.send('Page.enable'); await p.send('Runtime.enable');
    if (!network) { await p.send('Network.enable'); await p.send('Network.setBlockedURLs', { urls: BLOCKED_URLS }); await p.navigate(url); }
    return p;
  }
  /** End Chrome and remove its profile — once Chrome has left it (it writes there while it shuts down); when the process is
      itself exiting that event never comes, and the next launch's sweep removes the folder. */
  close() {
    live.delete(this);
    const rm = () => { try { rmSync(this.profile, { recursive: true, force: true }); } catch { } };
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return rm();
    this.proc.once('exit', rm);
    try { this.proc.kill(); } catch { rm(); }
  }
}

export class Page {
  constructor(ws, targetId, port) {
    this.ws = ws; this.targetId = targetId; this.port = port; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method && this.listeners.has(m.method)) for (const fn of this.listeners.get(m.method)) fn(m.params);
    });
  }
  /** subscribe to a CDP event (after the matching `.enable`) */
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  /** navigate this tab and wait for its load event — open on about:blank first to catch what happens at load (console, CSP reports) */
  async navigate(url) {
    const loaded = new Promise(r => this.on('Page.loadEventFired', r));
    await this.send('Page.navigate', { url }); await loaded;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluation error');
    return r.result.value;
  }
  /** wait for fonts and a layout pass */
  settle(ms = 150) { return this.eval(`document.fonts.ready.then(() => new Promise(r => setTimeout(r, ${ms})))`); }
  /** a real mouse click at viewport coordinates (count 2 = double-click) */
  async mouse(x, y, count = 1) {
    for (let c = 1; c <= count; c++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: c });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: c });
    }
  }
  key(key) { return this.eval(`document.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, bubbles: true})); true`); }
  /** PNG screenshot of the viewport, as a Buffer — or of `clip` {x, y, width, height} in CSS px (scale: device pixels per CSS px) */
  async screenshot(clip) { return Buffer.from((await this.send('Page.captureScreenshot', clip ? { format: 'png', clip: { scale: 1, ...clip }, captureBeyondViewport: true } : { format: 'png' })).data, 'base64'); }
  /** PDF of the page, honoring @page, as a Buffer */
  async pdf() { return Buffer.from((await this.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 })).data, 'base64'); }
  async close() { try { await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`); } catch { } this.ws.close(); }
}
