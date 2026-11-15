# Dutch drafts (nl)

> **Draft, not shipped, not reviewed.** Removed from the code on 15 November 2026 under
> `docs/DECISIONS.md` D21 (English first, translation packs later). Kept as source material for a
> future Dutch pack. Nobody has reviewed this Dutch, and it is not kept in sync with the English.
> How a pack is added: `docs/i18n/README.md`.

## Embed: avatar prompt

English source: `apps/web/src/embed/strings/en.ts` (`avatar.claims`, `avatar.ui`). The claims are
the Dutch of `docs/legal/avatar-consent-copy.md` section 3, variant A; that document stays the
source for the consent wording.

```ts
const NL: AvatarClaims = {
  title: 'Laat de avatar op jou lijken',
  c1: 'Jij kiest. Alles staat uit tot jij het aanzet.',
  c2: 'Je krijgt hoe dan ook je maatadvies.',
  c3: 'De winkel ziet je foto, je gezicht en je lichaamsmaten nooit.',
  c4: 'We gebruiken je foto niet om je te herkennen, niet om AI iets te leren en niet voor reclame.',
  termsLink: 'Lees de volledige privacyvoorwaarden',
  faceName: 'Gebruik mijn gezicht',
  faceOff: 'De avatar heeft een standaardgezicht.',
  skinName: 'Mijn huidskleur',
  c11Pick: 'Kies zelf je huidskleur.',
  skinOff: 'De avatar heeft een standaardkleur.',
  skinOnYes: 'Kies een kleur uit de rij.',
  c30: 'Staat "{remember}" aan? Dan wordt je kleur op dit apparaat bewaard, bij je andere antwoorden.',
  c14: 'De avatar krijgt weer de standaardkleur. Jouw kleur wordt van dit apparaat gewist.',
  bodyOff: 'Je typt je maten in.',
};

const UI_NL: AvatarUi = {
  close: 'Sluiten',
  done: 'Klaar',
  comingSoon: 'Komt binnenkort',
  on: 'Aan',
  off: 'Uit',
  measurementsName: 'Mijn maten',
  typeMeasurements: 'Mijn maten intypen',
  swatch: (n, total) => `Kleur ${n} van ${total}`,
  lightest: 'lichtste',
  darkest: 'donkerste',
  picked: (n, total) => `Kleur ${n} van ${total} staat op de avatar.`,
  open: NL.title,
  swatchCredit: 'Kleuren: Monk Skin Tone Scale van dr. Ellis Monk, CC BY 4.0.',
  termsLanguageNote: '(in het Engels)',
};
```

Notes from when this was live:

- `open` was the prompt's title ("Laat de avatar op jou lijken").
- C30 named the footer's switch by its English label ("Remember me on this shop"), because the
  footer was English only. The consent copy's Dutch name for it is "Onthoud mij bij deze winkel".
- "(in het Engels)" followed the terms link because the published privacy page is English; the
  link carried `hreflang="en"` and the dialog `lang="nl"`.

## Embed: men's clothing, coming soon (D20 point 3)

English source: `apps/web/src/embed/strings/en.ts` (`blocked.comingSoon`, `actions.backToShop`).

| Key | Dutch draft |
| --- | --- |
| title | Herenkleding: binnenkort beschikbaar |
| text | De paskamer is nog niet klaar voor herenkleding. Gebruik voorlopig de maattabel van de winkel op de productpagina. |
| close button | Terug naar de winkel |

Note: the SDK's Dutch avoided the word "paskamer" on purpose (a test enforced it); this line uses
it. Settle that before a Dutch pack ships.

## SDK: button, QR modal, overlay, toast, size peek

English source: `packages/sdk/src/strings/en.ts`. The button label stayed "Try it on" in Dutch
(decision D1).

```ts
const nl: Strings = {
  button: 'Try it on',
  title: 'Pas het in Curtain',
  scan: 'Scan met je telefoon om het te passen in Curtain',
  openLink: 'Liever op dit apparaat? Open de link',
  expires: (m) => `Deze code verloopt over ${m} min`,
  paused: 'Curtain is in deze winkel even gesloten. Probeer het later opnieuw.',
  pausedShort: 'Curtain is in deze winkel momenteel gepauzeerd — de app legt het uit.',
  error: 'We konden Curtain nu niet openen. Probeer het zo nog eens.',
  close: 'Sluiten',
  qrAlt: 'QR-code die dit kledingstuk opent in Curtain',
  loading: 'Laden…',
  openApp: 'Open in de Curtain-app',
  yourSize: (z) => `Jouw maat: ${z}`,
  peek: 'Jouw maat',
  disclaimer: 'Schatting — berekend uit je maten en de kledinggegevens van de winkel, niet uit een foto van jou.',
};
```

## Elsewhere

- Shopify theme extension: `packages/shopify-app/translation-packs/try-button/nl.json`, `nl.schema.json`.
- WooCommerce plugin: `packages/woocommerce-plugin/translation-packs/curtain-woocommerce-nl_NL.po`.
