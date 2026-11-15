# Third-party material shown to shoppers or shipped in the product

Software dependencies carry their own licence files in `node_modules`; this file lists material that
is not a package and needs a credit or a licence check. Add a row when such material is added.

| What | Where it is used | Source | Licence | What the licence asks, and how we meet it |
|---|---|---|---|---|
| Monk Skin Tone (MST) Scale: the ten swatch colours `#F6EDE4`, `#F3E7DB`, `#F7EAD0`, `#EADABA`, `#D7BD96`, `#A07E56`, `#825C43`, `#604134`, `#3A312A`, `#292420` | `apps/web/src/features/capture/faceSkin.ts` (`MONK_SWATCHES`); shown to shoppers in the avatar prompt of the embed (`apps/web/src/embed/AvatarPrompt.tsx`) | Dr. Ellis Monk; published by Google at https://skintone.google | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | Credit, the licence, and a note of changes. Credit line under the swatches in the prompt ("Colours: Monk Skin Tone Scale by Dr. Ellis Monk, CC BY 4.0."), English and Dutch. The ten colours are used unchanged. The figure is drawn in a shaded version of the picked colour; that is our drawing, not a changed scale. |

Not checked by a lawyer. The licence name and the source were written from memory on 15 November 2026,
without opening the source page from this machine; confirm both before launch.
