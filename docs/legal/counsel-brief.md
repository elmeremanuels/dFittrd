# Brief for counsel: the avatar's face, skin tone and body scan

To: Naomi
From: Curtain (founder). Drafted 14 November 2026 by an AI agent, not a lawyer.
Reply needed by: [DATE]. The photo-based face stays switched off until you have answered (decision D20).

Attached: `avatar-consent-copy.md` (the prompt text, English and Dutch), `avatar-privacy-terms-DRAFT.md`
(the text behind the link, with notes on the law and sources in its appendices), and
`face-route-nothing-stored-test-spec.md` (how engineering will prove the deletion claim).

## 1. What we ask of you

Answer the numbered questions in section 5, in order (group 1 blocks the pilot), and mark up the two
texts where the plain copy promises more than the terms, or the terms more than the law allows.

## 2. Facts

- Curtain is a size-advice tool that online clothing shops put on their product pages. It opens in a
  frame on the shop's page, served from Curtain's domain. Shoppers are anonymous: no name, e-mail or
  account, only a random device number. The shop sees totals only.
- The pilot shop is in Australia. Curtain's company and servers are in [COUNTRY / REGION, EU expected].
  Shoppers can come from anywhere, including the EU, the UK and the United States.
- The tool shows an avatar wearing the garment. Tapping the avatar opens a prompt with three switches,
  all off at the start: **Use my face**, **Match my skin tone**, **Scan my body**. The size advice works
  the same without them.
- None of the photo features is built yet. Skin tone picked by hand (no photo) ships first.

## 3. Data flow

**Variant A: on the device only (the plan of record).**

1. The shopper says yes, then takes or picks a photo. Curtain's code, running in the shopper's browser,
   reads it. It is not uploaded.
2. The code finds about 478 points on the face (a standard face-landmark model), uses them to cut and
   place the face on the avatar's head, and reads a skin and hair colour. The points are then discarded.
   No face template is made; nothing is compared with any other face.
3. Results (a small face picture, a face picture shaped for the 3D head, a colour value) stay in the
   browser's memory. If the shopper switches on "Remember my photo on this device", they are saved in the
   browser's storage, encrypted, per shop site. Never on a server.
4. Body scan: an 8-second camera view is measured in the browser. No frame is stored or sent. This part
   already exists.
5. One value can reach a server: if the shopper separately asks for a "See it on me" picture (existing
   opt-in), the chosen skin colour value goes with the generated avatar image to Curtain and on to an
   image-generation provider; deleted within 24 hours.

**Variant B: the face route (allowed by decision D19; built only if variant A looks poor).**

1. The shopper says yes to "Use my face" for one photo. The browser crops it to head and neck and sends
   it over HTTPS to Curtain's server [possibly passed on to a rented GPU provider in the EU].
2. The server builds a face picture, a head shape and a skin colour in working memory. It writes nothing
   to disk, logs or backups, and keeps no template.
3. It returns the result to the browser and deletes the photo and all derived data, at most [60] seconds
   after receipt, also on failure.
4. The server keeps a record without image data (time, size, outcome) and a short-lived request count
   per IP address against abuse.
5. From there, as variant A steps 3 to 5. A body photo is never accepted, with or without consent.

## 4. Our working position (please correct it)

The face is not used to identify anyone, so it is probably not "biometric data" (GDPR Art. 4(14), 9) or
"sensitive information" (Privacy Act 1988); we ask for explicit per-item consent anyway. Variant A leaves
Curtain holding nothing. Variant B is a collection everywhere, however short. Illinois is the main
financial risk.

## 5. Questions, ordered by what blocks launch

**Group 1: blocks the pilot (variant A, Australian shop)**

1. **Is on-device face processing for display "biometric data" or sensitive information?** Under GDPR
   Art. 4(14) and 9, the UK GDPR, and s 6(1) of the Privacy Act 1988 (biometric information "to be used
   for" automated verification or identification; biometric templates). Does finding face points count
   as a template, even if discarded within the same step? Does Curtain "collect" or "process" anything
   at all when the data never reaches it?
2. **Who is controller, and is the shop a joint controller or are we its processor?** The shop embeds
   the tool and switches the feature on; Curtain designs it and holds whatever is held. (We have the
   Court of Justice's Fashion ID ruling in mind.) What must the merchant terms and the shop's own
   privacy policy say? Who answers a shopper's request?
3. **Is the consent valid as explicit consent (GDPR Art. 9(2)(a)) and as consent under APP 3.3?** One
   switch per item, off by default, a yes button with equal weight to no, a link to the terms. Does
   "Remember my photo" need its own consent, and may it ever default to on?
4. **Minors.** Which age line (16, 18, per country)? Is a statement by the shopper enough, or is an age
   check needed? What changes when Australia's Children's Online Privacy Code is registered (due by 10
   December 2026)?
5. **Does the Privacy Act apply to Curtain at all** (foreign company, small business exemption), and
   does it matter given we say we follow the Principles?
6. **Is a skin colour value special-category or sensitive data** (racial or ethnic origin)? It is picked
   or confirmed by the shopper, never used to infer origin, stored on the device, and since decision D20
   sent with "See it on me" to our server and an image provider. Does that send need its own consent
   line beyond the existing See it on me consent?
7. **Is the copy accurate enough?** In particular "The shop never sees ...", "locked", "Forget me", and
   the age line. Anything a regulator would call misleading?

**Group 2: blocks variant B anywhere**

8. **Momentary processing.** The Australian tribunal in the Bunnings matter ([2026] ARTA 130) reportedly
   treated face data held in memory for a fraction of a second as collected. Do you agree variant B is a
   collection of sensitive information under APP 3.3 and special-category processing under Art. 9? Is it
   "reasonably necessary" when variant A exists?
9. **A rented GPU provider** as sub-processor: acceptable, and on what contract terms? Does "We send one
   photo to Curtain" remain true enough, or must the prompt name the provider?
10. **"It is deleted right after. We do not keep it."** Read the test specification's section on what
    cannot be proven (memory managed by the runtime, the host). Is the sentence defensible? Would you
    prefer different words?
11. **Data protection impact assessment** (GDPR Art. 35): required for A, for B, or both? Who writes it?
12. **Transfers.** Australian shopper, EU server (APP 8); US shopper, EU server. Anything beyond notice?

**Group 3: blocks offering the photo features to US shoppers**

13. **Illinois BIPA.** (a) Are face points or the fitted face picture a "scan of face geometry", given
    photographs are excluded but try-on cases have gone forward (most recently Clements v. Gunnar Optiks,
    7th Cir., July 2026)? (b) Does G.T. v. Samsung (7th Cir., August 2026: data that stays on the
    user's device is not possessed or collected by the software maker) cover variant A, and how much
    weight can we put on it in Illinois state courts? (c) For variant B: is pressing "Yes, send my
    photo" under the written notice in clause T11.4 a valid written release (electronic signature), and
    is that clause a sufficient public retention policy?
14. **Texas (s. 503.001) and Washington (RCW 19.375 and the My Health My Data Act).** Does display
    count as a "commercial purpose"? Do we need a separate Consumer Health Data Privacy Policy in
    Washington? Other states we must treat the same way?
15. **Should we block regions, and how?** Options: (a) no block; (b) variant B, or all photo features,
    switched off for shops that sell to the United States, set per shop, with no location lookup;
    (c) blocking by the shopper's IP address, which is itself a use of location data. Which do you
    advise for Illinois, and for the US as a whole?
16. **US children** under 13 (COPPA lists facial templates): is the age line enough?

**Group 4: does not block**

17. EU AI Act: we do no identification, emotion recognition or categorisation. Any duty we miss? And if
    the terms change later, is resetting the switches to off and asking again (clause T13.1) right?

## 6. What we know we have not done

No lawyer has seen any of this. Statute wording was checked through excerpts on 14 November 2026;
several official sites could not be opened and the two Seventh Circuit opinions and the Bunnings
decision were read only in law-firm summaries (see Appendix B of the draft terms). No impact assessment
exists. The merchant terms have not been touched. The Dutch copy has not been checked by a native
editor. Only the jurisdictions named above were looked at.
