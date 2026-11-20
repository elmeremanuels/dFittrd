# Brief for counsel: the avatar's face, skin tone and body scan

To: Naomi. From: Curtain (founder). Drafted 14 November 2026 by an AI agent, not a lawyer.
Reply needed by: [DATE]. The photo-based face stays switched off until you have answered (decision D20).

Attached: `avatar-consent-copy.md` (prompt text, English and Dutch), `avatar-privacy-terms-DRAFT.md`
(the text behind the link; law notes, sources and what was not read are in its Appendices A and B; the
sentences in our main policy that become false are in Appendix C), and
`face-route-nothing-stored-test-spec.md` (how engineering will prove the deletion claim).

**We ask you** to answer the questions below in order (group 1 blocks the pilot) and to mark where the
plain copy promises more than the terms, or the terms more than the law allows. Nothing here has been
seen by a lawyer; cases were read in law-firm summaries only.

## 1. Facts

- Curtain is a size-advice tool that clothing shops put on product pages, in a frame served from
  Curtain's domain. Shoppers are anonymous: no name or account, only a random device number. The shop
  sees totals only.
- The pilot shop is in Australia. Curtain's company and servers are in [COUNTRY / REGION, EU expected].
  Shoppers can come from anywhere, including the EU, the UK and the United States.
- Tapping the avatar opens a prompt with three switches, all off: **Use my face**, **Match my skin
  tone**, **Scan my body**. Size advice works without them. No photo feature is built yet; skin tone
  picked by hand ships first.

## 2. Data flow

**Variant A, on the device only (plan of record).** The shopper says yes and takes or picks a photo.
Curtain's code in the browser finds about 478 face points, uses them to place the face on the avatar,
reads a skin and hair colour, and discards the points. No template, no comparison, no upload. It also
places the colour on a ten-step skin-tone scale (Monk) and reads an undertone, to suggest a swatch; the
shopper confirms the colour. Results stay in memory, or, with "Remember my photo on this device" (off by
default), encrypted in the browser's storage per shop. A hand-picked colour is saved under the existing
"Remember me" switch, which is on by default. The body scan (8 seconds of camera, measured in the
browser, nothing stored or sent) already exists. One value can reach a server: if the shopper asks for a
"See it on me" picture (existing opt-in), the skin colour value goes with a standard-face avatar image
to Curtain and an image-generation provider; deleted within 24 hours.

**Variant B, the face route (D19; built only if A looks poor).** After yes, the browser crops the photo
to head and neck, shows it, and on **Send** uploads it over HTTPS to Curtain's server [possibly a rented
GPU provider]. The server builds a face picture, a head shape and a skin colour in memory, returns them,
and deletes photo and derived data within [60] seconds, also on failure. It keeps a record without image
data (time, byte size, duration, outcome) and a short-lived request count per IP address. Then as
variant A. A body photo is never accepted.

**Our working position (please correct it):** the face is not used to identify anyone, so it is probably
not biometric data (GDPR Art. 4(14), 9) or sensitive information (Privacy Act 1988); we ask for explicit
per-item consent anyway. Variant B is a collection everywhere, however short. Illinois is the main
financial risk.

## 3. Questions, ordered by what blocks launch

**Group 1: blocks the pilot (variant A, Australian shop)**

1. **Is on-device face processing for display biometric data or sensitive information** (GDPR Art.
   4(14) and 9; UK GDPR; Privacy Act s 6(1))? Do face points count as a template if discarded in the
   same step? Does Curtain "collect" or "process" anything when the data never reaches it?
2. **Controller or processor?** The shop embeds the tool and switches the feature on; Curtain designs it
   (compare Fashion ID, C-40/17). Is the shop a joint controller? What must the merchant terms and the
   shop's policy say, and who answers a shopper's request?
3. **Is the consent valid** as explicit consent (Art. 9(2)(a)) and under APP 3.3: one switch per item,
   off by default, equal yes and no buttons, a link to the terms? May "Remember my photo" ever default
   to on?
4. **Minors.** Which age line (16, 18, per country)? Statement or age check? What changes with
   Australia's Children's Online Privacy Code (due by 10 December 2026)?
5. **Does the Privacy Act apply to Curtain** (foreign company, small business exemption)?
6. **Is skin colour special-category or sensitive data** (racial or ethnic origin)? Consider the bare
   colour value and also the Monk scale step and undertone the browser computes (terms T3.2). The colour
   is confirmed by the shopper, never used to infer origin, and since D20 sent with See it on me to our
   server and an image provider. Does that send need its own consent line?
7. **Is the copy accurate enough?** In particular "The shop never sees ...", "saved on this device, for
   this shop only" (we dropped "locked"), "Forget me", "gone within a day", and the age line.
8. **Storing on the shopper's device** (ePrivacy Art. 5(3), Telecommunicatiewet art. 11.7a, UK PECR):
   is the yes to "Remember my photo" enough, and may a hand-picked skin colour be saved under the
   default-on "Remember me" (terms T3.9)?
9. **The main privacy policy contradicts these texts** (Appendix C lists the sentences, for example
   "Photos and video never leave your device"). Must it be amended before slice 1, or only before a
   photo feature goes live? Is "these terms apply where the two differ" ever enough?

**Group 2: blocks variant B anywhere**

10. **Momentary processing.** Summaries of Bunnings ([2026] ARTA 130) say there is no minimum time for a
    collection. Is variant B a collection of sensitive information (APP 3.3) and Art. 9 processing? Is
    it "reasonably necessary" when variant A exists?
11. **Hosting and a rented GPU provider** as sub-processors: on what contract terms? Must the prompt
    name them (the copy has fallback lines)? Is passing the photo to them a "disclosure"?
12. **"It is deleted right after. We do not keep it."** Read terms T4.11 and section 5 of the test
    specification (what cannot be proven). Is the sentence defensible, or do you prefer the fallback?
13. **Impact assessment** (GDPR Art. 35): for A, for B, or both?
14. **Transfers.** Australian shopper to an EU server and to the image provider (APP 8); US shopper to
    the EU. Anything beyond notice?

**Group 3: blocks offering photo features to US shoppers**

15. **Illinois BIPA.** (a) Are face points or the fitted face picture a "scan of face geometry", given
    the try-on cases (Clements v. Gunnar Optiks, 7th Cir., July 2026)? (b) Does G.T. v. Samsung (7th
    Cir., August 2026) cover variant A, and what is it worth in state courts? (c) Variant B: the prompt
    says in plain words that the photo is sent, that the shape of the face is worked out, and that both
    are gone within [60] seconds; it does not say "biometric" or "face geometry", and the terms (T11.4)
    do. Is that a sufficient written notice, are the two presses (Yes, then Send) a written release,
    and is T11.4 a sufficient public retention policy?
16. **Texas (s. 503.001) and Washington (RCW 19.375, My Health My Data Act).** Is display a "commercial
    purpose"? Does Washington need a separate consent for sharing with our providers and a separate
    health-data policy link? Other states to treat alike?
17. **Should we block regions, and how?** (a) No block; (b) photo features off per shop for shops that
    sell to the United States, no location lookup; (c) blocking by IP address, itself a use of location
    data. Which for Illinois, and for the US?
18. **US children** under 13 (COPPA lists facial templates): is the age line enough?

**Group 4: does not block**

19. EU AI Act: we do no identification, emotion recognition or categorisation. Any duty we miss? Is
    resetting the switches to off after a change of terms (T13.1) right?
