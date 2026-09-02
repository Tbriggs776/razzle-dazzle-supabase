#!/usr/bin/env node
/**
 * Replace hardcoded Tailwind palette colours with the design-system tokens.
 *
 *   node scripts/tokenise-colours.mjs --dry <paths...>    report, change nothing
 *   node scripts/tokenise-colours.mjs <paths...>          rewrite in place
 *
 * WHY A CODEMOD. There are ~4,100 of these across ~70 pages, and 93% of them encode
 * one of five intents: neutral, good, warn, crit, info. Hand-editing seventy files
 * means seventy chances to map `text-green-700` to something slightly different from
 * the last person's choice, which is how the inconsistency arrived in the first
 * place. One table, applied everywhere, reviewed as one diff.
 *
 * WHAT IT DELIBERATELY WILL NOT TOUCH:
 *
 * - purple / violet / teal / pink / fuchsia / cyan (~295 instances). These are not
 *   status semantics. Some are brand-adjacent, some are chart series, some are one
 *   person's decoration. They need a human deciding what each one MEANT, and a
 *   codemod that guesses would bury that decision.
 * - `bg-slate-900` and friends used as a deliberate dark chip on a light page.
 *   Mapping those to bg-foreground is usually right and occasionally very wrong.
 * - Anything inside a string that is not a className-ish context is not special-cased
 *   -- the patterns are specific enough (`text-slate-500`) that a false positive
 *   would have to be a deliberate coincidence.
 *
 * DARK VARIANTS ARE DELETED, NOT MAPPED. `dark:text-slate-300` beside
 * `text-slate-700` exists only because the light value was hardcoded. The tokens are
 * theme-aware, so the override becomes noise that will drift out of sync with the
 * value it is overriding.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((a) => a !== '--dry');

if (!files.length) {
  console.error('usage: node scripts/tokenise-colours.mjs [--dry] <files...>');
  process.exit(1);
}

// Families that map cleanly onto a semantic token.
const SEMANTIC = {
  green: 'good', emerald: 'good',
  red: 'crit', rose: 'crit',
  amber: 'warn', yellow: 'warn', orange: 'warn',
  blue: 'info', indigo: 'info', sky: 'info',
};

// Tailwind shade -> how the design system expresses that weight.
//   50/100  a soft tinted fill      -> /12
//   200/300 a hairline on that fill -> /25
//   400+    the colour itself
const rules = [];

for (const [family, token] of Object.entries(SEMANTIC)) {
  for (const shade of [50, 100]) {
    rules.push([new RegExp(`\\bbg-${family}-${shade}\\b`, 'g'), `bg-${token}/12`]);
  }
  for (const shade of [200, 300]) {
    rules.push([new RegExp(`\\bborder-${family}-${shade}\\b`, 'g'), `border-${token}/25`]);
    rules.push([new RegExp(`\\bring-${family}-${shade}\\b`, 'g'), `ring-${token}/25`]);
  }
  for (const shade of [400, 500, 600, 700, 800, 900]) {
    rules.push([new RegExp(`\\bbg-${family}-${shade}\\b`, 'g'), `bg-${token}`]);
    rules.push([new RegExp(`\\btext-${family}-${shade}\\b`, 'g'), `text-${token}`]);
    rules.push([new RegExp(`\\bborder-${family}-${shade}\\b`, 'g'), `border-${token}`]);
    rules.push([new RegExp(`\\bring-${family}-${shade}\\b`, 'g'), `ring-${token}`]);
    rules.push([new RegExp(`\\bfill-${family}-${shade}\\b`, 'g'), `fill-${token}`]);
    rules.push([new RegExp(`\\bstroke-${family}-${shade}\\b`, 'g'), `stroke-${token}`]);
  }
  // Shades 50-300 used as TEXT are still just the colour -- there is no lighter
  // token, and muted status text is a legibility bug rather than a style.
  for (const shade of [50, 100, 200, 300]) {
    rules.push([new RegExp(`\\btext-${family}-${shade}\\b`, 'g'), `text-${token}`]);
  }
}

// Neutrals. slate/gray/zinc/neutral/stone all mean "not a status colour".
for (const family of ['slate', 'gray', 'zinc', 'neutral', 'stone']) {
  // Body text vs secondary text. 600 is the boundary the codebase actually uses:
  // 700/800/900 are headings and values, 300/400/500 are labels and captions.
  for (const shade of [700, 800, 900]) {
    rules.push([new RegExp(`\\btext-${family}-${shade}\\b`, 'g'), 'text-foreground']);
  }
  for (const shade of [300, 400, 500, 600]) {
    rules.push([new RegExp(`\\btext-${family}-${shade}\\b`, 'g'), 'text-muted-foreground']);
  }
  for (const shade of [100, 200, 300, 400]) {
    rules.push([new RegExp(`\\bborder-${family}-${shade}\\b`, 'g'), 'border-border']);
    rules.push([new RegExp(`\\bdivide-${family}-${shade}\\b`, 'g'), 'divide-border']);
  }
  for (const shade of [50, 100, 200]) {
    rules.push([new RegExp(`\\bbg-${family}-${shade}\\b`, 'g'), 'bg-muted']);
  }
}

// Strip dark: overrides of anything we just tokenised -- run AFTER the rules above
// so the override's own colour has already been rewritten to a token, making these
// trivially identifiable as `dark:` + a token we now apply in both themes.
const DARK_STRIP = /\s*dark:(bg|text|border|ring|fill|stroke|divide)-(good|warn|crit|info|foreground|muted-foreground|muted|border)(\/\d+)?\b/g;

let totalFiles = 0;
let totalSubs = 0;
const leftovers = new Map();

for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const before = src;
  let subs = 0;

  for (const [re, to] of rules) {
    src = src.replace(re, () => { subs++; return to; });
  }
  src = src.replace(DARK_STRIP, () => { subs++; return ''; });

  // Report what a human still has to look at.
  for (const m of src.matchAll(/\b(?:bg|text|border|ring|fill|stroke|divide)-(purple|violet|teal|pink|fuchsia|cyan|lime)-\d{2,3}\b/g)) {
    leftovers.set(m[0], (leftovers.get(m[0]) ?? 0) + 1);
  }

  if (src !== before) {
    totalFiles++;
    totalSubs += subs;
    if (!DRY) writeFileSync(file, src, 'utf8');
    console.log(`${String(subs).padStart(4)}  ${file}`);
  }
}

console.log(`\n${DRY ? '[dry run] ' : ''}${totalSubs} substitutions across ${totalFiles} files`);
if (leftovers.size) {
  console.log('\nLeft for a human (not status semantics):');
  for (const [k, v] of [...leftovers].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
}
