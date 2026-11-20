# DressingRoom — Handoff for an AI Builder

> Original product handoff from the founder, preserved verbatim (lightly formatted). This is the source of truth for product intent.

## Goal of the product

A mobile-first online dressing room. The user uploads photos/video of themselves once during onboarding and enters body measurements. Paired shops send garment metrics (cut, fabric, drape, stretch, true-size data). The app combines the two and renders how each item realistically fits and looks on this specific user — same proportions, same skin against the same fabric, same drape over their actual body.

The clickable prototype next to this document is the visual & interaction reference. This handoff explains what's mocked vs. what must be built for real, what data flows where, and how to make the try-on look convincing.

## 1. North-star — what "realistic" must mean

When the user opens the dressing room and a coral linen wrap dress appears, three things must be true at the same time:

1. **It looks like them.** Their face, hair, skin tone, body proportions — recognizable, not a generic avatar.
2. **It looks like the actual garment.** The dress fabric drapes the way linen drapes (not like polyester, not like wool). Color matches the shop's product photo. The cut (wrap, A-line, midi length) reads correctly.
3. **It looks like that garment on that body.** A size M wrap dress on a 168 cm / 62 kg body with 88-70-96 measurements has different ease at the waist, falls to a specific point on their leg, and pulls or doesn't pull across the bust. The render must reflect this.

If any of those three fails, the user buys the wrong thing and returns it. The whole product loses.

## 2. Onboarding — capturing the user

The onboarding flow in the prototype shows the order: welcome → measurements → style vibes → avatar tone. For the real build, replace the "skin/hair color picker" step with a capture step that collects photos and/or a short video.

### 2.1 Capture step (replaces the "tone" picker in the prototype)

Three sub-steps, all on-device:

**A. Face & hair (one photo, front-facing)**
- Front-lit, neutral background, hair pulled away from face if possible
- Captures: skin tone (multi-point sample, not single pixel), undertone (warm/cool/neutral), hair color, hair length, face shape, eye color
- Output: a small identity tile (face crop + cleaned background) used as the avatar's head

**B. Body scan (short video, ~8 seconds)**
- User stands ~2 m from camera in fitted clothing (or underwear). Slow 360° turn.
- App detects pose, fits a parametric body model (SMPL-X or similar — see §6), extracts:
  - silhouette outline at 12 key cross-sections (neck, shoulders, chest, underbust, waist, hip, thigh, knee, calf, ankle, upper arm, wrist)
  - posture defaults (slight forward lean, neutral, etc.)
  - skin shading map (so the body model isn't flat-shaded)
- Output: a personalized 3D body mesh + a 2D silhouette atlas for fast 2D rendering

**C. Manual measurements (the screen we already built)**
- Height, weight, bust, waist, hip, foot EU
- Used to correct the scan (people undersell or oversell themselves; the scan keeps it honest)
- Confidence score per measurement: scan-only → 60%, scan+manual agreeing → 95%, conflict → ask user to remeasure that one

### 2.2 Privacy posture (non-negotiable)

Raw photos and video never leave the device. The body mesh + measurements are derived locally and stored locally.

What syncs to backend: the fit-only signature — a numeric body vector (~80 floats) that lets shops answer "does size M fit?" without ever seeing a picture or a measurement.

Show this in the UI exactly the way the prototype does on the profile/privacy screen and the merchant "Privacy ledger" panel.

### 2.3 Avatar in the prototype vs. real build

- Prototype: stylized SVG silhouette, color picker for skin/hair, watermark "placeholder · not ML."
- Real build: photoreal personalized avatar from the capture step. The visual treatment everywhere else (the mirror frame, the lighting, the cream backdrop) stays the same — only the body inside the mirror changes.

## 3. Garment data — what shops must send

Pairing a shop is the moment the app gets garment data. The merchant console in the prototype hints at this; here's the full schema the integration must support.

### 3.1 Per-item payload (shop → DressingRoom)

```jsonc
{
  "id": "aalter-studio-1",
  "brand": "Aalter Studio",
  "name": "Linen Wrap Dress",
  "category": "dress",            // top|bottom|dress|outerwear|shoes|accessory
  "subcategory": "wrap-midi",
  "priceEur": 149,

  // Visuals
  "primaryColorHex": "#C97A4F",
  "colorways": [...],
  "productPhotos": ["..."],       // for color-grading + texture sampling
  "flatLayPhoto": "...",          // critical: garment laid flat on white

  // Construction
  "fabric": {
    "primary": "linen",            // linen|cotton|wool|silk|cashmere|tencel|modal|denim
    "blend": [["linen", 100]],
    "weightGsm": 240,
    "stretchPct": 2,               // 0=non-stretch, 30=jersey
    "drape": 0.78,                 // 0=stiff, 1=fluid
    "opacity": 0.92,                // 0=sheer, 1=opaque
    "sheen": 0.15                   // 0=matte, 1=shiny
  },

  // Pattern / fit (the most important part)
  "patternBlock": "wrap",            // wrap|a-line|sheath|column|...
  "ease": {                          // garment minus body, in cm
    "bust": 6, "waist": 4, "hip": 8
  },
  "lengthCm": {                      // measured points
    "shoulder_to_hem": 118,
    "shoulder_to_waist": 41,
    "sleeve_length": 0
  },
  "sizeChart": [
    { "size": "XS", "bust": 84, "waist": 64, "hip": 92, "shoulder": 36 },
    { "size": "S",  "bust": 88, "waist": 68, "hip": 96, "shoulder": 37 }
  ],
  "sizingNotes": "runs small",       // freeform; affects fit-engine offset
  "trueToSizeScore": 0.92,           // from past return/fit data

  // Fit-engine hints
  "criticalFitPoints": ["bust", "shoulder"], // where this garment cares most
  "stretchZones": ["waist-tie"]
}
```

The prototype's data.js already mocks ~50 items; replace it with this richer schema and the rest of the app cascades.

### 3.2 What the shop integration looks like in code

The prototype shows the UX: a "Try in DressingRoom" button on the shop's product page and the QR-code handshake. For the real build:

- JS SDK (`<script src="https://cdn.dressingroom.app/sdk.js">`) drops into the merchant's site
- `<button data-dressingroom-product="aalter-studio-1">Try in DressingRoom</button>` — that's it for the merchant
- SDK opens a deep link to the app with the product ID + shop ID
- App asks the shop's API for the full garment payload (above)
- App computes fit + render and shows it in the mirror

## 4. The fit engine — combining body × garment

This is the math layer behind the swipe deck. It turns "user U + garment G in size S" into:
- A fit score — does it fit at all?
- A recommended size — XS, S, M, L, XL
- A render — what it looks like on them

### 4.1 Fit score

For each garment's `criticalFitPoints` and the matching size's chart entry, compare to the user's body measurement:

```
gap_at_point = garment_size_at_point - (user_body_at_point + ease_required_for_category)
```

- gap < -2 cm: too tight, bad fit
- -2 ≤ gap < 0: snug, fine for some categories (e.g. fitted dresses)
- 0 ≤ gap ≤ ease_target + 2: good fit
- gap > ease_target + 4: too loose, bad fit

Weight by `criticalFitPoints` (the wrap dress cares about bust + shoulder; ignore hip if pattern is A-line and flares freely). Aggregate to a score 0–1.

### 4.2 Size recommendation

Run the score for every size in the chart, pick the highest. Tie-break with `sizingNotes` ("runs small" → bias up one), then with the user's history of kept-vs-returned items.

### 4.3 The render — three approaches, ranked

**Path A — full 3D garment simulation (the dream)**
- Drape a garment mesh over the user's SMPL-X body using a physics solver (e.g. NVIDIA's Warp cloth, or a learned model like TailorNet / DrapeNet)
- Photoreal. Handles every angle. Expensive.

**Path B — 2D parametric warp (recommended for v1)**
- Take the merchant's flat-lay photo. Warp it onto the user's silhouette using a category-specific UV map, the user's silhouette atlas, and the drape coefficient from `fabric.drape`
- Composite onto a render of the user's body model with their skin tone, hair, face from §2.1A
- Looks ~90% as good as path A for static/single-pose mirror view. Runs on a phone.

**Path C — neural try-on (TryOnDiffusion, OOTDiffusion, IDM-VTON style)**
- Diffusion model takes (user photo, garment photo) → composited image
- Quality is now very high for upper-body garments; mid-body is improving
- Requires GPU inference; budget ~600 ms per render on a server
- Use as a fallback when path B doesn't have enough metrics, or as the shareable hero image

### 4.4 What the prototype's avatar maps to

The current AvatarSilhouette component is a placeholder for path B. Its structure (body silhouette + category-specific garment overlay tinted to primaryColorHex) is exactly the input the real renderer needs — replace the SVG layers with photoreal output and the rest of the app keeps working.

## 5. The swipe deck — what the data does

- **→ love**: log itemId + size recommended at swipe time
- **← pass**: log itemId + reason inferred (color far from liked palette? fit score low? price too high?)
- **↑ save**: same as love + add to wardrobe + push to backend so the user sees it on web/desktop
- **↓ less like this**: strong negative signal — penalize that color × fabric × cut combo for the next 50 cards

The Style DNA radar (TasteRadial) is fed by these signals. In production, expand to include silhouette preferences.

## 6. Tech stack — concrete recommendations (original)

| Layer | Choice | Why |
|---|---|---|
| Mobile shell | React Native + Expo, or native | The prototype is React; sharing components with a web fallback is easy |
| Body model | SMPL-X | Industry standard, parametric |
| Body scan | MediaPipe Pose + custom mesh fit, or ARKit body tracking on iOS | On-device, privacy-preserving |
| Face/skin extraction | MediaPipe Face Mesh + ITA for skin tone | Robust across lighting |
| Cloth render — v1 | 2D parametric warp on Skia/Canvas | Ships in weeks |
| Cloth render — v2 | Cloth physics in Three.js, or NVIDIA Warp on server | When budget allows |
| Cloth render — fallback | Hosted IDM-VTON or OOTDiffusion endpoint | For shareable images and edge cases |
| Local DB | SQLite for measurements + wardrobe | Keep raw scan data here, never on server |
| Sync | Only the fit signature (~80 floats) and swipe events | Privacy ledger stays honest |
| Merchant SDK | Tiny vanilla JS, ~5 KB | Drop-in for any shop platform |

## 7. Design system — what's already decided

- Coral `#FF5A3C` accent · warm cream `#F5EFE7` background · ink `#1A1612` text
- Fraunces for display + serif accents · Inter for UI
- The mirror frame, the four-button action ring, the radial Style DNA chart, the cohort bars, the privacy ledger layout — all production-ready visual patterns
- Respect the placeholder disclaimer pattern: whenever a render is generated rather than measured, label it. Don't pretend.

## 8. What to build first (eight-week MVP cut)

1. Onboarding capture — photo + video + measurements → personalized body mesh + face tile.
2. Garment payload schema + merchant SDK — get one real shop sending real data end-to-end.
3. Fit engine v1 — fit score + size recommendation. Text-only is acceptable.
4. Render path B — 2D parametric warp on the personalized body.
5. The swipe deck + Style DNA — rewire to real renders.
6. Wardrobe & Rooms — saved fits, drop-and-react with friends.
7. Merchant console — shippable once real data flows.
8. Render path A or C — upgrade the renderer for hero moments.

## 9. The bar for "done"

1. **The recognition test.** The user should recognise their own avatar at a glance.
2. **The fabric test.** Linen vs. wool vs. silk should drape visibly differently.
3. **The size test.** S / M / L on the same user should read as tight / fits / loose without labels.

---

## Founder's overall plan (verbatim notes)

- Kledingpassen app: een app waar mensen een profiel kunnen aanmaken met hun lichaam (100% privacy safe). Een plugin om data op te halen uit de webstore.
- Connect with the app and fit. On website "changingroom".
- Colormatching with skin and hair.
- Shop together (shopping spree): invite mensen om mee te komen shoppen, chat function asynchroon.
- Betaling per maand shopowner en gratis voor customer. Of per API call.
- Personalized: in de app een link en er wordt een selectie gemaakt.
- Prediction for storeowner door advies te geven over wat in te kopen op basis van kleuren, materiaal, maten enz.
- Wil je naar de kapper, wil je makeup op enz. om avatar in de situatie passend te maken (bijv. iemand koopt een jurk voor een feestje).
- Afgebroken sales analyseren.
- Waarschuwing: images alleen in de app weergeven.
- 2-sided: app en plugin. Plugin betaald, app free. Ads voor shopowners alleen aan en uit. De app weet wie te targeten.
- Pay through the app.
- Personal shopping assistent.
- Include a disclaimer dat het een estimate is hoe het er in het echt uit zal zien.
- Profiel per stof vs gewicht.
- Websites om aan te verkopen: Temu, Etsy, Amazon, Shein en andere grotere merken.
- Fun, low key en als echte shopping experience.
- Eindbeeld: Shopify/WordPress plugin aan de merchant-kant, app aan de gebruikerskant.

## Decisions delegated to the builder (Nov 2026)

- Builder chooses the product name.
- Builder decides the stack; hosting may move to the founder's own VPS.
- The AI provider is not fixed to Gemini — any engine may be used. API keys must never ship to the client.
- On-device body scan is the ideal.
- Legal/privacy review follows later; architecture must keep raw images on-device.
- Research AI engines that can produce realistic try-on from product photos + standard webshop data (quantity, fabric type, etc.). Founder noted Grok could generate a realistic video from a photo where fabric draped correctly.
