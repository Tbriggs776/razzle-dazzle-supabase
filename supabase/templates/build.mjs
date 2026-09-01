#!/usr/bin/env node
/**
 * Build the Supabase Auth email templates.
 *
 * Supabase stores each template as ONE standalone HTML string -- there are no
 * includes, no partials, no layout file. Hand-maintaining thirteen copies of the
 * same chrome guarantees they drift, so the chrome lives here once and the
 * thirteen standalone files are generated from it.
 *
 *   node supabase/templates/build.mjs
 *
 * Outputs to supabase/templates/dist/:
 *   <name>.html        the exact string to paste into the dashboard
 *   auth-config.json   all thirteen + their subjects, as a Management API PATCH body
 *   preview.html       every template rendered with sample values, for eyeballing
 *
 * WHY THE MARKUP LOOKS LIKE 2003. Email is not the web. Outlook 2016-2021 renders
 * with the Word engine: no flexbox, no grid, no border-radius on links, unreliable
 * padding on anything that is not a table cell. Gmail strips most of <head>. So:
 * tables for layout, every consequential style inlined, and a VML fallback for the
 * one rounded button. The <style> block carries only progressive enhancement --
 * remove it entirely and these still render correctly.
 *
 * TEMPLATE VARIABLES are Go templates evaluated by GoTrue, NOT by this script.
 * They must survive into the output verbatim: {{ .ConfirmationURL }}, {{ .Email }},
 * {{ .NewEmail }}, {{ .OldEmail }}, {{ .Token }}, {{ .Phone }}, {{ .OldPhone }},
 * {{ .Provider }}, {{ .FactorType }}. Never introduce a literal {{ anywhere else.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'dist');

// Straight from src/index.css -- the same tokens the app renders, converted out of
// HSL because email clients cannot be trusted with hsl() or CSS custom properties.
const C = {
  navy:   '#1C234A',  // --brand-navy   230 46% 20%
  pink:   '#DD0E72',  // --brand-pink   331 88% 46%
  gold:   '#EFBB1F',  // --brand-gold    45 87% 53%
  ink:    '#1E293B',
  muted:  '#64748B',
  faint:  '#94A3B8',
  line:   '#E2E8F0',
  ground: '#EEF0F5',
  card:   '#FFFFFF',
  white:  '#FFFFFF',
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

/**
 * The accent is not decoration -- it says whether the reader has something to do.
 * Pink means an action is waiting. Gold means this is a security notice and there
 * is nothing to click, which is exactly what a phishing lookalike would not do.
 */
const ACTION = { rule: C.pink, kind: 'action' };
const NOTICE = { rule: C.gold, kind: 'notice' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rounded, centred button that also survives Word-engine Outlook, via VML. */
const button = (label, href) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="${C.pink}" style="border-radius:8px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:300px;" arcsize="17%" stroke="f" fillcolor="${C.pink}">
                      <w:anchorlock/>
                      <center style="color:${C.white};font-family:${SANS};font-size:16px;font-weight:bold;">${label}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${href}" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:16px;font-weight:600;line-height:18px;color:${C.white};text-decoration:none;border-radius:8px;background-color:${C.pink};mso-hide:all;">${label}</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>`;

/**
 * The link is printed in full underneath every button on purpose.
 *
 * Floor Daddy is on Microsoft 365, and Defender Safe Links pre-fetches URLs in
 * inbound mail. A single-use auth link that a scanner opens first is burnt before
 * the human touches it, and the failure looks like "the invite doesn't work".
 * A visible URL is also the cheapest anti-phishing tell there is: the reader can
 * see it points at Supabase and not somewhere else.
 */
const fallback = (href) => `
              <p style="margin:26px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">Button not working? Copy this link into your browser:</p>
              <p style="margin:6px 0 0;font-family:${MONO};font-size:12px;line-height:19px;color:${C.muted};word-break:break-all;">${href}</p>`;

const codeBlock = (code) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="${C.ground}" style="border-radius:8px;border:1px solid ${C.line};padding:18px 32px;">
                    <span style="font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:7px;color:${C.navy};">${code}</span>
                  </td>
                </tr>
              </table>`;

function shell(t) {
  const accent = t.accent.rule;
  const middle = t.kind === 'code'
    ? codeBlock(t.code)
    : t.cta
      ? button(t.cta.label, t.cta.href) + fallback(t.cta.href)
      : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(t.subject)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  /* Progressive enhancement only. Every style that matters is inlined below;
     strip this block and the email still renders correctly. */
  body { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse !important; }
  a { color:${C.pink}; }
  @media only screen and (max-width:620px) {
    .card { width:100% !important; }
    .pad  { padding-left:24px !important; padding-right:24px !important; }
    .h1   { font-size:21px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.ground};">
<div style="display:none;font-size:1px;color:${C.ground};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(t.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ground}" style="background-color:${C.ground};">
  <tr>
    <td align="center" style="padding:34px 12px;">

      <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${C.card};border-radius:14px;overflow:hidden;">

        <!-- Masthead. Deliberately type-only: no image to be blocked, so the
             sender is identifiable the instant the message opens. -->
        <tr>
          <td bgcolor="${C.navy}" align="left" class="pad" style="background-color:${C.navy};padding:30px 44px 26px;">
            <div style="font-family:${SANS};font-size:19px;font-weight:700;letter-spacing:4px;line-height:24px;color:${C.white};text-transform:uppercase;">Razzle&nbsp;Dazzle</div>
            <div style="font-family:${SANS};font-size:12px;font-weight:500;letter-spacing:1.4px;line-height:18px;color:#9AA3C4;text-transform:uppercase;padding-top:5px;">Floor Daddy Operations</div>
          </td>
        </tr>
        <tr><td bgcolor="${accent}" height="4" style="background-color:${accent};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr>
          <td class="pad" style="padding:40px 44px 42px;">

            <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:1.6px;line-height:16px;color:${accent};text-transform:uppercase;">${esc(t.eyebrow)}</div>

            <h1 class="h1" style="margin:12px 0 0;font-family:${SANS};font-size:25px;font-weight:700;line-height:33px;color:${C.navy};">${esc(t.heading)}</h1>

            <div style="font-family:${SANS};font-size:16px;line-height:26px;color:${C.ink};">${t.body}</div>

${middle ? `            <div style="height:30px;line-height:30px;font-size:0;">&nbsp;</div>\n${middle}` : ''}

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:34px;">
              <tr><td height="1" bgcolor="${C.line}" style="background-color:${C.line};height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
            </table>

            <p style="margin:22px 0 0;font-family:${SANS};font-size:14px;line-height:23px;color:${C.muted};">${t.footnote}</p>

          </td>
        </tr>
      </table>

      <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td align="center" class="pad" style="padding:24px 44px 8px;">
            <p style="margin:0;font-family:${SANS};font-size:12px;line-height:20px;color:${C.faint};">Sent automatically by Razzle Dazzle, Floor Daddy&rsquo;s operations system.<br>Nobody replies to this address &mdash; reach a person through the app instead.</p>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>
`;
}

const URL_VAR = '{{ .ConfirmationURL }}';

const TEMPLATES = [
  {
    key: 'invite',
    subject: 'You have been invited to Razzle Dazzle',
    preheader: 'Choose a password and your account is ready.',
    accent: ACTION,
    eyebrow: 'Account invitation',
    heading: 'Set up your Razzle Dazzle account',
    body: `<p style="margin:16px 0 0;">An administrator added <strong style="color:${C.navy};">{{ .Email }}</strong> to Razzle Dazzle, the system Floor Daddy runs its leads, jobs and installs on.</p>
            <p style="margin:14px 0 0;">Choose a password and your account is ready to use.</p>`,
    cta: { label: 'Set up my account', href: URL_VAR },
    footnote: 'This link can be used once. If it has already expired, ask an administrator to send a new invitation.',
  },
  {
    key: 'confirmation',
    subject: 'Confirm your email address',
    preheader: 'One click and your Razzle Dazzle account is active.',
    accent: ACTION,
    eyebrow: 'Email confirmation',
    heading: 'Confirm your email address',
    body: `<p style="margin:16px 0 0;">Confirm that <strong style="color:${C.navy};">{{ .Email }}</strong> belongs to you and your Razzle Dazzle account becomes active.</p>`,
    cta: { label: 'Confirm email address', href: URL_VAR },
    footnote: 'If you did not create this account, ignore this email and nothing happens.',
  },
  {
    key: 'magic_link',
    subject: 'Your Razzle Dazzle sign-in link',
    preheader: 'Sign in without a password.',
    accent: ACTION,
    eyebrow: 'Sign-in link',
    heading: 'Sign in to Razzle Dazzle',
    body: `<p style="margin:16px 0 0;">Use the button below to sign in as <strong style="color:${C.navy};">{{ .Email }}</strong>. No password needed.</p>`,
    cta: { label: 'Sign in', href: URL_VAR },
    footnote: 'The link works once and expires shortly. If you did not ask to sign in, ignore this email &mdash; the link is useless to anyone else.',
  },
  {
    key: 'recovery',
    subject: 'Reset your Razzle Dazzle password',
    preheader: 'Choose a new password for your account.',
    accent: ACTION,
    eyebrow: 'Password reset',
    heading: 'Reset your password',
    body: `<p style="margin:16px 0 0;">Someone asked to reset the password for <strong style="color:${C.navy};">{{ .Email }}</strong>. Choose a new one below.</p>`,
    cta: { label: 'Choose a new password', href: URL_VAR },
    footnote: 'If that was not you, ignore this email &mdash; your current password keeps working and nothing has changed.',
  },
  {
    key: 'email_change',
    subject: 'Confirm your new email address',
    preheader: 'Confirm the change to your Razzle Dazzle account.',
    accent: ACTION,
    eyebrow: 'Email change',
    heading: 'Confirm your new email address',
    body: `<p style="margin:16px 0 0;">A request was made to change the email on your Razzle Dazzle account from <strong style="color:${C.navy};">{{ .Email }}</strong> to <strong style="color:${C.navy};">{{ .NewEmail }}</strong>.</p>
            <p style="margin:14px 0 0;">Confirm it below. With secure email change switched on, this arrives at both addresses and both have to confirm.</p>`,
    cta: { label: 'Confirm the change', href: URL_VAR },
    footnote: 'If you did not ask for this, ignore this email and tell an administrator. The address on the account will not change unless both sides confirm.',
  },
  {
    key: 'reauthentication',
    subject: 'Your Razzle Dazzle verification code',
    preheader: 'Enter this code to confirm it is you.',
    accent: ACTION,
    kind: 'code',
    code: '{{ .Token }}',
    eyebrow: 'Verification code',
    heading: 'Confirm it is you',
    body: `<p style="margin:16px 0 0;">Enter this code in Razzle Dazzle to confirm the change you just requested.</p>`,
    footnote: 'The code expires shortly and works once. If you did not request it, ignore this email and tell an administrator &mdash; someone may have your password.',
  },

  // ---------------------------------------------------------------------------
  // Security notices. No link, no button, gold rule. These are OFF by default;
  // each has its own mailer_notifications_*_enabled flag.
  // ---------------------------------------------------------------------------
  {
    key: 'password_changed_notification',
    subject: 'Your Razzle Dazzle password was changed',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'Your password was changed',
    body: `<p style="margin:16px 0 0;">The password for <strong style="color:${C.navy};">{{ .Email }}</strong> was just changed.</p>
            <p style="margin:14px 0 0;">If that was you, there is nothing to do.</p>`,
    footnote: 'If it was not you, reset your password immediately and tell a Razzle Dazzle administrator. This message contains no links on purpose &mdash; a real security notice never asks you to click anything.',
  },
  {
    key: 'email_changed_notification',
    subject: 'Your Razzle Dazzle email address was changed',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'Your email address was changed',
    body: `<p style="margin:16px 0 0;">The email on your Razzle Dazzle account changed from <strong style="color:${C.navy};">{{ .OldEmail }}</strong> to <strong style="color:${C.navy};">{{ .Email }}</strong>.</p>`,
    footnote: 'If you did not make this change, tell a Razzle Dazzle administrator right away &mdash; whoever controls the new address controls the account.',
  },
  {
    key: 'phone_changed_notification',
    subject: 'Your Razzle Dazzle phone number was changed',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'Your phone number was changed',
    body: `<p style="margin:16px 0 0;">The phone number on your Razzle Dazzle account changed from <strong style="color:${C.navy};">{{ .OldPhone }}</strong> to <strong style="color:${C.navy};">{{ .Phone }}</strong>.</p>`,
    footnote: 'If you did not make this change, tell a Razzle Dazzle administrator right away.',
  },
  {
    key: 'identity_linked_notification',
    subject: 'A new sign-in method was added to your account',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'A sign-in method was added',
    body: `<p style="margin:16px 0 0;">Your <strong style="color:${C.navy};">{{ .Provider }}</strong> account was linked as a way to sign in as <strong style="color:${C.navy};">{{ .Email }}</strong>.</p>`,
    footnote: 'If you did not add it, tell a Razzle Dazzle administrator right away &mdash; a linked account can sign in without your password.',
  },
  {
    key: 'identity_unlinked_notification',
    subject: 'A sign-in method was removed from your account',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'A sign-in method was removed',
    body: `<p style="margin:16px 0 0;">Your <strong style="color:${C.navy};">{{ .Provider }}</strong> account was removed as a way to sign in as <strong style="color:${C.navy};">{{ .Email }}</strong>.</p>`,
    footnote: 'If you did not remove it, tell a Razzle Dazzle administrator right away.',
  },
  {
    key: 'mfa_factor_enrolled_notification',
    subject: 'A verification method was added to your account',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'A verification method was added',
    body: `<p style="margin:16px 0 0;"><strong style="color:${C.navy};">{{ .FactorType }}</strong> was added as a sign-in verification method on your Razzle Dazzle account.</p>`,
    footnote: 'If you did not add it, tell a Razzle Dazzle administrator right away.',
  },
  {
    key: 'mfa_factor_unenrolled_notification',
    subject: 'A verification method was removed from your account',
    preheader: 'A security notice about your account.',
    accent: NOTICE,
    eyebrow: 'Security notice',
    heading: 'A verification method was removed',
    body: `<p style="margin:16px 0 0;"><strong style="color:${C.navy};">{{ .FactorType }}</strong> was removed as a sign-in verification method on your Razzle Dazzle account.</p>`,
    footnote: 'If you did not remove it, tell a Razzle Dazzle administrator right away &mdash; losing a verification method weakens the account.',
  },
];

// --- build -------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const config = {};
const rendered = [];

for (const t of TEMPLATES) {
  const html = shell(t);

  // Guard: a stray Go delimiter that is not one of the known variables would be
  // silently swallowed by GoTrue and leave a hole in a live email.
  const vars = html.match(/\{\{[^}]*\}\}/g) ?? [];
  const KNOWN = /^\{\{ \.(ConfirmationURL|Token|TokenHash|SiteURL|Email|NewEmail|OldEmail|Phone|OldPhone|Provider|FactorType|RedirectTo|Data) \}\}$/;
  for (const v of vars) {
    if (!KNOWN.test(v)) throw new Error(`${t.key}: unrecognised template variable ${v}`);
  }

  writeFileSync(join(OUT, `${t.key}.html`), html, 'utf8');
  config[`mailer_subjects_${t.key}`] = t.subject;
  config[`mailer_templates_${t.key}_content`] = html;
  rendered.push({ ...t, html, vars: [...new Set(vars)] });
}

writeFileSync(join(OUT, 'auth-config.json'), JSON.stringify(config, null, 2), 'utf8');

// --- preview -----------------------------------------------------------------

const SAMPLE = {
  '{{ .ConfirmationURL }}': 'https://zoyvqznftltlitspgdxn.supabase.co/auth/v1/verify?token=pkce_9f3c1a7b2e5d4088ab61&type=invite&redirect_to=https://razzle-dazzle-supabase.vercel.app',
  '{{ .Email }}': 'maya@floordaddy.com',
  '{{ .NewEmail }}': 'maya.reyes@floordaddy.com',
  '{{ .OldEmail }}': 'maya@floordaddy.com',
  '{{ .Token }}': '418 902',
  '{{ .Phone }}': '(602) 699-8747',
  '{{ .OldPhone }}': '(480) 555-0114',
  '{{ .Provider }}': 'Google',
  '{{ .FactorType }}': 'Authenticator app',
};
const fill = (s) => Object.entries(SAMPLE).reduce((acc, [k, v]) => acc.split(k).join(v), s);

const previewCards = rendered.map((t) => `
  <section class="tpl">
    <header>
      <h2>${esc(t.heading)}</h2>
      <p class="meta"><code>mailer_templates_${t.key}_content</code></p>
      <p class="subj"><span>Subject</span> ${esc(t.subject)}</p>
      <p class="vars">${t.vars.map((v) => `<code>${esc(v)}</code>`).join(' ')}</p>
    </header>
    <iframe title="${esc(t.subject)}" srcdoc="${fill(t.html).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
  </section>`).join('\n');

writeFileSync(join(OUT, 'preview.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Razzle Dazzle auth emails</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#E4E7EE; font-family:${SANS}; color:${C.ink}; }
  .page { max-width:1000px; margin:0 auto; padding:48px 20px 80px; }
  h1 { font-size:28px; letter-spacing:-0.4px; color:${C.navy}; margin:0 0 6px; }
  .lede { color:${C.muted}; margin:0 0 40px; font-size:15px; line-height:24px; max-width:62ch; }
  .tpl { background:#fff; border-radius:14px; margin-bottom:30px; overflow:hidden; box-shadow:0 1px 3px rgba(28,35,74,.10); }
  .tpl header { padding:20px 24px 16px; border-bottom:1px solid ${C.line}; }
  .tpl h2 { margin:0; font-size:17px; color:${C.navy}; }
  .meta { margin:5px 0 0; font-size:12px; color:${C.faint}; }
  .subj { margin:10px 0 0; font-size:13px; color:${C.ink}; }
  .subj span { display:inline-block; font-size:10px; letter-spacing:1.2px; text-transform:uppercase; color:${C.faint}; margin-right:8px; }
  .vars { margin:9px 0 0; display:flex; flex-wrap:wrap; gap:6px; }
  code { font-family:${MONO}; font-size:11px; background:${C.ground}; border:1px solid ${C.line}; border-radius:5px; padding:2px 6px; color:${C.muted}; }
  iframe { display:block; width:100%; height:680px; border:0; background:${C.ground}; }
</style></head>
<body><div class="page">
  <h1>Razzle Dazzle auth emails</h1>
  <p class="lede">Every template GoTrue can send, rendered with sample values. The first six carry a pink rule and an action; the last seven carry a gold rule, no link, and exist only to tell someone their account changed. Generated by <code>supabase/templates/build.mjs</code> &mdash; edit that, not these.</p>
${previewCards}
</div></body></html>
`, 'utf8');

console.log(`Built ${TEMPLATES.length} templates -> ${OUT}`);
for (const t of rendered) console.log(`  ${t.key.padEnd(36)} ${String(t.html.length).padStart(6)} bytes`);
