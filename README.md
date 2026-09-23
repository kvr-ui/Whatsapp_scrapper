# FOCAS Leads Console

WhatsApp community lead extraction, stored in MongoDB, with a dashboard and
two CSV export formats. Deploys to Vercel.

```
┌─────────────────────┐      ┌──────────────────┐      ┌───────────────────┐
│  WhatsApp Web       │─────▶│  MongoDB Atlas   │◀─────│  Dashboard        │
│  (headless Chromium │      │  leads           │      │  filter + export  │
│   in a Vercel fn)   │      │  sources         │      │  WATI / full CSV  │
│                     │      │  sync_runs       │      │                   │
│  weekly Vercel Cron │      │  wa session      │      │                   │
└─────────────────────┘      └──────────────────┘      └───────────────────┘
```

---

## What it does

- **Extracts** every community, subgroup, standalone group, broadcast list and
  channel the linked WhatsApp account can see, plus the account's own saved
  contacts, resolving `@lid` privacy identifiers to real phone numbers via the
  contact store.
- **Stores** each person once, keyed by phone number, with one entry per
  community they belong to. Re-syncing never duplicates a lead and never
  overwrites when they were first seen.
- **Runs weekly** — every Monday 02:00 UTC (07:30 IST) via Vercel Cron.
- **Exports** two CSV shapes: a WATI campaign upload and a full-detail dump.
  Both honour whatever filters the Leads page has applied.

### Saved contacts

The address book is swept as its own source (`Saved contacts`). It is the only
source that needs no `@lid` resolution — the numbers are already real — so it
is usually the highest-yield one after communities. By default it takes only
numbers actually saved on the linked phone; pass `allContacts` to `runSync` to
widen it to everyone WhatsApp knows the account has dealt with, which is much
larger and much noisier.

### What channels can actually give you

Channels are the most closed surface WhatsApp has, and the yield is nothing
like a group's:

- Only a channel's **own admins** can pull a subscriber list at all. A channel
  you merely follow returns nothing — the sync records it and reports it in the
  sync log as `channel(s) would not list subscribers`, rather than silently
  filing it as empty.
- Even as an admin, subscribers come back as `@lid` identifiers. Those become
  real phone numbers only for people the **linked phone already has saved as a
  contact**; everyone else is stored under their `@lid` and shows up in the
  `Unresolved` column on Sources.

So expect a channel with thousands of subscribers to produce a few dozen
dialable leads. That is a WhatsApp restriction, not a gap in the extractor —
groups and communities remain the volume sources.

---

## Setup

### 1. Environment

Copy `.env.example` to `.env.local` and fill it in:

| Variable | What it is |
|---|---|
| `ENGINE_MONGO_URL` | MongoDB Atlas connection string. The database named in the URI is the one used. |
| `DASHBOARD_PASSWORD` | Password for the dashboard login screen. |
| `AUTH_SECRET` | Random string signing the session cookie — `openssl rand -hex 32`. |
| `CRON_SECRET` | Shared secret authorising the weekly cron endpoint. |

### 2. Install and run

```bash
npm install
npm run dev          # http://localhost:3000
```

### 3. Backfill the old exports (optional, one-off)

Loads the `.txt` files in `legacy/exports/` so the dashboard is not empty on
day one. Safe to re-run — it merges rather than duplicates.

```bash
npm run import-legacy
```

### 4. Link WhatsApp

Either from the dashboard (**Setup → Generate QR code**) or the terminal:

```bash
npm run link-whatsapp
```

Scan with **WhatsApp → Settings → Linked Devices → Link a Device**.

The session is written to MongoDB, not to disk, so linking once locally is
enough for the deployed app to sync. Keep the linked phone online — WhatsApp
Web mirrors the phone, so a phone that is off means a sync finds no groups.

---

## Deploying to Vercel

```bash
vercel                                    # link the project
vercel env add ENGINE_MONGO_URL
vercel env add DASHBOARD_PASSWORD
vercel env add AUTH_SECRET
vercel env add CRON_SECRET
vercel --prod
```

Then, in the Vercel dashboard:

1. **Settings → Functions → Fluid compute: On.** The sync function needs a
   300-second ceiling; without Fluid compute it is capped at 60s and every
   sync will time out.
2. **Settings → Cron Jobs** — confirm `/api/cron/weekly` is registered. It
   comes from `vercel.json`; Vercel sends `CRON_SECRET` as a bearer token
   automatically.
3. In **MongoDB Atlas → Network Access**, allow `0.0.0.0/0`. Vercel functions
   do not have static egress IPs on Hobby/Pro.

### The one real constraint

`whatsapp-web.js` drives a full headless Chromium. Inside a Vercel function it
must boot Chromium, restore the session from MongoDB, load WhatsApp Web and
wait for the chat store to sync — typically 90–180 seconds. That fits inside
the 300s ceiling for accounts of this size, but it is the tightest part of the
system.

**If a sync times out**, nothing is lost — the run is recorded as failed in the
sync log. Run it from your own machine instead, against the same database:

```bash
npm run sync
```

This is the identical code path with no time limit, and the dashboard picks up
the results immediately.

---

## The two CSV exports

Both are on the **Leads** page and the **Overview** page, and both respect the
active filters (source, type, role, resolved/unresolved, date added, search).

### WATI campaign CSV

```csv
Name,WhatsApp Number,Country Code,Source,Community,Groups,Role
Ajay,916379610559,91,community,FOCAS:Your Last Attempt-Sep'26,Last Attempt Workout Batch - Sep 26,Member
```

- `WhatsApp Number` is **digits only, country code included, no `+`** — WATI's
  bulk-upload format.
- Columns past `Name` and `WhatsApp Number` are imported by WATI as custom
  attributes, which is how Source/Community/Groups/Role become filterable
  inside WATI.
- Leads whose number never resolved are **excluded** — WATI cannot message an
  `@lid`. The count of what was actually written is in the `X-Row-Count`
  response header.
- If a lead has no name, the number is used, since WATI requires the field.

To change the column set, edit `toWatiCsv()` in [lib/csv.ts](lib/csv.ts).

### All details CSV

Every field held for every lead, including unresolved ones: both phone formats,
country code, `@lid`, highest role, all sources, all groups, counts, first/last
seen and active flag.

---

## Project layout

```
app/
  page.tsx              Overview — stats, weekly growth, sources, recent syncs
  leads/                Filterable lead table + exports
  sources/              Communities, groups, broadcast lists, channels, contacts
  syncs/                Sync history
  setup/                QR pairing
  login/
  api/
    export/             ?format=wati|full  + the same filters as /api/leads
    sync/               POST runs a sync now
    cron/weekly/        Vercel Cron target
    whatsapp/           link / status / unlink
lib/
  mongo.ts              Cached connection + indexes
  types.ts              Lead, Source, SyncRun shapes
  repo.ts               Queries and filters
  csv.ts                The two export formats
  format.ts             Phone normalisation, country codes, dates
  wa/
    client.ts           Chromium + RemoteAuth(MongoDB) client factory
    extract.ts          Reads the WhatsApp Web store
    store.ts            Merge logic — dedup, history, membership diffing
    sync.ts             Orchestrates one run
    link.ts             QR pairing flow
scripts/
  run-sync.ts           npm run sync — local, no time limit
  link-whatsapp.ts      npm run link-whatsapp — terminal QR
  import-legacy.ts      npm run import-legacy — backfill the old .txt files
legacy/                 The original standalone scripts, kept for reference
```

---

## Data model

**`leads`** — one document per person, `_id` is the phone number (or the `@lid`
when WhatsApp exposes no number).

```js
{
  _id: "916379610559",
  phone: "916379610559",
  lid: "...@lid",
  name: "Ajay",
  countryCode: "91",
  sources: [
    { type: "community", sourceId: "1203...@g.us", sourceLabel: "FOCAS:Your Last Attempt-Sep'26",
      groups: ["Last Attempt Workout Batch - Sep 26", "FOCAS Test Room - Sep'26"],
      role: "Member", firstSeenAt: ..., lastSeenAt: ... }
  ],
  firstSeenAt: ..., lastSeenAt: ..., active: true
}
```

`firstSeenAt` is never overwritten, which is what makes "new this week" and the
weekly growth chart meaningful. When a lead disappears from a re-synced source
that membership is dropped; a lead left with no memberships is marked
`active: false` rather than deleted.

**`sources`** — per-community/list summary. **`sync_runs`** — run history with
stats and errors. **`wa_session_state`** — pairing status and current QR.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `WhatsApp is not linked` | No session in MongoDB. Setup → Generate QR code. |
| `Stored session is no longer valid` | The device was unlinked from the phone. Re-pair. |
| `No groups synced` | The linked phone is offline. |
| Sync times out on Vercel | Enable Fluid compute; otherwise run `npm run sync` locally. |
| Many unresolved numbers | Those contacts are not in the linked phone's address book, so WhatsApp exposes only an `@lid`. Saving them as contacts on that phone resolves them on the next sync. |
# Whatsapp_scrapper
