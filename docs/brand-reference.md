# Floor Daddy brand reference

Extracted from floordaddy.com on 2026-09-02 by counting colour declarations in the
served HTML/CSS, so these are what the public site actually paints — not what a style
guide claims.

## The palette is already in our tokens

The `--brand-*` values in `src/index.css` were extracted accurately. This was worth
verifying, because the logo is navy and blue with no pink in it, and it was reasonable
to wonder whether pink had been inherited from somewhere else. It had not.

| floordaddy.com | uses | our token | value | |
|---|---:|---|---|---|
| `#1c244b` | 25 | `--brand-navy` | `#1C234A` | match |
| `#ff1478`, `#ff1b7b`, `#e40770`, `#ff5aa1` | 13 | `--brand-pink-bright` | `#FF1476` | near-exact |
| `#47befb` | 7 | `--brand-sky` | `#46BFFB` | near-exact |
| `#0879e8` | 6 | `--brand-blue` | `#0E78E1` | close |
| `#082e68` | 6 | — | — | deeper navy, unmapped |
| `#007db6` | 6 | — | — | teal-blue, unmapped |
| `#fbbc05` | 2 | `--brand-gold` | `#EFBB1F` | close |

Navy dominates; pink is the accent and is used sparingly on the public site too. That
ratio is the same discipline the design system already encodes as "one accent per
view" — so the site and the app agree, and nothing about the tokens needs changing.

## Typography — the one real divergence

The public site loads **Poppins** (400–900) from Google Fonts, plus **Brittany
Signature** for script flourishes.

Wave 0 deliberately moved the app **off** Poppins to self-hosted **Archivo** (display)
+ **IBM Plex Sans** (body), on the reasoning that dense ERP screens with tabular
figures need a workhorse UI face rather than a marketing one. That is right for
internal screens.

It leaves an open question for EXTERNAL pages: a customer opens the project tracker
having just been on floordaddy.com, and lands on a different typeface. Options:

1. External pages self-host Poppins and use it; internal stays Archivo/Plex.
   Matches the brand at the moment of highest brand sensitivity. Costs one more
   self-hosted family (the repo deliberately avoids Google Fonts at runtime).
2. Everything stays Archivo/Plex. One system, and most customers will not consciously
   notice a typeface change between two different products.

Not decided. Flagged so it is a choice rather than an oversight.

## Voice

Headlines observed: "New Floors. Big Savings. Zero Stress." ·
"SEXY FLOORING | AFFORDABLE PRICES | QUALITY INSTALL" ·
"Earning 5 star reviews is sorta our thing!" ·
"Same room. Same light. Completely new life."

Playful and plain-spoken, confident without being formal. Customer-facing copy in the
app should sound like this rather than like enterprise software. Note also that
"Razzle Dazzle" is a Floor Daddy sale campaign name — the app is named after it.

## What this means for the work

The tokens are correct and live. Waves 0 and 1 applied them to the internal shell and
the daily work pages. Waves 2-6 were never built, and Wave 6 was the external pages
(customer tracker, appointment view, sign-document, installer apply) plus the
subcontractor Portal.

So the branding gap is not a palette problem. It is that nobody ever wrote the pattern
for a page that renders **without the app shell**, on a phone, opened from a text
message, by someone who is not an employee.
