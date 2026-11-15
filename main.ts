// SANDLINE entry program (Node 22, standard library only). It hands the game
// in: copies game/ and screenshots/ from beside this file into the output
// directory and writes dossier.json, the summary the judge reads, with the
// vendored make.fun library (vendor/makefun-threejs.ts, unchanged).
//
// The grader runs this twice from / and requires both runs to write the same
// bytes, so the output directory is wiped before each copy and every path is
// resolved from this file's location, with the working directory as a
// fallback. Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { Buffer } from 'node:buffer';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's own caps (competition gate): only text_max_bytes shapes the
// dossier bytes; the others refuse an entry the scorer would refuse — more
// than 4 screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function sourceDir() {
  const beside = fileURLToPath(new URL('.', import.meta.url));
  if (existsSync(join(beside, 'game'))) return beside;
  if (existsSync(join(process.cwd(), 'game'))) return process.cwd();
  throw new Error('SANDLINE: game/ not found beside main.ts or in the working directory');
}

const src = sourceDir();
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Wipe first: a stale file from an earlier run would break the grader's
// byte-equality check between its two runs of this program.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(src, 'screenshots'))) {
  cpSync(join(src, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, CAPS));

// Self-check the determinism the grader requires: building the dossier again
// from the same output must produce the same bytes, or the entry is refused.
// buildDossier returns a Uint8Array, so compare bytes, not a string to bytes.
if (Buffer.compare(readFileSync(join(out, 'dossier.json')), Buffer.from(buildDossier(out, CAPS))) !== 0) {
  throw new Error('SANDLINE: dossier.json is not deterministic across builds');
}
