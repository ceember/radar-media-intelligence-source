# Radar Media Intelligence — Corresponding Source

This is the modified Radar by Massimo Scognamiglio and contributors (https://github.com/Scognamiglio1969/radar-intelligence) for https://radar-media-intelligence.vercel.app.

Corresponding source for production commit `e2b8e1b79bf8f149fb50f750dc2d3416ae1257b7`. See deployment history for when it went live. This snapshot contains no private development history, credentials, operational evidence or client datasets. Licence: GNU AGPL-3.0; see LICENSE and NOTICE. Planet textures: Solar System Scope, https://www.solarsystemscope.com/textures/, CC BY 4.0. Bundled font attribution: app/fonts/OFL.txt.

## Build And Run

Use Node.js 24 and npm. No external database or provider credential is needed to build. Local storage uses embedded PGlite unless you configure your own DATABASE_URL. The live deployment remains open test mode; no authentication policy is changed by publishing this source.

```sh
npm ci --ignore-scripts
npx next typegen
npx tsc --noEmit
SOURCE_COMMIT=e2b8e1b79bf8f149fb50f750dc2d3416ae1257b7 npm run build
RADAR_OPEN_TEST=1 npm start
```

Before starting against a new database, set ADMIN_EMAIL to your own administrator address; there is no default. Set RADAR_CONTACT_EMAIL to your own contact address to enable integrations that require a contact-bearing user agent; missing configuration refuses those calls. Neither setting is needed to build. Set ADMIN_PASSWORD yourself for an authenticated deployment; open test mode is not suitable for untrusted private data.

Optional RADAR_COMPETITOR_SEED_JSON supplies your own exact projectId/projectName, buttonLabel and pages, with an optional adLibraryNote. No client seed data is distributed. RADAR_RESTRICTED_BRANDS_JSON must be a nonempty JSON array of your own policy names before finance-gated processing is enabled; missing, empty or invalid policy refuses it. Private ingestion requires explicitly configured APP_URL, RADAR_PUBLIC_INGEST_ORIGIN and RADAR_PUBLIC_INGEST_ROOT with valid custody records; quota enforcement outside open test mode requires RADAR_PROVIDER_QUOTA_ROOT. These integrations have no internal deployment defaults. The optional local usage ledger requires Python 3; its runtime source is included at lib/openrouter_ledger.py.

Supply your own provider credentials only if you choose to enable external integrations. Do not place credentials in source control. Build dependencies are resolved by package-lock.json. Production schedules are recorded in vercel.json. The export intentionally omits private tests and operational scripts; the inherited npm test command is not available in this source-only distribution.

Third-party source, asset and licence attributions are retained in NOTICE and LICENSE. This repository does not contain live user data.
