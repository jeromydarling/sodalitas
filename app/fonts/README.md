# Fonts

Two variable faces, latin subsets, self-hosted:

| File | Family | Used for | Licence |
|---|---|---|---|
| `fraunces.woff2` | [Fraunces](https://fonts.google.com/specimen/Fraunces) | Headings, figures | SIL Open Font License 1.1 |
| `inter.woff2` | [Inter](https://fonts.google.com/specimen/Inter) | Body, UI, tables | SIL Open Font License 1.1 |

Both are OFL, which permits bundling and redistribution. 116 KB for the pair —
less than one hero photograph.

## Why they're committed rather than fetched

The privacy page says there are no third-party requests, and that has to be
true. A Google Fonts link would make it a lie, and would put a DNS lookup and a
TLS handshake in front of the first paint on every cold visit.

## Replacing one

Drop in a new `.woff2` under the same filename and adjust the `@font-face`
weight range in `app/app.css` if it differs. Vite fingerprints and preloads
them from the CSS — nothing else needs to change.

Subset with [glyphhanger](https://github.com/zachleat/glyphhanger) or take the
latin range straight from the Google Fonts CSS with a modern browser
user-agent, which is what these are.
