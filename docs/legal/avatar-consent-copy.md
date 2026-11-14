# Avatar prompt: plain-language consent copy (English and Dutch)

> **DRAFT for Naomi's review (D20.4). Not in force, not built.** Written 14 November 2026 by an AI agent,
> not a lawyer. The photo-based face stays behind its flag until she has answered.

This is the exact text for the prompt that opens when a shopper taps the avatar (decision D19). The full
legal text is one tap away: `avatar-privacy-terms-DRAFT.md`.

**The rule (D19):** the plain text never promises more than the legal text. Every claim below has an id
(C1, C2, ...) and section 5 maps each one to a clause in the draft terms. If a clause changes, the claim
changes with it. If engineering cannot make a clause true, the claim goes, not the test.

**Reading level:** written for a 12-year-old. Short sentences, common words, no "process", "biometric"
or "data". Not measured with a readability tool, and not tested on readers.

**Two variants.** A shop runs one:

- **Variant A, on-device only.** The photo never leaves the device.
- **Variant B, D19 face route.** One head-and-neck photo is sent, used in memory, deleted on return.

The copy differs only where marked. Never mix them: variant A text on a variant B build would be false.

## 1. Layout and switch states

| Element | State when the prompt first opens | Notes |
|---|---|---|
| Use my face | Off | Hidden when the shop's `face` flag is off (plan gate G7) |
| Match my skin tone | Off (standard colour) | Picking a colour by hand needs no camera and no age line |
| Scan my body | Off | Typed measurements are the default (D19) |
| Remember my photo on this device | Off | Shown only once Use my face is on. D20.2 allows remembering; this copy makes it a choice that starts off. If the founder wants it on by default, C14 and T3.5 must both change and Naomi must see it |
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
| | Label under the avatar when a face is shown | Your face on an estimated body |

### 2.2 Use my face

| Id | Variant A (on-device) | Variant B (face route) |
|---|---|---|
| C6 | We use a photo of your face to draw your face on the avatar. | We send one photo of your face to Curtain. We use it to draw your face on the avatar. |
| C7 | The photo stays on your device. It is never sent to us. | It is deleted right after. We do not keep it. |
| C8 | (none) | Only your head and neck. Never your body. |
| Yes button | **Yes, use my photo** | **Yes, send my photo** |
| No button | **No, keep the standard face** | **No, don't send it** |

| Moment | Variant A | Variant B |
|---|---|---|
| Off (start) | The avatar has a standard face. | The avatar has a standard face. |
| On yes | Your device asks if we may use the camera. You can also pick a photo you already have. | Your device asks if we may use the camera. You can also pick a photo you already have. Then we show you the photo before it is sent. |
| On no | Nothing happens. The avatar keeps the standard face. | Nothing is sent. The avatar keeps the standard face. |
| C9, switched off again | Your face is taken off the avatar and deleted from this device. | Your face is taken off the avatar and deleted from this device. We have nothing left to delete, because we did not keep your photo. |
| C10, when it fails (B only) | (none) | That did not work. Your photo was deleted. Try again? |

### 2.3 Match my skin tone

| Id | Variant A | Variant B |
|---|---|---|
| C11 | Pick your skin colour yourself. Or let us read it from your photo. | Pick your skin colour yourself. Or let us read it from your photo. |
| C12 | Reading it happens on your device. | Reading it happens on your device. If you sent us a photo for your face, we read the colour from that one too. |
| C13 | If you ask for a "See it on me" picture, the colour goes along. Only the colour, no photo. | If you ask for a "See it on me" picture, the colour goes along. Only the colour, no photo. |

| Moment | Both variants |
|---|---|
| Off (start) | The avatar has a standard colour. |
| On yes | Pick a colour from the row. If you want us to read it from a photo, we ask first. You always choose the final colour. |
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
| C19 | Switch: **Remember my photo on this device** | Off: your face is gone when you close this window. On: it is saved on this device, locked, for this shop only. Not with us. |
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
| | Label onder de avatar als er een gezicht staat | Jouw gezicht op een geschat lichaam |

### 3.2 Gebruik mijn gezicht

| Id | Variant A (alleen op je apparaat) | Variant B (foto naar Curtain) |
|---|---|---|
| C6 | We gebruiken een foto van je gezicht om jouw gezicht op de avatar te tekenen. | We sturen één foto van je gezicht naar Curtain. Daarmee tekenen we jouw gezicht op de avatar. |
| C7 | De foto blijft op je apparaat. Hij wordt nooit naar ons gestuurd. | Hij wordt meteen daarna gewist. We bewaren hem niet. |
| C8 | (geen) | Alleen je hoofd en hals. Nooit je lichaam. |
| Ja-knop | **Ja, gebruik mijn foto** | **Ja, stuur mijn foto** |
| Nee-knop | **Nee, houd het standaardgezicht** | **Nee, niet sturen** |

| Moment | Variant A | Variant B |
|---|---|---|
| Uit (begin) | De avatar heeft een standaardgezicht. | De avatar heeft een standaardgezicht. |
| Bij ja | Je apparaat vraagt of we de camera mogen gebruiken. Je kunt ook een foto kiezen die je al hebt. | Je apparaat vraagt of we de camera mogen gebruiken. Je kunt ook een foto kiezen die je al hebt. Daarna laten we je de foto zien voordat hij wordt verstuurd. |
| Bij nee | Er gebeurt niets. De avatar houdt het standaardgezicht. | Er wordt niets verstuurd. De avatar houdt het standaardgezicht. |
| C9, weer uitgezet | Je gezicht gaat van de avatar af en wordt van dit apparaat gewist. | Je gezicht gaat van de avatar af en wordt van dit apparaat gewist. Bij ons valt niets meer te wissen, want we hebben je foto niet bewaard. |
| C10, als het mislukt (alleen B) | (geen) | Dat lukte niet. Je foto is gewist. Nog een keer proberen? |

### 3.3 Mijn huidskleur

| Id | Variant A | Variant B |
|---|---|---|
| C11 | Kies zelf je huidskleur. Of laat ons die van je foto aflezen. | Kies zelf je huidskleur. Of laat ons die van je foto aflezen. |
| C12 | Dat aflezen gebeurt op je apparaat. | Dat aflezen gebeurt op je apparaat. Heb je ons een foto gestuurd voor je gezicht? Dan lezen we de kleur ook van die foto af. |
| C13 | Vraag je om een plaatje "Zo staat het mij"? Dan gaat de kleur mee. Alleen de kleur, geen foto. | Vraag je om een plaatje "Zo staat het mij"? Dan gaat de kleur mee. Alleen de kleur, geen foto. |

| Moment | Beide varianten |
|---|---|
| Uit (begin) | De avatar heeft een standaardkleur. |
| Bij ja | Kies een kleur uit de rij. Wil je dat we de kleur van een foto aflezen? Dan vragen we dat eerst. Jij kiest altijd de kleur die het wordt. |
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
| C19 | Schakelaar: **Onthoud mijn foto op dit apparaat** | Uit: je gezicht is weg zodra je dit venster sluit. Aan: het wordt op dit apparaat bewaard, op slot, alleen voor deze winkel. Niet bij ons. |
| C20 | Knop: **Wis mijn foto** | Haalt je gezicht, en de kleur die we ervan hebben afgelezen, van dit apparaat. Nu meteen. |
| C21 | Variant B, extra regel onder Wis mijn foto | Bij ons valt niets te wissen. We hebben je foto niet bewaard. |
| C22 | Knop: **Vergeet mij** | Haalt alles weg wat dit hulpje voor deze winkel op dit apparaat heeft bewaard. Het vraagt Curtain ook om het willekeurige nummer te wissen waaraan het dit apparaat herkent. |

The Dutch name for "See it on me" ("Zo staat het mij") is a placeholder; use whatever the embed's Dutch
locale already calls that button. "Hulpje" (C22) is a guess at a child-level word for "tool"; a native
editor should confirm it.

## 4. Words this copy must not use

"Anonymous", "100% private", "secure", "nobody can ever see", "never leaves" (in variant B), "may be
sent" (the Australian tribunal in the Bunnings case found "may" too vague for a notice; say what does
happen), "biometric", "we only", and any accuracy claim about the skin tone (plan gate G4).

## 5. Mapping: every claim to a clause in the draft terms

Terms file: `avatar-privacy-terms-DRAFT.md`. "A" and "B" mark variant-specific claims.

| Claim | What it promises | Terms clause(s) | Must be true in the build |
|---|---|---|---|
| C1 | Everything is off until switched on | T2.4 | No camera, picker, photo analysis or upload before the yes for that item |
| C2 | Size advice works without it | T2.1, T6.4 | No feature of the size flow depends on a switch |
| C3 | Shop never sees photo, face, body measurements (the shop does get totals of recommended sizes, per the main policy; hence "measurements", not "sizes") | T8.1 | Nothing in `embed/protocol.ts` messages or merchant data |
| C4 | Not used to recognise, train AI, or for ads | T3.3, T4.9, T8.2, T8.3 | No template, no matching, no training set, no ad use |
| C5 | Age line | T10.1, T10.2 | Age confirmation precedes camera and picker |
| C6 A | Photo used to draw the face | T3.2, T6.1 | |
| C6 B | One photo is sent to Curtain, used to draw the face | T4.1, T4.2, T6.1 | Exactly one image per yes |
| C7 A | Photo stays on device, never sent | T3.1 | Privacy e2e: no image MIME, no large body leaves the page |
| C7 B | Deleted right after; not kept | T4.4, T4.5, T7.1 | The nothing-stored test (`face-route-nothing-stored-test-spec.md`) |
| C8 B | Head and neck only, never body | T4.2, T3.6 | Crop on device; server refuses anything else |
| C9 A | Switching off removes and deletes the face on the device | T9.1, T9.2 | Memory and stored row both cleared |
| C9 B | Same, and nothing is left at Curtain | T9.2, T9.5, T4.5 | |
| C10 B | On failure the photo was deleted | T4.5 | Error, timeout and cancel paths in the test |
| C11 | Pick by hand or read from photo | T2.2, T3.2 | Shopper always confirms a swatch (G4) |
| C12 A | Colour is read on the device | T3.1, T3.2 | |
| C12 B | Read on device; also read from the sent photo | T3.2, T4.6 | |
| C13 | Colour goes with See it on me; only the colour | T5.1 | Hero request carries a colour value and no photo, face or measurement (D20.1) |
| C14 | Switching off restores standard colour and deletes the saved colour | T9.2 | |
| C15 | Camera measures; video stays on device, not saved | T3.6 | Existing capture worker and privacy e2e |
| C16 | Scan is never sent | T3.6 | No route accepts body media (AGENTS.md rule 1) |
| C17 | Typing measurements is possible | T3.7 | |
| C18 | Switching off deletes the scan result; typed measurements stay | T9.2 | To be confirmed by engineering |
| C19 | Not remembered unless switched on; then on device, encrypted, per shop, not on a server | T3.4, T3.5, T7.1, T7.2, T7.3, T12.1 | "Locked" means encrypted (AES-GCM, key not extractable) |
| C20 | Delete my photo removes face and photo-read colour from the device at once | T9.3 | |
| C21 B | Nothing to delete at Curtain | T9.5, T4.5, T7.1 | |
| C22 | Forget me clears the device for this shop and asks the server to delete the device number record | T9.4 | As the embed's Forget me does today, plus the face rows |

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
