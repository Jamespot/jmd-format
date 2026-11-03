/* The two suites (tools/test.mjs, mcp/test.mjs) listen on fixed ports (8789–8811) and drive a Chrome each: run from two
   worktrees at once, they answer each other's requests or die on EADDRINUSE, and the failure names a test that has nothing
   to do with it. So a suite waits its turn on this machine: a lock directory under /tmp that names its holder, released when
   the process exits, taken over when the holder is gone (a run killed with ^C leaves its directory behind, never the wait). */
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const LOCK = join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'jmd-tests.lock'); // /tmp, not $TMPDIR: each session may have its own
const HOLDER = join(LOCK, 'holder.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const read = () => { try { return JSON.parse(readFileSync(HOLDER, 'utf8')); } catch { return null; } };

export async function waitMyTurn(suite) {
  const me = `${basename(process.cwd().replace(/\/mcp$/, ''))} · ${suite}`;
  let told = false;
  for (;;) {
    try { mkdirSync(LOCK); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const h = read();
    // a holder that died, or a directory left without its file (a crash between the two writes) for more than 30 s
    if (h ? !alive(h.pid) : Date.now() - (statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 30_000) {
      rmSync(LOCK, { recursive: true, force: true }); continue;
    }
    if (!told) { console.log(`⏳ ${h ? h.who : 'another run'} holds the test ports: waiting for it (lock: ${LOCK})`); told = true; }
    await new Promise(r => setTimeout(r, 2000));
  }
  writeFileSync(HOLDER, JSON.stringify({ pid: process.pid, who: me, since: new Date().toISOString() }));
  process.on('exit', () => { if (read()?.pid === process.pid) rmSync(LOCK, { recursive: true, force: true }); });
}
