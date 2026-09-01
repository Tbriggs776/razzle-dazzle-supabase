# Auth email templates

The thirteen emails GoTrue can send on behalf of Razzle Dazzle — invitations,
password resets, sign-in links, and the security notices that tell someone their
account changed.

```bash
npm run emails
```

Rebuilds everything into `dist/` from [`build.mjs`](build.mjs). **Edit the script,
never the generated HTML** — the chrome exists once in `build.mjs` and thirteen
standalone copies fall out of it, because Supabase stores each template as one
self-contained string with no way to share a layout.

| | |
|---|---|
| `dist/<name>.html` | the exact string to paste into a dashboard template box |
| `dist/auth-config.json` | all thirteen plus subjects, shaped as a Management API PATCH body |
| `dist/preview.html` | every template rendered with sample values — open it in a browser |

## Installing them

One call sets all thirteen templates and their subject lines:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/zoyvqznftltlitspgdxn/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @supabase/templates/dist/auth-config.json
```

`SUPABASE_ACCESS_TOKEN` is a personal access token from
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens),
not a project key. The equivalent by hand is Authentication → Emails → Templates,
pasting each `dist/*.html` into its matching box.

## Before any of this actually sends

Nothing has ever been emailed by GoTrue on this project — `confirmation_sent_at`,
`recovery_sent_at` and `invited_at` are null on every row in `auth.users`. Three
things stand between these templates and a working invite, and they are
independent of each other:

**1. There is no SMTP provider on Auth.** Supabase's built-in sender only delivers
to members of the Supabase organisation and is rate-limited to a handful an hour.
Invites to the 52-person roster will simply not arrive. Set a provider under
Authentication → Emails → SMTP Settings.

> This is a *different* credential from the customer comms pipeline, and that
> distinction is the whole reason it is safe to do now. Resend and Twilio are
> deliberately disarmed with no keys, because base44 is still messaging live
> customers and arming ours would double-message them. Auth SMTP only ever mails
> staff about their own accounts. Configuring it does not arm anything customer-facing.

**2. `userAdmin` does not send an invitation — it mints a link.** `actInvite` calls
`generateLink({ type: 'invite' })`, which returns a URL for an admin to copy and
hand over. The comment there explains why: no provider was configured, and an
invite that silently fails to send is worse than one copied deliberately. Once
SMTP exists that reasoning expires, and the call becomes `inviteUserByEmail`.

**3. There is no screen to set a password.** `src/components/Login.jsx` is an email
and password form with no "forgot password" link and no set-password route. An
invite link signs the new user in through the URL hash and leaves them with an
account they can never sign into again. Fix this before sending a single invite —
it is the one that turns a working email into a support call.

## Notes for anyone editing the templates

- **`{{ .Something }}` is evaluated by GoTrue, not by the build.** The script
  asserts every delimiter it emits is one of the known variables and throws
  otherwise, so a typo fails the build instead of leaving a hole in a live email.
  The seven notices are gated behind `mailer_notifications_*_enabled` and are off
  by default; the two worth turning on are `password_changed` and `email_changed`.
- **The markup looks like 2003 on purpose.** Outlook 2016–2021 renders with the
  Word engine: no flexbox, no grid, no reliable `border-radius` or padding outside
  a table cell. Layout is tables, styles are inlined, and the one rounded button
  carries a VML fallback. The `<style>` block is progressive enhancement only —
  delete it and these still render.
- **Every button prints its URL underneath.** Floor Daddy is on Microsoft 365, and
  Defender Safe Links pre-fetches inbound URLs. A one-time auth link a scanner
  opens first is burnt before the human touches it, and it presents as "the invite
  doesn't work". The visible URL is also the cheapest anti-phishing tell available:
  the reader can see where it points.
- **The masthead is type, not an image.** Images are blocked by default in a lot of
  clients, and an auth email that opens as a broken rectangle is one a careful
  person is right to distrust.
- **Colour carries meaning.** Pink rule means something is waiting for you. Gold
  rule means it is a security notice with nothing to click — which is precisely
  what a phishing lookalike would never do.
