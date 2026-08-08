/**
 * Back-compat alias — de-branded in roadmap P2.
 *
 * The canonical data-access module is now ./dataClient. Existing imports
 * (`import { base44 } from '@/api/base44Client'`) keep working unchanged; new
 * code should import from '@/api/dataClient' (`{ db }` / `{ base44 }`).
 */
export * from './dataClient';
export { default } from './dataClient';
