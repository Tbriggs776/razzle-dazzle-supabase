import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

/** Mirrors the `@` -> ./src alias in vite.config.js. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = resolvePath(process.cwd(), 'src', specifier.slice(2));
    // Let node try the bare path first, then the usual extensions, so both
    // '@/utils' (a directory with index.ts) and '@/lib/ops/openJob' work.
    // .ts included because parts of src/ are TypeScript (src/utils/index.ts);
    // node strips erasable types natively, so these load without a build step.
    for (const candidate of [target, `${target}.js`, `${target}.mjs`, `${target}.ts`,
                             `${target}/index.js`, `${target}/index.mjs`, `${target}/index.ts`]) {
      try {
        return await nextResolve(pathToFileURL(candidate).href, context);
      } catch { /* try the next shape */ }
    }
  }
  return nextResolve(specifier, context);
}
