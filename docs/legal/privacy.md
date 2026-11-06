# Curtain privacy policy

> **DRAFT for legal review. Not in force.** Written from what the code does on 6 November 2026 (branch `claude/garment-engine`). Everything in [SQUARE BRACKETS] is a placeholder the founder or a lawyer must fill in or confirm. Do not publish this text as final.

Last updated: [DATE OF PUBLICATION]

Curtain is a size advice tool for online clothing shops: "your private fitting room". This policy explains what Curtain collects, what it does not collect, where it is kept and for how long, and what you can do about it. It covers three groups of people:

- **Shoppers** who press **Try it on** on a shop's product page (the "standalone" fit tool, which opens on top of the shop's page).
- **Shoppers** who choose to use the optional Curtain app.
- **Merchants** who install Curtain on their Shopify or WooCommerce shop.

## Who we are

Curtain is operated by [COMPANY LEGAL NAME], [REGISTERED ADDRESS], [COMPANY REGISTRATION NUMBER] ("Curtain", "we", "us"). Contact for anything in this policy: [PRIVACY CONTACT EMAIL].

[LEGAL REVIEW: confirm the role split. Our working assumption: for shopper data Curtain decides why and how the data is processed and acts as an independent controller (GDPR) or APP entity (Australian Privacy Act); for merchant account data Curtain is the controller; Curtain holds no shop customer records, so it acts as nobody's processor for those.]

## The short version

- **Your body measurements stay in your browser.** On a shop's page, Curtain works out your size inside your own browser. Your height, weight, measurements and fit preference are not sent to our servers.
- **Photos and video never leave your device.** The optional camera scan runs entirely in your browser. We have no server route that accepts a photo of you.
- **We do not know who you are.** We do not ask for your name, e-mail address, phone number, address or payment details. We use a random device number instead.
- **The shop never sees your measurements.** Shops see totals only (for example "12 shoppers were recommended size 12"), and only once enough shoppers are in a group that nobody can be singled out.
- **No advertising, no tracking cookies, no data sales.** The fit tool loads no third-party trackers and sets no cookies.
- **You can delete it.** **Forget me** in the fit tool deletes what is in your browser and what our server holds for that device.

## Shoppers: the Try it on tool on a shop's page

### What stays on your device

These are entered or computed in your browser and are **not** sent to us:

- height and weight, your fit preference (snug, regular or relaxed), and your age range if you give it;
- any body measurements you type in (for example bust, waist, hips, inseam) and whether you measured them with a tape;
- the result of the optional camera scan. The camera frames are processed in your browser and are never stored or uploaded;
- the units you prefer (cm/kg or in/lb).

If **Remember me on this shop** is on (it is on by default), your answers are saved in your browser's storage for our fit tool so you do not have to fill them in again on that shop. Modern browsers keep this storage separate for each shop's website, and we also key it by shop, so one shop's visit cannot show your profile on another shop. If you switch **Remember me** off, nothing is saved and the saved profile is wiped. Clearing your browser data also removes it.

### What is sent to our server

To work, and so the shop can be billed for the service, the fit tool sends the following to our server:

- **A random device number.** The first time the tool opens, it asks our server for an anonymous device number and a token to go with it. The request contains only the type of platform ("web") and the version of the tool. With **Remember me** off, a new number is created every time.
- **The try-on session.** Which shop and which product the session is for, when it started, and the *origin* of the shop page that opened it (for example `https://shop.example`, never the full address of the page). A per-shop pseudonym links your device to that shop inside our systems; it is a one-way code that cannot be turned back into the device number, and the shop never receives it.
- **Your chosen size and the confidence.** When the tool shows you a result, it sends the recommended size label (for example "12") and a confidence number between 0 and 1. Nothing else about your body. Our server refuses a request that contains anything more.
- **A usage record.** One billable session per try-on, so the shop can be billed correctly and so we can stop abuse.
- **A privacy ledger line.** A record that lists the *names* of the fields that were sent and their size in bytes (never the values), so you can see what left your device.

### Technical data

Like any website, our server sees your IP address and browser details when your browser connects. We use the IP address briefly, in memory, to limit how many requests one address can make (to stop abuse). Our logs do not record IP addresses by default, and logs are deleted after about seven days.

The tool shows the shop's logo and product photos through our server so that your browser does not contact other sites. We fetch those images from the shop; no information about you is sent with that request.

### Optional: See it on me

Some shops offer **See it on me**, which creates a picture of a generated avatar wearing the product. It only runs if the shop has switched it on **and** you agree on the screen first. What is sent is the generated avatar picture and the product photo, never a photo of you. The picture is processed by an image-generation provider listed under [Service providers](#service-providers), and both the input and the result are deleted from our server within 24 hours. Every picture is labelled as an estimate.

## Shoppers: the optional Curtain app

The Curtain app is never needed to use a shop's fit tool. If you choose to use it, the app keeps your photos and scan media on your phone, like the fit tool. It also syncs the following to our server so your profile follows you between shops:

- a **fit signature**: about 80 numbers derived from your body shape, without face, skin or hair values;
- items you swiped (love, pass, save), your saved wardrobe and the shops you paired with.

You can download everything the app holds about you (data export) and delete it all in one step in the app's profile screen.

## Merchants

When a merchant installs Curtain, we hold:

- the shop's domain, name and primary storefront domain;
- for Shopify, an access token for the shop's Admin API, stored encrypted, which we use to read products and write Curtain's product fields; for WooCommerce, the site address; for both, the shop's Curtain API key, stored hashed and encrypted;
- product data the shop publishes (titles, photos, sizes, size charts, fabric) and the size charts the merchant sets up in Curtain;
- the plan, subscription status, billing currency and the subscription reference (Shopify) or customer reference (Stripe, for WooCommerce shops). Card details go to Shopify or Stripe, never to us;
- usage totals per day, and records of the webhooks Shopify or Stripe send us.

When a merchant opens Curtain inside the Shopify admin, Shopify gives us a short-lived signed token that identifies the shop and the staff member. We use it to check the request and do not keep a profile of the staff member.

**Shop customers.** Curtain does not ask Shopify for access to customers or orders, and we do not hold a shop's customer records. Shopify's customer privacy requests (`customers/data_request`, `customers/redact`) reach us and are recorded without the customer details they contain.

**What merchants see about shoppers.** Totals only: how many fit sessions ran, which sizes were recommended, and which products were opened without a result, each only once at least [5] different shoppers are in a group. Merchants never receive a measurement, a device number, a photo or anything that identifies a shopper.

## Why we use the data (legal bases)

- **To give you a size recommendation and run the service** (device number, try-on session, chosen size): to provide the service you asked for, and our legitimate interest in running a reliable, abuse-resistant service (GDPR Art. 6(1)(b) and (f)).
- **To bill the shop correctly** (usage records): legitimate interest and our contract with the merchant.
- **To show merchants anonymous totals:** legitimate interest; the minimum group size keeps individuals out.
- **See it on me:** your consent, given on the screen each time (GDPR Art. 6(1)(a)). You can stop at any time.
- **Camera scan:** runs on your device only; your browser asks for camera permission and you can skip the scan.

[LEGAL REVIEW: whether body measurements processed only on the device, and the chosen size label sent to us, count as health or biometric data under GDPR Art. 9 or as sensitive information under the Australian Privacy Act. Our position is that nothing biometric or health-related reaches our server, but this needs confirmation.]

We do not sell personal information, we do not use it for advertising, and we do not make decisions about you that have legal or similarly significant effects. The size recommendation is advice from a computer program; you choose your size.

## How long we keep it

- **Data in your browser:** until you press **Forget me**, switch off **Remember me**, or clear your browser data.
- **Device number, try-on sessions, chosen size, ledger and usage records:** [RETENTION PERIOD, for example 13 months]. [FOUNDER: the code does not delete these automatically yet. Until an automatic clean-up exists, they are kept until you press Forget me or the shop's data is purged.] After **Forget me**, the device number, its pairings and its ledger are deleted. Session and usage counts the shop is billed for are kept without the device number, so they no longer link to you.
- **See it on me pictures:** deleted within 24 hours.
- **Server logs:** about seven days.
- **Shop data:** when a merchant uninstalls Curtain we pause the shop and delete the shop and everything linked to it 48 hours later (sooner if Shopify asks us to). Product data stays in the merchant's own shop.
- **Backups:** encrypted nightly backups are kept for [BACKUP RETENTION, for example 30 days] and then overwritten.

## Your rights

Depending on where you live, you can ask to see, correct, export or delete your data, object to how we use it, or withdraw consent. Because we do not know your name or e-mail address, the easiest way is in the tool itself:

- **Forget me** in the fit tool deletes your saved profile from your browser and asks our server to delete everything held for your device.
- In the Curtain app, the profile screen offers a full data export and deletion.

You can also write to [PRIVACY CONTACT EMAIL]. To find your data we need the device number shown in the tool [FOUNDER: the embed does not show it yet]; if you have cleared your browser, we cannot link any data to you. We answer within one month (GDPR) or 30 days (Australia).

**In the European Economic Area and the UK:** you can complain to your local data protection authority. [LEAD SUPERVISORY AUTHORITY, for example the Belgian Data Protection Authority or the Dutch Autoriteit Persoonsgegevens.]

**In Australia:** we handle personal information in line with the Australian Privacy Principles. [LEGAL REVIEW: whether Curtain is covered by the Privacy Act 1988 or falls under the small business exemption; we intend to follow the Principles either way.] You can ask us for access to or correction of your information (APP 12 and 13). If you are not satisfied with our answer, you can complain to the Office of the Australian Information Commissioner (oaic.gov.au). If a data breach is likely to cause serious harm, we will notify you and the OAIC.

## Where the data is kept

Our servers are in [HOSTING REGION, for example the European Union]. If you are in Australia or elsewhere outside that region, your data is sent there (APP 8 cross-border disclosure). When we use a service provider outside the EEA, we use the European Commission's standard contractual clauses or another lawful transfer mechanism.

## Service providers

We use a small number of providers. None of them receive shopper measurements or photos.

- [HOSTING PROVIDER]: servers and database, [REGION].
- [BACKUP STORAGE PROVIDER]: encrypted backups, [REGION].
- Shopify: app installation and billing for Shopify merchants.
- Stripe: billing for WooCommerce merchants.
- [IMAGE PROVIDER(S), for example FASHN, Google Cloud Vertex AI, xAI]: only for **See it on me**, only with your consent, only the generated avatar picture and the product photo, deleted within 24 hours.
- [GPU PROCESSING PROVIDER]: processes merchants' product photos into 3D garment models (not part of the size advice plan; product data only).
- [EMAIL / SUPPORT PROVIDER]: support messages you send us.

[FOUNDER: keep this list in step with `docs/legal/subprocessors` once it exists, and with the `TRYON_ORDER` providers actually configured in production.]

## Children

Curtain is not directed at children under [16]. The fit tool does not ask for a name or contact details, and the age range question is optional.

## Security

Connections are encrypted (HTTPS). Shop access tokens and keys are stored encrypted. Merchants see totals only, never a device number or a pseudonym; a per-shop pseudonym is used internally to count distinct shoppers for the minimum group size. Our build checks that no secret keys end up in the code sent to browsers, and the fit tool makes no requests to third-party sites.

## Changes

We will post changes on this page and update the date at the top. For material changes we will tell merchants in the Curtain admin [and by e-mail].

## Contact

[COMPANY LEGAL NAME], [REGISTERED ADDRESS], [PRIVACY CONTACT EMAIL]. [EU REPRESENTATIVE / UK REPRESENTATIVE, if required.]
