import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reusable components and layouts must take all user-visible text from the
 * dictionaries (Phase 9). This scans for JSX text and literal accessibility
 * attributes containing words.
 */
const ROOTS = ['src/components', 'src/app/layouts'];
const ALLOWED = [
  // Registered brand name, intentionally untranslated.
  /^Vaidyora$/,
  // Language names shown in their own script.
  /^English$/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : [];
  });
}

describe('no hardcoded UI strings in reusable components', () => {
  const root = join(import.meta.dirname, '../..');
  for (const dir of ROOTS) {
    for (const file of files(join(root, dir))) {
      it(relative(root, file), () => {
        const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        const found: string[] = [];
        for (const m of src.matchAll(/(?<!=)>\s*([A-Za-z][A-Za-z ,.'’!?&-]{2,}[A-Za-z.!?])\s*</g)) found.push(m[1]!.trim());
        for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) found.push(m[1]!);
        expect(found.filter((s) => !ALLOWED.some((re) => re.test(s)))).toEqual([]);
      });
    }
  }
});
