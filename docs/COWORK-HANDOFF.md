# Handoff voor Cowork: server inrichten en curtain.fit live krijgen

Voor: Claude Cowork, op de computer van de oprichter (Elmer Emanuels), met zijn browser en terminal.
Van: de Claude Code-sessie die de code bouwt (repository `elmeremanuels/dFittrd`, branch `claude/garment-engine`).
Datum: 8 november 2026.

## Doel

1. De VPS inrichten voor Curtain: website, plugin-API en klantenvenster.
2. DNS van `curtain.fit` (bij Hostinger) naar die VPS laten wijzen.
3. GitHub zo instellen dat de uitrolknop werkt.
4. De eerste uitrol doen, en daarmee `https://curtain.fit`, `https://app.curtain.fit` en `https://api.curtain.fit` live.
5. Daarna: de Shopify-app koppelen, eerst aan een testwinkel.

De volledige technische uitleg staat in `docs/DEPLOY.md`. Die is leidend; dit document is de volgorde
en de beslissingen.

## Harde regels (niet van afwijken)

- **Geheimen nooit in een chat, document, commit of screenshot.** Dat geldt voor sleutels, wachtwoorden,
  het Shopify Client secret en de private SSH-sleutel. Ze gaan alleen naar:
  - GitHub → Settings → Environments → `production` → *Environment secrets*;
  - of `/etc/curtain/curtain.env` op de server.
- **Elke uitrol gaat met een klik van Elmer** (*Required reviewer*). Nooit omzeilen.
- **Niets uitrollen vanaf een andere branch dan `main` of `release`.** De workflow weigert dat ook.
- **Bij twijfel stoppen en Elmer vragen.** Bijvoorbeeld bij het kiezen van een serverregio, het betalen
  van iets of het verwijderen van data.

## Waar staan we (stand 8 nov 2026)

| Onderdeel | Status |
|---|---|
| Plugin (maatadvies, Shopify en WooCommerce, optionele 3D-schatting) | Klaar en getest in de demowinkel, op branch `claude/garment-engine` |
| Uitrolworkflow `.github/workflows/deploy.yml` | Klaar, nog **nooit gedraaid**; staat nog niet op `main` |
| Website `apps/site` (curtain.fit) | Klaar en samengevoegd in `claude/garment-engine`, met Bohohippychic-beelden. Gaat pas live als de launch gates dicht zijn (zie "Wat nog bij Elmer ligt") |
| Toestemming Bohohippychic | **Gegeven** (verklaring Elmer, 8 nov 2026): naam, logo, productfoto's en de 3D-modellen daarvan, op de website en in demo's. Elmer bewaart de schriftelijke bevestiging |
| `main` op GitHub | Bevat alleen een oude init-commit; al het werk moet daar nog naartoe (stap 6) |
| VPS | Elmer heeft er een. Nog niet ingericht voor Curtain; IP-adres nog niet bekend bij de bouwsessie |
| Domein `curtain.fit` | Geregistreerd bij Hostinger |

## Plan: alles op één VPS

Elmer koos: richt het in zoals het handigst is. Dat is één server voor alles, met Caddy dat automatisch
HTTPS regelt. Hostinger blijft alleen de registrar en DNS.

| Adres | Wat |
|---|---|
| `curtain.fit`, `www.curtain.fit` | Website (statisch) |
| `app.curtain.fit` | Klantenvenster (maatadvies, 3D) |
| `api.curtain.fit` | Plugin-API |

De Caddy-regels voor `curtain.fit` (website) en `www.curtain.fit` (doorverwijzing naar `curtain.fit`)
staan in `infra/Caddyfile`; de uitrol bouwt de site mee met `build:release`. Zolang er een launch gate
open staat (bedrijfsgegevens, mailbox, juridische check, Elmers akkoord op de 3D-schattingen), weigert die build. De uitrol slaat de site dan
over met een waarschuwing in de samenvatting en zet `app` en `api` gewoon live. Er verschijnt dan nog
niets op `curtain.fit` (Caddy geeft 404). Zodra de gates dicht zijn, publiceert de volgende uitrol de
site vanzelf.

## Stappen

### 1. Serverinfo verzamelen (Elmer of Cowork, in hPanel of bij de VPS-aanbieder)

- IPv4-adres en eventueel IPv6-adres van de VPS.
- Besturingssysteem: Ubuntu 24.04 of Debian 12. Als dat niet zo is, eerst aan Elmer vragen of
  herinstalleren mag; dat wist de server.
- Minimaal 2 vCPU, 4 GB RAM en 40 GB schijf.
- Root-toegang met SSH.
- **Draait er al iets op de server?** Bijvoorbeeld een andere website, of iets op poort 80 en 443.
  Zo ja: **stoppen en Elmer vragen.** Caddy heeft poort 80 en 443 nodig.

### 2. DNS bij Hostinger

Ga in hPanel naar **Domeinen → curtain.fit → DNS / Nameservers → DNS-records** en zet:

| Type | Naam | Waarde | TTL |
|---|---|---|---|
| A | `@` | IPv4 van de VPS | 300 |
| A | `www` | IPv4 van de VPS | 300 |
| A | `app` | IPv4 van de VPS | 300 |
| A | `api` | IPv4 van de VPS | 300 |
| AAAA | dezelfde vier | IPv6 van de VPS | 300 (alleen als de VPS IPv6 heeft) |

- Verwijder bestaande `A`- of `CNAME`-records voor `@` en `www` die naar Hostinger-hosting of een
  parkeerpagina wijzen. Noteer eerst wat er stond.
- Staat er een CAA-record, dan moet dat `letsencrypt.org` toestaan.
- Controleer met `dig +short curtain.fit app.curtain.fit api.curtain.fit www.curtain.fit`: alle vier
  moeten het IP-adres van de VPS geven. Dit kan tot een uur duren.

### 3. Uitrolsleutel maken (op Elmers laptop)

```sh
ssh-keygen -t ed25519 -N '' -C curtain-deploy -f ~/.ssh/curtain_deploy
```

Gebruik deze sleutel alleen voor de uitrol. De private sleutel blijft op de laptop en gaat daarna in
stap 5 naar GitHub.

### 4. Server inrichten (eenmalig, als root, vanuit een lokale clone van de repo)

```sh
git clone https://github.com/elmeremanuels/dFittrd.git && cd dFittrd && git checkout claude/garment-engine
```

```sh
ssh root@<VPS-IP> 'bash -s' -- --pubkey "$(cat ~/.ssh/curtain_deploy.pub)" < scripts/deploy-bootstrap.sh
```

- Het script doet het volgende:
  - installeert Docker en een firewall (poort 22, 80 en 443);
  - zet automatische beveiligingsupdates aan;
  - maakt de gebruiker `deploy`, nachtelijke back-ups en `/etc/curtain/curtain.env` met
    zelfgegenereerde geheimen.
- Je kunt het veilig opnieuw draaien.
- Het script print een host-fingerprint. Noteer die, want je hebt hem nodig in stap 5.
- Test daarna `ssh -i ~/.ssh/curtain_deploy deploy@<VPS-IP>`. Werkt dat, draai het script dan nog één
  keer met `--harden-ssh` erbij. Dat zet inloggen met een wachtwoord uit.

Vul daarna **op de server** de rest van de geheimen in:

```sh
ssh root@<VPS-IP>
nano /etc/curtain/curtain.env
```

- `ACME_EMAIL`: Elmers e-mailadres, voor meldingen van Let's Encrypt. Nodig voor de eerste uitrol.
- `SHOPIFY_API_KEY` en `SHOPIFY_API_SECRET`: pas in stap 8 nodig, mag nu leeg.
- `BACKUP_AGE_RECIPIENT`: maak met `age-keygen -o curtain-backup.key` een sleutel op de laptop en neem
  de `age1…`-regel over.
  - **Bewaar het bestand `curtain-backup.key` veilig buiten de server**, bijvoorbeeld in een
    wachtwoordmanager.
  - Zonder dat bestand zijn de back-ups niet terug te zetten.

### 5. GitHub instellen (`github.com/elmeremanuels/dFittrd` → Settings)

1. **Environments → New environment → `production`**:
   - *Required reviewers*: Elmer.
   - *Deployment branches and tags* → *Selected* → `main` en `release`.
   - *Allow administrators to bypass*: **uit**.
2. Zet in die environment deze *Environment secrets*:
   - `VPS_HOST` = het IP-adres van de VPS.
   - `VPS_USER` = `deploy`.
   - `VPS_SSH_KEY` = de hele inhoud van `~/.ssh/curtain_deploy`, inclusief de kop- en voetregel.
   - `VPS_SSH_KNOWN_HOSTS` = de uitvoer van `ssh-keyscan -t ed25519 <VPS-IP>`. Vergelijk de
     fingerprint met die van stap 4.
3. Zet onder *Secrets and variables → Actions → Variables* de variabele `DOMAIN` = `curtain.fit`.

### 6. Code naar `main` brengen

De uitrol draait alleen vanaf `main` of `release`, en `main` is nu leeg op een init-commit na. Elmer
moet beslissen hoe het werk daar komt:
- **Aanbevolen:** een pull request van `claude/garment-engine` naar `main`, door Elmer beoordeeld en
  gemerged. De bouwsessie kan die PR openen als Elmer daarom vraagt.
- Controleer na de merge in het tabblad *Actions* dat de workflows `deploy` en `shopify-deploy`
  zichtbaar zijn.

### 7. Eerste uitrol

Ga naar *Actions* → **deploy** → *Run workflow* → branch `main`, actie `deploy`.

1. Elmer keurt goed in de *production*-melding.
2. De stappen zijn guard, check, web, site, image en deploy. De eerste keer duurt het iets langer,
   omdat Caddy de certificaten ophaalt. Een gele waarschuwing bij **site** ("curtain.fit not
   published") is verwacht zolang de launch gates open staan; de rest gaat gewoon door.
3. Controleer daarna:
   - `https://api.curtain.fit/healthz` geeft OK;
   - `https://app.curtain.fit/` laadt;
   - als de site-stap groen was zonder waarschuwing: `https://curtain.fit` laadt en
     `https://www.curtain.fit` stuurt door naar `https://curtain.fit`.
4. Gaat er iets mis, dan rolt de workflow zelf terug. Geef de stap en de foutmelding door aan de
   bouwsessie; plak geen geheimen.

### 8. Shopify koppelen (na de eerste geslaagde uitrol)

De stappen staan in `docs/DEPLOY.md`, onder "Shopify app deploy" → "Set once":

1. Partner Dashboard → **Apps → Create app → Create app manually**. Naam: `Curtain: Fit & Size Finder`.
   Gebruik níet `shopify app init`.
2. **Client ID**:
   - als GitHub repository secret `SHOPIFY_API_KEY`;
   - en als `SHOPIFY_API_KEY` in `/etc/curtain/curtain.env`.
3. **Client secret**: **alleen** als `SHOPIFY_API_SECRET` in `/etc/curtain/curtain.env`. Daarna de
   uitrol opnieuw draaien, zodat de API de sleutel inleest.
4. **Settings → CLI token** → maak er een met een korte geldigheid en zet die als GitHub secret
   `SHOPIFY_CLI_PARTNERS_TOKEN`.
5. **Stores → Add store → Create development store**. Dit is de testwinkel.
6. *Actions* → **shopify-deploy** draaien. Daarna de app installeren op de testwinkel en testen:
   - een productpagina met de knop "Try it on";
   - het maatadvies;
   - de knop "Choose size".
7. **Pas als dat werkt en Elmer akkoord geeft:**
   - *Distribution → Custom distribution* met het `*.myshopify.com`-adres van Bohohippychic. **Deze
     keuze is definitief.**
   - Daarna de installatielink naar Bohohippychic sturen.

## Wat nog bij Elmer ligt (niet door Cowork beslissen)

- Proeftijd en wat er gebeurt na de proef. De prijs is USD 8,99 per maand.
- Of de appnaam definitief is. Er is ook een merkrechtvraag; zie checklist E1 in de docs.
- Juridische check van de privacyverklaring en de voorwaarden.
- Voor de website (`apps/site/src/data/site.ts`, uitleg in `docs/SITE.md`; daarna een nieuwe uitrol):
  - officiële bedrijfsnaam (`legalName`), adres (`company.address`), KvK-nummer (`company.registration`)
    en btw-nummer (`company.vat`, als die er is);
  - de mailbox `hello@curtain.fit` aanmaken bij Hostinger (of een doorstuuradres) en dan `mailboxReady: true`;
  - juridische check van de wachtlijstverklaring op `/legal/#waitlist`, dan `waitlistNoticeReviewed: true`;
  - de 3D-schattingen van de Azure-jurk en de maxirok naast de foto's bekijken (op `/`, `/3d/` en `/pilot/`).
    Goed genoeg: `partner.estimatesReviewed: true`. Niet goed genoeg: de schattingen van die pagina's halen
    (REFINEMENT B2);
  - optioneel: proeftijd (`trialDays`), reactietijd, apart privacy-adres.
- Bohohippychic: toestemming is gegeven. Bewaar de schriftelijke bevestiging; een citaat van hen komt
  alleen op de site als ze zelf een tekst aanleveren. Vraag ze ook te bevestigen dat de productfoto's van
  henzelf zijn (of dat ze ze mogen doorgeven, inclusief de rechten van de modellen), en of ze als
  "Bohohippychic" of "Boho Hippy Chic" genoemd willen worden.
- DNS bij Hostinger: bij het weghalen van de parkeerrecords voor `@` en `www` de mailrecords (MX, SPF,
  DKIM) laten staan.
- De 3D-schatting staat bij echte winkels uit tot de goedkeuringsknoppen in het winkelbeheer er zijn.

## Terugmelden aan de bouwsessie

Meld na elke stap kort terug, **zonder geheimen**:
- wat er gedaan is;
- het IP-adres (dat is geen geheim);
- de uitkomst van `dig` en `/healthz`;
- en bij problemen de naam van de stap en de foutregel.
