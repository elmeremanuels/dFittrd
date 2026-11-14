# Avatar privacy terms: your face, skin tone and body scan

> # DRAFT - NOT REVIEWED BY A LAWYER
>
> Written on 14 November 2026 by an AI agent, not by a lawyer. It is not legal advice and it is not in force.
> It describes a feature that is **not built yet** (the photo-based face is behind a flag; the D19 server
> route does not exist). It goes to Naomi for review together with `counsel-brief.md` and
> `avatar-consent-copy.md`. Do not publish it. Everything in [SQUARE BRACKETS] is a placeholder or an open
> question. Clause numbers (T1.1, T4.5, ...) are stable: the plain-language prompt copy points at them, so
> renumbering breaks the mapping table in `avatar-consent-copy.md`.

Last updated: [DATE OF PUBLICATION]

These terms sit behind the link **Read the full privacy terms** in the prompt that opens when you tap the
avatar. They add to the Curtain privacy policy (`docs/legal/privacy.md`, also a draft). Where the two
differ about your face, skin tone or body scan, these terms apply.

There are two versions of the feature. A shop runs one of them, and the prompt tells you which:

- **Version A, on your device only.** Your photo is never sent anywhere.
- **Version B, face photo sent to Curtain.** One photo of your head and neck is sent, used, and deleted
  when the result comes back. Section 4 applies only to version B.

## 1. Who is responsible

- **T1.1** Curtain is operated by [COMPANY LEGAL NAME], [REGISTERED ADDRESS], [REGISTRATION NUMBER].
  Contact: [PRIVACY CONTACT EMAIL].
- **T1.2** [OPEN QUESTION FOR COUNSEL, brief question 2.] Our working assumption is that Curtain decides
  why and how this feature handles your data and is therefore the controller (GDPR, UK GDPR) or the
  responsible organisation (Australian Privacy Act) for it. The shop chooses to put the tool on its page
  and switches the feature on or off; whether that makes the shop a joint controller with us for the
  moment the tool is opened is not settled. The shop is never given the data (T8.1).
- **T1.3** If the shop is found to share responsibility, you can still use every right in section 9
  against Curtain.

## 2. What the feature is

- **T2.1** The feature is optional. It changes how the avatar looks. It does not change your size advice.
- **T2.2** There are three items, each with its own switch: **Use my face**, **Match my skin tone** and
  **Scan my body**. Skin tone can be picked by hand from a row of colours without any photo.
- **T2.3** Every avatar starts with a standard face and a standard skin colour that are the same for
  everybody.
- **T2.4** Every switch is off until you switch it on. No camera or photo picker opens, and nothing is
  read from a photo or sent, before you have said yes for that item in the prompt.

## 3. What happens on your device (both versions)

- **T3.1** In version A, the photo you take or choose, and any camera frames, are handled inside your own
  browser by Curtain's code. They are not uploaded to Curtain, to the shop or to anyone else. Curtain has
  no server route that accepts them.
- **T3.2** From the photo your browser works out: a skin colour value, a hair colour value, a small
  picture of your face (about 320 pixels wide) and a face picture shaped to fit the avatar's head (about
  512 pixels wide). These are used only to draw the avatar on your screen.
- **T3.3** To place your face on the avatar, your browser finds points on your face in the photo (eyes,
  nose, mouth, outline). These points are used for that one step and then discarded. They are not saved,
  not sent, not turned into a face template, and not compared with any other face. The feature does not
  recognise you, identify you or check who you are.
- **T3.4** Without **Remember my photo on this device**, the face pictures and the photo-based skin colour
  are held only in the memory of the open tool. They are gone when you close it.
- **T3.5** If you switch on **Remember my photo on this device** (off by default), the face pictures and
  the skin colour are saved in your browser's storage on that device, encrypted, and only for the shop
  site you are on. They are not saved on any Curtain server. They stay until you remove them (section 9)
  [or until they are [12] months old, whichever comes first: RECOMMENDED, NOT YET DECIDED].
- **T3.6** **Scan my body** uses your camera to estimate body measurements. The camera frames are handled
  in your browser only. They are not saved and not uploaded, in either version. No route at Curtain
  accepts a photo or video of a body, with or without your consent. The measurements that result stay in
  your browser, as the main privacy policy describes.
- **T3.7** You never have to scan. Typing your measurements is the standard way, and typed measurements
  also stay in your browser.

## 4. Version B only: one face photo is sent to Curtain

- **T4.1** This happens only if the shop has version B switched on and you say yes to **Use my face** in
  the prompt, for that photo.
- **T4.2** What is sent: one photo, cut down on your device to your head and neck before it leaves.
  Nothing else goes with it: no body photo, no video, no measurement, no name. [ENGINEERING: the server
  must also refuse a picture that is not a head-and-neck crop; see the test specification.]
- **T4.3** The photo is sent over an encrypted connection (HTTPS).
- **T4.4** The server handles the photo in working memory only. It is not written to a disk, a database,
  a cache, a queue, a backup or a log.
- **T4.5** The photo, and everything worked out from it, is deleted from the server's memory as soon as
  the result has been sent back to your device, and in any case within [60] seconds. This also applies
  when the step fails or you cancel.
- **T4.6** What comes back to your device: a face picture for the avatar, a head shape and a skin colour
  value. From then on they are handled like the on-device results in T3.4 and T3.5. Curtain keeps no
  copy.
- **T4.7** What the server does keep is a technical record without any picture or face data: that a
  request was made, when, how large it was, and whether it worked. To stop abuse, the server counts
  requests per IP address in memory for a short time [WINDOW]. [OPEN: whether this record is linked to
  the random device number.]
- **T4.8** Where: on servers in [HOSTING REGION] run by [HOSTING PROVIDER] [and, if a rented graphics
  processor is used, [GPU PROVIDER, REGION]]. No other company receives the photo. [OPEN, brief question
  9: decision D16 says heavy computing runs on a hosted GPU service. If the face step uses it, that
  provider is named here, is bound by contract to T4.4 and T4.5, and is covered by the same test.]
- **T4.9** The server does not recognise you, does not compare your face with other faces and does not
  build or keep a face template.

## 5. What may be sent to Curtain apart from the photo

- **T5.1** **See it on me** is a separate, optional step described in the main privacy policy. If you
  ask for it and you have picked or confirmed a skin colour, that one colour value is sent along with the
  generated avatar picture, so that the result matches what you see. No photo, face picture or
  measurement goes with it. It is handled and deleted as the main policy says for See it on me
  (processed by [IMAGE PROVIDER(S)], deleted from our server within 24 hours).
- **T5.2** Your face pictures, face points, hair colour and (outside T5.1) skin colour are not part of
  the size advice, are not sent to the shop's page, and are not in any usage or statistics data sent to
  Curtain.
- **T5.3** Everything else the tool sends (a random device number, the session, the recommended size) is
  as the main privacy policy describes and is not changed by this feature.

## 6. Why, and on what legal ground

- **T6.1** Purpose: to show you an avatar with your own face and skin colour next to a garment, and (body
  scan) to save you from typing measurements. Nothing else.
- **T6.2** Legal ground: your explicit consent, given per item in the prompt (GDPR and UK GDPR Art.
  6(1)(a) and, as far as a special category is involved, Art. 9(2)(a); Australian Privacy Principle 3.3;
  and the consent rules of the US state laws in section 11).
- **T6.3** [COUNSEL TO CONFIRM, brief question 1.] We do not use your face to identify you, so we think
  the face pictures are not "biometric data" in the strict legal sense in most places. We ask for
  explicit consent anyway and treat the data as if it were.
- **T6.4** Saying no costs you nothing. The size advice and the avatar with the standard face work the
  same without this feature.
- **T6.5** No decision about you is made from this data.

## 7. How long it is kept

- **T7.1** On Curtain's servers: your photo, face pictures, face points and head shape are never kept.
  In version A they never arrive. In version B they are deleted as T4.5 says.
- **T7.2** On your device, without **Remember my photo**: until you close the tool.
- **T7.3** On your device, with **Remember my photo**: until you press **Delete my photo** or **Forget
  me**, switch the item off, or clear your browser data [or [12] months, see T3.5].
- **T7.4** Because nothing is stored on a server, there is nothing in our backups.
- **T7.5** The skin colour sent with See it on me (T5.1): as long as the See it on me picture, at most 24
  hours.

## 8. Who gets it

- **T8.1** The shop never receives your photo, your face pictures, your skin colour, a measurement or a
  device number.
- **T8.2** We do not sell this data and do not use it for advertising.
- **T8.3** We do not use your photo or anything worked out from it to train or test any AI model.
- **T8.4** The only other companies involved are those named in T4.8 (version B) and T5.1 (See it on me).

## 9. Your choices and rights

- **T9.1** You can switch each item off again in the same prompt, at any time. It is as easy as switching
  it on.
- **T9.2** Switching off: **Use my face** puts the standard face back and deletes your face pictures from
  the tool's memory and from your device's storage. **Match my skin tone** puts the standard colour back
  and deletes the saved colour. **Scan my body** deletes the scan result; measurements you typed stay.
  [ENGINEERING TO CONFIRM this is what the build does.]
- **T9.3** **Delete my photo** removes your face pictures, and the skin colour that was read from the
  photo, from the tool's memory and from your device's storage, at once.
- **T9.4** **Forget me** removes everything this tool has saved in your browser for that shop (including
  everything in T9.3) and asks Curtain's server to delete what it holds for your random device number, as
  the main privacy policy describes.
- **T9.5** Taking back consent does not undo what was done before. In version B there is nothing on the
  server to delete afterwards, because the photo was already deleted (T4.5).
- **T9.6** Depending on where you live you also have the right to ask what we hold, to have it corrected
  or deleted, to object, and to complain to a regulator (section 11). Because the face data is on your
  device and not with us, the buttons above are the way to use these rights; we cannot do it for you.
  Contact: [PRIVACY CONTACT EMAIL].

## 10. Children

- **T10.1** The photo and scan items are for people aged [16] or older. [COUNSEL: 16, 18, or per country;
  brief question 4.]
- **T10.2** Before the camera or photo picker opens, the prompt asks you to confirm that you are old
  enough. [OPEN: a plain statement, or a real age check.]
- **T10.3** We do not knowingly handle a face photo of a younger person. Picking a skin colour by hand is
  open to everyone.

## 11. Extra information for where you live

**T11.1 European Economic Area.** Controller: see section 1. Legal ground: T6.2. You can complain to
your data protection authority [LEAD AUTHORITY]. [EU REPRESENTATIVE, if required.] Version B: if the
server is outside the EEA, the transfer is covered by [MECHANISM].

**T11.2 United Kingdom.** The same rights apply under the UK GDPR and the Data Protection Act 2018. You
can complain to the Information Commissioner's Office. [UK REPRESENTATIVE, if required.]

**T11.3 Australia.** We handle this information in line with the Australian Privacy Principles. We treat
your face photo as sensitive information and collect it (version B) only with your consent and only
because the feature needs it. In version B the photo is sent to a server in [REGION], outside Australia.
You can ask us for access or correction and can complain to the Office of the Australian Information
Commissioner (oaic.gov.au).

**T11.4 Illinois (United States).** Version B: before you send a photo we tell you in writing, in the
prompt and here, (1) that a photo of your face is collected and that data about the shape of your face
is worked out from it, (2) that the purpose is to draw your avatar, and (3) that it is kept only for the
time needed to return the result, at most [60] seconds, and then permanently destroyed. Pressing **Yes,
send my photo** is your written release. This section is also our public retention and destruction
policy. We do not sell, lease, trade or otherwise profit from this data, and do not disclose it.
[COUNSEL, brief questions 11 and 13: whether a button press is a sufficient written release, and whether
version B should be offered in Illinois at all.]

**T11.5 Texas (United States).** We tell you before the photo is taken or sent, and we do it only with
your consent. We do not sell, lease or disclose it, and it is destroyed as T4.5 says.

**T11.6 Washington (United States).** We do not enrol your face in any database. As far as face data
counts as consumer health data under the My Health My Data Act, we collect it only with your consent
for the purpose in T6.1 and do not share or sell it. [COUNSEL: whether a separate Consumer Health Data
Privacy Policy link is required.]

## 12. Security

- **T12.1** Connections are encrypted. Saved face pictures on your device are encrypted with a key that
  the browser does not hand out.
- **T12.2** Version B is tested automatically to show that the photo is not stored (see
  `face-route-nothing-stored-test-spec.md`). The feature stays switched off if that test fails.

## 13. Changes

- **T13.1** If we change these terms so that more is sent, kept or shared than before, the switches go
  back to off and we ask you again.

---

## Appendix A. Notes on the law (for the reviewer; not part of the published text)

I am not a lawyer. These notes say what I read, where, and how sure I am. "Checked" means I opened the
page on 14 November 2026 through a fetch tool that returns short excerpts and a summary, not the full
text. Several official sites refused the request (noted in Appendix B), so some statute wording comes
from a republisher or from memory. Every item needs a lawyer's reading of the primary source.

### A1. GDPR (EU) 2016/679

- Art. 4(14): biometric data is personal data "resulting from specific technical processing" of
  physical, physiological or behavioural characteristics, "which allow or confirm the unique
  identification" of the person. Checked (gdpr-info.eu, a republisher; EUR-Lex returned an empty page).
- Recital 51: photographs are not systematically special-category data; they are covered by the
  definition of biometric data "only when processed through a specific technical means" allowing unique
  identification or authentication. Checked (same republisher).
- Art. 9(1) prohibits processing biometric data "for the purpose of uniquely identifying a natural
  person"; Art. 9(2)(a) lifts the prohibition on explicit consent. Not re-fetched; from memory.
- Reading: a face picture drawn on an avatar, and face points used once and discarded, are not processed
  to identify anyone, which points away from Art. 9. Against that: the points are a "specific technical
  processing" of a face, and regulators read Art. 9 broadly. The draft therefore asks for explicit
  consent in every case (T6.2, T6.3). **Assumed, not confirmed.**
- A skin colour value might be argued to reveal racial or ethnic origin (Art. 9(1)). The feature never
  infers origin, and the value is one the shopper picks or confirms. Since D20 this value may go to a
  server and an image provider with See it on me (T5.1). **Open; brief question 6.**
- Controller question: the Court of Justice held in Fashion ID (C-40/17, 2019) that a website that
  embeds a third party's plugin can be a joint controller for the collection and transmission the plugin
  causes. From memory, not re-fetched. It is the reason T1.2 is open.
- Art. 7(3) (withdrawing must be as easy as giving), Art. 8 (children: 16, member states may lower to
  13; the Netherlands keeps 16 per secondary sources), Art. 35 (impact assessment): from memory and
  secondary sources.

### A2. UK GDPR and Data Protection Act 2018

- The ICO's guidance says biometric data becomes special category biometric data only "if you use it to
  uniquely identify someone", that purpose matters, and that brief processing is still processing ("It
  is still processing if you only briefly create, collect or store information"). Checked (ico.org.uk).
  The page says the guidance is under review because of the Data (Use and Access) Act 2025; I did not
  establish what that Act changes here.
- UK age for a child's own consent to an online service: 13 (DPA 2018 s. 9), from secondary sources.

### A3. Australia: Privacy Act 1988 (Cth)

- The pilot shop is in Australia. Sensitive information (s 6(1)) includes biometric information that is
  to be used for automated biometric verification or biometric identification, and biometric templates;
  it also includes information about racial or ethnic origin. APP 3.3: sensitive information may be
  collected only with consent and only if reasonably necessary for the organisation's functions or
  activities. Secondary sources and memory; legislation.gov.au returned only the table of contents
  (compilation C2026C00227) and oaic.gov.au refused the request.
- Reading: a face photo used only for display is not "to be used for" verification or identification,
  and no template is kept, which points away from "sensitive information". **Assumed, not confirmed.**
- Important for version B: in *Bunnings Group Limited and Privacy Commissioner* [2026] ARTA 130 (4
  February 2026) the Administrative Review Tribunal reportedly held that face data held for about 0.004
  of a second in memory was still "collected" for inclusion in a record, and that a notice saying the
  shop "may" use the technology was inadequate (APP 5). Secondary sources only (law-firm summaries); an
  appeal may be pending. Consequence for us: "processed in memory and deleted" does not take version B
  outside the Act. The prompt copy therefore says plainly that the photo **is** sent, not that it "may
  be".
- Small business exemption (turnover under AUD 3 million): still in force per secondary sources; an
  exposure draft of further reforms was published on 31 August 2026. Whether Curtain (a non-Australian
  company serving an Australian shop) is covered at all is a question for counsel. The main policy
  already says we follow the Principles either way.
- Children: the Children's Online Privacy Code must be registered by 10 December 2026 (exposure draft
  31 March 2026). Not final when this was written. Secondary sources.

### A4. Illinois: Biometric Information Privacy Act, 740 ILCS 14

- s. 10: a biometric identifier is "a retina or iris scan, fingerprint, voiceprint, or scan of hand or
  face geometry"; identifiers "do not include ... photographs"; biometric information does not include
  information derived from excluded items. A written release means "informed written consent, electronic
  signature" (the electronic signature wording was added by P.A. 103-769, in force 2 August 2024).
  Checked on FindLaw (a republisher that warns it may be out of date); ilga.gov returned errors.
- s. 15(a): a public written retention and destruction policy (destroy when the purpose is met or within
  3 years of the last interaction). s. 15(b): inform in writing, state purpose and length of term, get a
  written release, before collecting. s. 15(c), (d): no profiting, no disclosure without consent. s. 20:
  $1,000 (negligent) or $5,000 (intentional or reckless) per violation, or actual damages; since 2024,
  repeated collection of the same identifier by the same method is one violation. Checked on FindLaw.
- Courts have repeatedly let claims go forward where face geometry was derived from a photo by a virtual
  try-on tool, despite the photograph exclusion. Most recent: *Clements v. Gunnar Optiks*, No. 25-1890
  (7th Cir., 10 July 2026): dismissal vacated; a glasses try-on that scanned faces and transmitted face
  geometry "seems to be aesthetic, not medical", so the health-care exemption could not be decided on
  the pleadings. Secondary source (plaintiff-side firm).
- On-device: *G.T. v. Samsung Electronics America* (7th Cir., reported 20 August 2026) reportedly held
  that BIPA ss. 15(a) and 15(b) need the company to have some control over the data, and that supplying
  software which creates face data that stays on the user's device is not possession or collection. The
  court assumed without deciding that the data was biometric. It binds federal courts in the Seventh
  Circuit, not Illinois state courts. Secondary source (defence-side firm). This supports version A and
  does **not** help version B, where the photo is transmitted.
- Reading: version A has a good argument. Version B is squarely the fact pattern of the try-on cases,
  with a private right of action. **This is the largest money risk in the feature.**

### A5. Texas: Business and Commerce Code s. 503.001 (CUBI)

- Biometric identifier: "a retina or iris scan, fingerprint, voiceprint, or record of hand or face
  geometry". (b): may not capture for a commercial purpose unless the person is informed first and
  consents; no particular form is required. (c): no sale or disclosure (narrow exceptions), reasonable
  care, destroy within a reasonable time and at most one year after the purpose ends. (d): civil
  penalty up to $25,000 per violation, attorney general only. Checked on texas.public.law (republisher)
  and the enrolled text of H.B. 149 (capitol.texas.gov), which amended the section from 1 January 2026
  (a publicly available image is not consent; exemptions for AI training unless used to identify).
  The official statutes page returned only navigation.

### A6. Washington

- RCW 19.375: covers "enrolling" a biometric identifier in a database for a commercial purpose; "enroll"
  means capturing an identifier, converting it into a reference template and storing it in a database
  that matches it to a person. The definition of biometric identifier excludes photographs. Attorney
  general only. Checked (app.leg.wa.gov, excerpts). Reading: we enrol nothing, in either version.
- RCW 19.373 (My Health My Data Act): "consumer health data" includes biometric data; "biometric data"
  is data "generated from the measurement or technological processing of an individual's physiological,
  biological, or behavioral characteristics" (the definition continues; from memory it requires that the
  data identifies a consumer, which I could not confirm in the excerpt). "Collect" is very wide ("access,
  retain, receive, acquire, infer, derive, or otherwise process"). Consent must be opt-in and specific;
  a violation is an unfair practice under the Consumer Protection Act, which private persons can enforce.
  Checked (app.leg.wa.gov, excerpts). Reading: version B could fall under it if face data counts as
  biometric data there. **Open.**

### A7. Other points noticed, not researched in depth

- US children: the amended COPPA Rule (effective 23 June 2025, compliance 22 April 2026) lists facial
  templates and faceprints as personal information of children under 13. Secondary sources.
- EU AI Act: we do no identification, emotion recognition or biometric categorisation; not researched.
- Other US states with biometric or "sensitive data" consent rules (for example Colorado, California)
  were not in the task and were not checked.

## Appendix B. Sources (all opened or searched on 14 November 2026)

| Topic | Source | Status |
|---|---|---|
| GDPR Art. 4 | https://gdpr-info.eu/art-4-gdpr/ | Excerpts read; republisher. EUR-Lex (CELEX 32016R0679) returned an empty page |
| GDPR Recital 51 | https://gdpr-info.eu/recitals/no-51/ | Excerpts read; republisher |
| UK: ICO biometric guidance | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/biometric-data-guidance-biometric-recognition/key-data-protection-concepts/ | Excerpts read; under review |
| Australia: Privacy Act 1988 | https://www.legislation.gov.au/C2004A03712/latest/text | Only table of contents retrieved; definitions not read at source |
| Australia: OAIC guidance | https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-b-key-concepts | Request refused (403); not read |
| Australia: Bunnings ART decision | https://www.claytonutz.com/insights/2026/february/bunnings-wins-appeal-on-facial-recognition-technology-key-takeaways-for-businesses-and-privacy-law ; https://www.gtlaw.com.au/insights/administrative-review-tribunal-upholds-bunnings-use-of-facial-recognition-technology ; https://www.pinsentmasons.com/out-law/analysis/bunning-tribunal-decision | Search summaries only; decision itself not read |
| Australia: Children's Online Privacy Code | https://www.oaic.gov.au/privacy/privacy-registers/privacy-codes/childrens-online-privacy-code | Search summary only |
| Illinois BIPA ss. 10, 15, 20 | https://codes.findlaw.com/il/chapter-740-civil-liabilities/il-st-sect-740-14-10/ (and -15, -20) | Excerpts read; republisher. https://www.ilga.gov and https://lig.ilga.gov returned 503 |
| Illinois P.A. 103-769 | https://ilga.gov/Legislation/publicacts/view/103-0769 | 503; effective date from search result |
| BIPA on-device (G.T. v. Samsung) | https://www.mayerbrown.com/en/insights/publications/2026/08/seventh-circuit-holds-that-bipa-does-not-reach-biometric-data-that-remains-on-a-users-device | Article read; opinion not read |
| BIPA try-on (Clements v. Gunnar Optiks) | https://dicellolevitt.com/seventh-circuit-revives-illinois-biometric-privacy-class-action-against-gunnar-optiks/ | Article read; opinion not read |
| Texas s. 503.001 | https://texas.public.law/statutes/tex._bus._and_com._code_section_503.001 | Excerpts read; republisher. https://statutes.capitol.texas.gov/Docs/BC/htm/BC.503.htm returned navigation only |
| Texas H.B. 149 (enrolled) | https://capitol.texas.gov/tlodocs/89R/billtext/html/HB00149F.htm | Excerpts read at source |
| Washington RCW 19.375 | https://app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true | Excerpts read at source |
| Washington RCW 19.373 | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true | Excerpts read at source (first 100,000 characters) |
| COPPA amended rule | https://www.govinfo.gov/content/pkg/FR-2025-04-22/html/2025-05904.htm | Search summary only |
| Children's consent ages | https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_nl | Search summary only |
