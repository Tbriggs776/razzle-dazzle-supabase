/**
 * Lets plain `node` scripts import app modules that use the `@/` alias.
 *
 * Vite resolves `@/` to src/ at build time; node knows nothing about it, so a
 * verification script importing anything under src/ that touches the alias dies
 * with ERR_MODULE_NOT_FOUND. Rather than duplicating app logic into the script
 * (which would test the copy, not the code that ships), this teaches node the
 * same mapping.
 *
 * Usage:  node --import ./scripts/alias-loader.mjs scripts/whatever.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-resolver.mjs', pathToFileURL('./scripts/'));
