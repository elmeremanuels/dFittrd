# Avatar prompt: plain-language consent copy (English and Dutch)

> **DRAFT for Naomi's review (D20.4). Not in force, not built.** Written 14 November 2026 by an AI agent,
> not a lawyer. The photo-based face stays behind its flag until she has answered.

> **D21 (15 Nov 2026): only the English (section 2) is shipped for now.** The Dutch (section 3) stays here
> as source material for a later translation pack; it is not in the code. See `docs/i18n/README.md`.

This is the exact text for the prompt that opens when a shopper taps the avatar (decision D19). The full
legal text is one tap away: `avatar-privacy-terms-DRAFT.md`.

**The rule (D19):** the plain text never promises more than the legal text. Every claim below has an id
(C1, C2, ...) and section 5 maps each one to a clause in the draft terms. If a clause changes, the claim
changes with it. If engineering cannot make a clause true, the claim goes, not the test.

**Reading level:** written for a 12-year-old. Short sentences, common words, no "process", "biometric"
or "data". Not tested on readers. Section 6 gives a rough formula score, which is not a reading test.

**Two variants.** A shop runs one:

- **Variant A, on-device only.** The photo never leaves the device.
- **Variant B, D19 face route.** One head-and-neck photo is sent, used in memory, deleted on return.

The copy differs only where marked. Never mix them: variant A text on a variant B build would be false.

**Variant B wording is conditional.** C6 B, C7 B, C21 B and C24 B ("to Curtain", "We do not keep it",
"gone for good") may ship only if (a) the face step runs on a machine Curtain operates, or (b) any other
company that receives the photo (a hosting or rented GPU provider, D16) is named in clause T4.8, bound
by contract to T4.4 and T4.5, and covered by the nothing-stored suite. If neither holds, use the fallback
lines in section 2.2 or keep the flag off. This is a build condition, not a footnote.

## 1. Layout and switch states

| Element | State when the prompt first opens | Notes |
|---|---|---|
| Use my face | Off | Hidden when the shop's `face` flag is off (plan gate G7) |
| Match my skin tone | Off (standard colour) | Picking a colour by hand needs no camera and no age line |
| Scan my body | Off | Typed measurements are the default (D19) |
| Remember my photo on this device | Off | Shown only once Use my face is on. D20.2 allows remembering; this copy makes it a choice that starts off. If the founder wants it on by default, C19 and T3.5 must both change and Naomi must see it |
| Remember me on this shop | As the shopper left it (on by default, main policy) | **Existing** switch, outside this prompt. It decides whether a hand-picked colour is saved (C30, T3.9). Open: engineering and the founder must reconcile it with "Remember my photo"; see gap 6 |
| Yes / No buttons | Same size, same weight | Plan gate G2. No pre-ticked box anywhere |

Nothing is opened, read or sent until the shopper presses the yes button for that item. A returning
shopper sees the switches as they left them only if **Remember** was on; otherwise all are off again.

## 2. English

### 2.1 Shared text (both variants)

| Id | Where | Text |
|---|---|---|
| | Title | **Make the avatar look like you** |
| C1 | Intro | You choose. Everything here is off until you switch it on. |
| C2 | Intro | You get your size advice either way. |
| C3 | Intro | The shop never sees your photo, your face or your body measurements. |
| C4 | Footer | We do not use your photo to recognise you, to teach AI, or for ads. |
| C5 | Footer, above the camera items | The photo and the scan are for people aged [16] or older. |
| | Link label | Read the full privacy terms |
| C27 | Label under the avatar when a face is shown | Your face on an estimated body |

### 2.2 Use my face

| Id | Variant A (on-device) | Variant B (face route) |
|---|---|---|
| C6 | We use a photo of your face to draw your face on the avatar. | We send one photo of your face to Curtain. We use it to draw your face on the avatar. |
| C7 | The photo stays on your device. It is never sent to us. | It is deleted right after. We do not keep it. |
| C8 | (none) | Only your head and neck. Never your body. |
| C23 | (none) | We work out the shape of your face from it. |
| C24 | (none) | This takes at most [60] seconds. Then the photo and the shape are gone for good. |
| Yes button | **Yes, use my photo** | **Yes, send my photo** |
| No button | **No, keep the standard face** | **No, don't send it** |

| Moment | Variant A | Variant B |
|---|---|---|
| Off (start) | The avatar has a standard face. | The avatar has a standard face. |
| On yes | Your device asks if we may use the camera. You can also pick a photo you already have. | Your device asks if we may use the camera. You can also pick a photo you already have. |
| C25, before sending (B only) | (none) | We show you the photo first. It is sent only when you press **Send**. |
| On no | Nothing happens. The avatar keeps the standard face. | Nothing is sent. The avatar keeps the standard face. |
| C9, switched off again | Your face is taken off the avatar and deleted from this device. | Your face is taken off the avatar and deleted from this device. We have nothing left to delete, because we did not keep your photo. |
| C10, when it fails (B only) | (none) | That did not work. Your photo was deleted. Try again? |

Fallback lines for variant B when another company receives the photo (see "Variant B wording is
conditional" above). They replace C6 B and C7 B; C21 B is then dropped:

| Id | Text |
|---|---|
| C6 B-alt | We send one photo of your face to Curtain and to [PROVIDER NAME], who works for us. We use it to draw your face on the avatar. |
| C7 B-alt | It is deleted right after. |

### 2.3 Match my skin tone

| Id | Variant A | Variant B |
|---|---|---|
| C11 | Pick your skin colour yourself. Or let us read it from your photo. | Pick your skin colour yourself. Or let us read it from your photo. |
| C12 | Reading it happens on your device. | Reading it happens on your device. If you sent us a photo for your face, we read the colour from that one too. |
| C13 | If you ask for a "See it on me" picture, the colour goes along. Only the colour, no photo. | If you ask for a "See it on me" picture, the colour goes along. Only the colour, no photo. |
| C28 | The colour goes to us and to the company that makes the picture. It is gone within a day. | The colour goes to us and to the company that makes the picture. It is gone within a day. |
| C29 | That picture shows the standard face, not yours. | That picture shows the standard face, not yours. |

| Moment | Both variants |
|---|---|
| Off (start) | The avatar has a standard colour. |
| On yes | Pick a colour from the row. |
| C26, on yes | If you want us to read it from a photo, we ask first. You always choose the final colour. |
| C30, on yes | If "Remember me on this shop" is on, your colour is saved on this device with your other answers. |
| On no | The avatar keeps the standard colour. |
| C14, switched off again | The avatar goes back to the standard colour. Your colour is deleted from this device. |

### 2.4 Scan my body

| Id | Both variants |
|---|---|
| C15 | Your camera measures your body. The video stays on your device and is not saved. |
| C16 | It is never sent to us. |
| C17 | You can also just type your measurements. |

| Moment | Both variants |
|---|---|
| Off (start) | You type your measurements. |
| On yes | Your device asks if we may use the camera. Stand back so we can see you from head to toe. |
| On no | Nothing happens. You type your measurements. |
| C18, switched off again | The scan result is deleted. Measurements you typed stay. |

### 2.5 Remember, delete, forget

| Id | Control | Text (both variants unless marked) |
|---|---|---|
| C19 | Switch: **Remember my photo on this device** | Off: your face is gone when you close this window. On: it is saved on this device, for this shop only. Not with us. |
| C20 | Button: **Delete my photo** | Removes your face, and the colour we read from it, from this device. Right now. |
| C21 | Variant B, extra line under Delete my photo | We have nothing to delete. We did not keep your photo. |
| C22 | Button: **Forget me** | Removes everything this tool saved on this device for this shop. It also tells Curtain to delete the random number it knows this device by. |

## 3. Nederlands

### 3.1 Gedeelde tekst (beide varianten)

| Id | Plek | Tekst |
|---|---|---|
| | Titel | **Laat de avatar op jou lijken** |
| C1 | Intro | Jij kiest. Alles staat uit tot jij het aanzet. |
| C2 | Intro | Je krijgt hoe dan ook je maatadvies. |
| C3 | Intro | De winkel ziet je foto, je gezicht en je lichaamsmaten nooit. |
| C4 | Voettekst | We gebruiken je foto niet om je te herkennen, niet om AI iets te leren en niet voor reclame. |
| C5 | Voettekst, boven de camera-onderdelen | De foto en de scan zijn voor mensen van [16] jaar of ouder. |
| | Linktekst | Lees de volledige privacyvoorwaarden |
| C27 | Label onder de avatar als er een gezicht staat | Jouw gezicht op een geschat lichaam |

### 3.2 Gebruik mijn gezicht

| Id | Variant A (alleen op je apparaat) | Variant B (foto naar Curtain) |
|---|---|---|
| C6 | We gebruiken een foto van je gezicht om jouw gezicht op de avatar te tekenen. | We sturen één foto van je gezicht naar Curtain. Daarmee tekenen we jouw gezicht op de avatar. |
| C7 | De foto blijft op je apparaat. Hij wordt nooit naar ons gestuurd. | Hij wordt meteen daarna gewist. We bewaren hem niet. |
| C8 | (geen) | Alleen je hoofd en hals. Nooit je lichaam. |
| C23 | (geen) | We rekenen uit welke vorm je gezicht heeft. |
| C24 | (geen) | Dit duurt hooguit [60] seconden. Daarna zijn de foto en de vorm voorgoed weg. |
| Ja-knop | **Ja, gebruik mijn foto** | **Ja, stuur mijn foto** |
| Nee-knop | **Nee, houd het standaardgezicht** | **Nee, niet sturen** |

| Moment | Variant A | Variant B |
|---|---|---|
| Uit (begin) | De avatar heeft een standaardgezicht. | De avatar heeft een standaardgezicht. |
| Bij ja | Je apparaat vraagt of we de camera mogen gebruiken. Je kunt ook een foto kiezen die je al hebt. | Je apparaat vraagt of we de camera mogen gebruiken. Je kunt ook een foto kiezen die je al hebt. |
| C25, voor het versturen (alleen B) | (geen) | We laten je de foto eerst zien. Hij wordt pas verstuurd als je op **Verstuur** drukt. |
| Bij nee | Er gebeurt niets. De avatar houdt het standaardgezicht. | Er wordt niets verstuurd. De avatar houdt het standaardgezicht. |
| C9, weer uitgezet | Je gezicht gaat van de avatar af en wordt van dit apparaat gewist. | Je gezicht gaat van de avatar af en wordt van dit apparaat gewist. Bij ons valt niets meer te wissen, want we hebben je foto niet bewaard. |
| C10, als het mislukt (alleen B) | (geen) | Dat lukte niet. Je foto is gewist. Nog een keer proberen? |

Vervangende regels voor variant B als een ander bedrijf de foto ontvangt (in plaats van C6 B en C7 B;
C21 B vervalt dan):

| Id | Tekst |
|---|---|
| C6 B-alt | We sturen één foto van je gezicht naar Curtain en naar [NAAM BEDRIJF], dat voor ons werkt. Daarmee tekenen we jouw gezicht op de avatar. |
| C7 B-alt | Hij wordt meteen daarna gewist. |

### 3.3 Mijn huidskleur

| Id | Variant A | Variant B |
|---|---|---|
| C11 | Kies zelf je huidskleur. Of laat ons die van je foto aflezen. | Kies zelf je huidskleur. Of laat ons die van je foto aflezen. |
| C12 | Dat aflezen gebeurt op je apparaat. | Dat aflezen gebeurt op je apparaat. Heb je ons een foto gestuurd voor je gezicht? Dan lezen we de kleur ook van die foto af. |
| C13 | Vraag je om een plaatje "Zo staat het mij"? Dan gaat de kleur mee. Alleen de kleur, geen foto. | Vraag je om een plaatje "Zo staat het mij"? Dan gaat de kleur mee. Alleen de kleur, geen foto. |
| C28 | De kleur gaat naar ons en naar het bedrijf dat het plaatje maakt. Binnen een dag is hij weg. | De kleur gaat naar ons en naar het bedrijf dat het plaatje maakt. Binnen een dag is hij weg. |
| C29 | Op dat plaatje staat het standaardgezicht, niet dat van jou. | Op dat plaatje staat het standaardgezicht, niet dat van jou. |

| Moment | Beide varianten |
|---|---|
| Uit (begin) | De avatar heeft een standaardkleur. |
| Bij ja | Kies een kleur uit de rij. |
| C26, bij ja | Wil je dat we de kleur van een foto aflezen? Dan vragen we dat eerst. Jij kiest altijd de kleur die het wordt. |
| C30, bij ja | Staat "Onthoud mij bij deze winkel" aan? Dan wordt je kleur op dit apparaat bewaard, bij je andere antwoorden. |
| Bij nee | De avatar houdt de standaardkleur. |
| C14, weer uitgezet | De avatar krijgt weer de standaardkleur. Jouw kleur wordt van dit apparaat gewist. |

### 3.4 Scan mijn lichaam

| Id | Beide varianten |
|---|---|
| C15 | Je camera meet je lichaam. De video blijft op je apparaat en wordt niet bewaard. |
| C16 | Hij wordt nooit naar ons gestuurd. |
| C17 | Je kunt je maten ook gewoon intypen. |

| Moment | Beide varianten |
|---|---|
| Uit (begin) | Je typt je maten in. |
| Bij ja | Je apparaat vraagt of we de camera mogen gebruiken. Ga wat verder weg staan, zodat we je van top tot teen zien. |
| Bij nee | Er gebeurt niets. Je typt je maten in. |
| C18, weer uitgezet | Het resultaat van de scan wordt gewist. Maten die je hebt ingetypt blijven staan. |

### 3.5 Onthouden, wissen, vergeten

| Id | Bediening | Tekst (beide varianten, tenzij anders vermeld) |
|---|---|---|
| C19 | Schakelaar: **Onthoud mijn foto op dit apparaat** | Uit: je gezicht is weg zodra je dit venster sluit. Aan: het wordt op dit apparaat bewaard, alleen voor deze winkel. Niet bij ons. |
| C20 | Knop: **Wis mijn foto** | Haalt je gezicht, en de kleur die we ervan hebben afgelezen, van dit apparaat. Nu meteen. |
| C21 | Variant B, extra regel onder Wis mijn foto | Bij ons valt niets te wissen. We hebben je foto niet bewaard. |
| C22 | Knop: **Vergeet mij** | Haalt alles weg wat dit hulpje voor deze winkel op dit apparaat heeft bewaard. Het vraagt Curtain ook om het willekeurige nummer te wissen waaraan het dit apparaat herkent. |

The Dutch name for "See it on me" ("Zo staat het mij") is a placeholder; use whatever the embed's Dutch
locale already calls that button; the same goes for "Onthoud mij bij deze winkel" (C30) and "Verstuur"
(C25). "Hulpje" (C22) is a guess at a child-level word for "tool"; a native
editor should confirm it.

## 4. Words this copy must not use

"Anonymous", "100% private", "secure", "nobody can ever see", "never leaves" (in variant B), "may be
sent" (say what does happen; a vague notice is the kind of thing the Australian Bunnings case turned on,
though we could not verify that the word "may" itself was criticised), "biometric", "we only", "locked" or "safe" for the saved face (the encryption keeps other sites out, not
another person using the same device; a child may read "locked" as the second), and any accuracy claim
about the skin tone (plan gate G4).

Illinois note: "biometric" stays banned in the prompt, so C23 and C24 say in plain words what a notice
there would have to say (the face shape is worked out; how long it is kept). Whether those two lines are
enough is brief question 15(c).

## 5. Mapping: every claim to a clause in the draft terms

Terms file: `avatar-privacy-terms-DRAFT.md`. "A" and "B" mark variant-specific claims.

| Claim | What it promises | Terms clause(s) | Must be true in the build |
|---|---|---|---|
| C1 | Everything is off until switched on | T2.4, T3.9 | No camera, picker, photo analysis or upload before the yes for that item. No colour exists to save before Match my skin tone is switched on, even though the existing Remember me is on by default |
| C2 | Size advice works without it | T2.1, T3.7, T6.4 | No feature of the size flow depends on a switch |
| C3 | Shop never sees photo, face, body measurements (the shop does get totals of recommended sizes, per the main policy; hence "measurements", not "sizes") | T8.1 | Nothing in `embed/protocol.ts` messages or merchant data |
| C4 | Not used to recognise, train AI, or for ads | T3.3, T4.9, T8.2, T8.3 | No template, no matching, no training set, no ad use |
| C5 | Age line | T10.1, T10.2 | Age confirmation precedes camera and picker |
| C6 A | Photo used to draw the face | T3.2, T6.1 | |
| C6 B | One photo is sent to Curtain, used to draw the face | T4.1, T4.2, T4.8, T6.1 | Exactly one image per yes. **Conditional:** only if no other company receives the photo, or T4.8 names it; else C6 B-alt |
| C6 B-alt | The photo goes to Curtain and a named provider | T4.8 | Provider under contract and inside the suite |
| C7 A | Photo stays on device, never sent | T3.1 | Privacy e2e: no image MIME, no large body leaves the page |
| C7 B | Deleted right after; not kept | T4.4, T4.5, T4.11, T7.1 | The nothing-stored test (`face-route-nothing-stored-test-spec.md`). **Conditional** as C6 B. "Not kept" means what T4.4 and T4.11 say: no copy left after the answer, as far as the tests can show |
| C7 B-alt | Deleted right after (no "we do not keep it") | T4.5 | |
| C8 B | Head and neck only, never body | T4.2, T3.6 | Crop on device; server refuses anything else |
| C9 A | Switching off removes and deletes the face on the device | T9.1, T9.2 | Memory and stored row both cleared |
| C9 B | Same, and nothing is left at Curtain | T9.2, T9.5, T4.5 | |
| C10 B | On failure the photo was deleted | T4.5 | Error, timeout and cancel paths in the test |
| C11 | Pick by hand or read from photo | T2.2, T3.2 | |
| C12 A | Colour is read on the device | T3.1, T3.2 | |
| C12 B | Read on device; also read from the sent photo | T3.2, T4.6 | |
| C13 | Colour goes with See it on me; only the colour | T5.1, T5.4 | Hero request carries a colour value and no photo, face or measurement (D20.1) |
| C14 | Switching off restores standard colour and deletes the saved colour | T9.2 | |
| C15 | Camera measures; video stays on device, not saved | T3.6 | Existing capture worker and privacy e2e |
| C16 | Scan is never sent | T3.6 | No route accepts body media (AGENTS.md rule 1) |
| C17 | Typing measurements is possible | T3.7 | |
| C18 | Switching off deletes the scan result; typed measurements stay | T9.2 | To be confirmed by engineering |
| C19 | Not remembered unless switched on; then on device, per shop, not on a server | T3.4, T3.5, T7.1, T7.2, T7.3 | The copy no longer says "locked". The terms still promise encryption (T3.5, T12.1), which is more than the copy says, so the rule holds |
| C20 | Delete my photo removes face and photo-read colour from the device at once | T9.3 | |
| C21 B | Nothing to delete at Curtain | T9.5, T4.5, T7.1 | **Conditional** as C6 B; dropped when the alt lines are used |
| C22 | Forget me clears the device for this shop and asks the server to delete the device number record | T9.4 | As the embed's Forget me does today, plus the face rows |
| C23 B | The shape of the face is worked out from the photo | T4.6, T11.4 | The only derived data are those listed in T4.6 |
| C24 B | At most [60] seconds; then photo and shape are gone for good | T4.5, T11.4 | NS-6 timeout case. **Conditional** as C6 B. The number shown must be the server's real limit |
| C25 B | The photo is shown first; sent only on Send | T4.10 | NS-12: no request to the route before the Send press on the preview |
| C26 | A photo is read only after asking; the shopper chooses the final colour | T3.8 | A photo-read tone is never applied without a confirmed swatch (plan gate G4) |
| C27 | The body under the face is an estimate | T2.5 | Label shown whenever a face is on the avatar (AGENTS.md rule 3) |
| C28 | With See it on me the colour goes to Curtain and the image company; gone within a day | T5.1, T7.5, T8.4 | Colour deleted with the See it on me input within 24 hours, backups included or disclosed (T7.4) |
| C29 | The See it on me picture has the standard face | T5.4 | NS-15: hero input built from the neutral figure; fails on any image node, blob reference or face texture |
| C30 | A hand-picked colour is saved on the device when Remember me on this shop is on | T3.9 | Row encrypted, per shop, cleared by Forget me and by switching the item off (plan section 3) |

Known gaps between copy and build, to close before the flag is switched on:

1. **C22 and C3 are narrower than they sound.** After Forget me, billing counts without the device number
   remain on the server (main policy, "How long we keep it"). C22 only promises the device number is
   deleted, which matches. Do not shorten C22 to "deletes everything".
2. **C7 B depends on infrastructure, not only on our code** (proxy buffering, swap, crash dumps, a rented
   GPU). The test spec lists what can and cannot be proven. If a rented GPU provider is used, "Curtain"
   in C6 B is no longer the whole story and T4.8 must name the provider.
3. **C12 B** assumes the server result's skin tone is used. If the build reads the tone only on the
   device, delete the second sentence.
4. **C19** assumes remembering starts off (see section 1).
5. **C18** and the skin-tone part of **C14** describe behaviour nobody has built yet.
6. **Two "remember" switches.** The plan (section 3) saves the skin look under the existing "Remember me
   on this shop", which the main policy says is on by default; the face and the photo-read colour are
   saved only under the new, off-by-default "Remember my photo". C30 and T3.9 describe that split. If the
   founder prefers one rule (nothing about looks is saved without an explicit yes), delete C30, change
   T3.9, and the hand-picked colour lives in memory only. Engineering must pick one before slice 1 ships,
   because slice 1 (hand-picked tone) is the first thing live.
   **Build status, 15 November 2026 (not a decision):** until the founder and Naomi choose, the embed
   keeps the hand-picked colour in memory only and does not show C30. The saved variant described by
   C30 and T3.9 exists behind a build flag that is off (`VITE_AVATAR_REMEMBER_LOOK`). C30 and T3.9 are
   left as written, so either choice can still be made.
7. **C29 is a build condition.** If the hero render is ever made from the on-screen avatar while Use my
   face is on, C7 A, C13 and C29 all become false. The plan already builds the hero input from a
   separate neutral figure (plan line 138); D20 changes only the fill colour.
8. **The main privacy policy (`privacy.md`) contradicts variant B and the D20 colour today.** The exact
   sentences are listed in Appendix C of the draft terms. They must be amended before any flag is on.
9. **C24** shows a number. It must be the limit the server enforces, not a round figure.

## 6. Reading level: a rough check, not a test

Measured on 14 November 2026 with a small throwaway script (not in the repository) over the shopper-facing
table cells of sections 2 and 3 that end in a full stop or question mark, placeholders read as numbers.
The syllable counter is a vowel-group heuristic, so the scores are indicative only. No child and no
reading specialist has read the text.

| | English | Dutch |
|---|---|---|
| Sentences, words | 74, 579 | 78, 598 |
| Words per sentence (longest) | 7.8 (19) | 7.7 (19) |
| Syllables per word (heuristic) | 1.34 | 1.44 |
| Formula score | Flesch Reading Ease 86; Flesch-Kincaid grade 3.3 | Flesch-Douma 89 |
| Usual reading of that score | "easy", about US grade 6 or below | "easy" (the Dutch formula has no grade scale I can vouch for) |

Formula scores only count sentence and word length. They say nothing about whether a 12-year-old knows
the words. Words to test on real readers, or replace: English "estimated" (C27, a label the script did
not count), "standard", "recognise", "provider", "measurements"; Dutch "geschat", "standaardgezicht",
"afgelezen", "willekeurige", "lichaamsmaten". The task asked for the level of a 12-year-old; this check
is consistent with that and does not prove it.
