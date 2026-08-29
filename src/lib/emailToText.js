/**
 * Render an outbound email body as readable text for the Communication Hub.
 *
 * The Hub is a chat view: short bubbles, one per message. Outbound emails are
 * stored as full HTML — a table layout with a styled CTA button and a signature —
 * and that was being injected straight into the bubble with dangerouslySetInnerHTML.
 * The result is what you would expect from putting an email inside a speech
 * bubble: the button renders at its email width and lands on top of the sentence
 * above it, and a signing URL with a 64-character token runs off the edge.
 *
 * So: convert to text rather than trying to style someone else's HTML into
 * submission. A coordinator scanning the thread wants to know what was said and
 * whether it went; they do not need the rendered email.
 *
 * Doing it this way also means the Hub stops injecting stored HTML at all, which
 * is worth having on its own. Inbound mail is already stripped before storage
 * (incomingEmail), and outbound bodies are our own templates — so this is
 * defence in depth rather than a hole being closed, but the affordance to inject
 * arbitrary stored markup should not exist in a screen that shows customer
 * conversations.
 */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

export function looksLikeHtml(s) {
  return typeof s === 'string' && /<\/?[a-z][\s\S]*>/i.test(s);
}

export function emailToText(html) {
  if (typeof html !== 'string' || !html) return '';
  let s = html;

  // Whole blocks whose content is never meant to be read.
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
       .replace(/<script[\s\S]*?<\/script>/gi, '')
       .replace(/<head[\s\S]*?<\/head>/gi, '')
       .replace(/<!--[\s\S]*?-->/g, '');

  // A link becomes its own text. Three cases, in order of how often they matter:
  //   - the href already appears elsewhere in the body: emit the LABEL ONLY. Our
  //     templates pair a "Review & Sign" button with an "Or copy this link:" line,
  //     so keeping both printed a 64-character signing token twice in one bubble.
  //   - the label is itself a url, or there is no label: emit the href.
  //   - otherwise: label followed by the url, so nothing is lost.
  const hrefCount = (h) => (h ? s.split(h).length - 1 : 0);
  s = s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const label = text.replace(/<[^>]+>/g, '').trim();
    if (!label) return href;
    if (/^https?:\/\//i.test(label)) return label;
    if (hrefCount(href) > 1) return label;
    return `${label} (${href})`;
  });

  // Structural tags become line breaks so paragraphs survive the trip.
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n')
       .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
       .replace(/<li\b[^>]*>/gi, '• ');

  s = s.replace(/<[^>]+>/g, '');

  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));

  // Tidy: no runs of blank lines, no trailing spaces, no leading/trailing gap.
  return s.replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
}
