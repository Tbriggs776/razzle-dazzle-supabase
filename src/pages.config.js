/**
 * pages.config.js - Page routing configuration
 *
 * WAS auto-generated, and is not any more. The generated version listed all 88
 * pages as static imports, which is why the whole application compiled into one
 * 4.5 MB JavaScript file: every page had to download, parse and execute before
 * anything at all could render, on every first visit.
 *
 * This does the same job -- register every page under ./pages -- but lazily.
 * import.meta.glob hands Vite a dynamic importer per file, so each page becomes
 * its own chunk fetched the first time somebody navigates to it.
 *
 * IT STILL AUTO-REGISTERS. That was the point of the generated file and it is
 * preserved: drop a new file in ./pages and it appears here with no edit. The
 * glob pattern is static on purpose -- Vite resolves it at build time, so it
 * cannot be built from a variable.
 *
 * Layout stays a normal import. It wraps every authenticated page, so making it
 * lazy would buy nothing and add a flash of empty chrome on first paint.
 *
 * Anything rendering these pages must sit inside a <Suspense> boundary; App.jsx
 * provides it.
 *
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page.
 */
import { lazy } from 'react';
import __Layout from './Layout.jsx';

const modules = import.meta.glob('./pages/*.jsx');

const PREFIX = './pages/';
const SUFFIX = '.jsx';

/**
 * "./pages/LeadQueue.jsx" -> "LeadQueue", which is the key the router uses as
 * the URL segment and the name Layout receives as currentPageName. Both depend
 * on this matching the filename exactly, as the generated file's keys did.
 */
export const PAGES = Object.fromEntries(
  Object.entries(modules)
    .map(([path, loader]) => [path.slice(PREFIX.length, -SUFFIX.length), lazy(loader)])
    .sort(([a], [b]) => a.localeCompare(b)),
);

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
