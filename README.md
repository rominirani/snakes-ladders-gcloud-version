# Snakes & Ladders — Pluggable Google Cloud Editions

![Snakes & Ladders — Cloud Architect Edition](cover-illustration.jpg)

An interactive, single-viewport 10×10 **Snakes & Ladders** architecture board game where every ladder, snake, and resilience shield teaches real-world cloud engineering lessons and tests your knowledge with scenario-based multiple-choice challenges.

Built with a **pluggable JSON pack engine** so anyone can clone this repository, use the included LLM prompt template to generate a new scenario & question bank (e.g., *Google Cloud Security*, *Google Cloud × Wiz*, *GKE SRE*, *FinOps*), validate it locally, and host it anywhere.

- **Live Demo (All Packs):** https://snakes-ladders-cloud-architect-415458962931.us-central1.run.app
- **Direct Link — Cloud Architect Edition:** https://snakes-ladders-cloud-architect-415458962931.us-central1.run.app/?pack=cloud-architect
- **Direct Link — Google Cloud Databases Edition:** https://snakes-ladders-cloud-architect-415458962931.us-central1.run.app/?pack=cloud-databases

---

## Included Edition Packs

| Edition Pack | Pack ID | Scenarios | Quiz Questions | Focus Areas |
| :--- | :--- | :---: | :---: | :--- |
| **Cloud Architect Edition** | `cloud-architect` | **220** *(93 Ladders, 75 Snakes, 50 Shields, 2 Milestones)* | **168** | Compute, GKE, Serverless, IAM, Networking, Storage, Databases, Data & Analytics, AI/ML, CI/CD, Observability, FinOps |
| **Google Cloud Databases Edition** | `cloud-databases` | **54** *(18 Ladders, 18 Snakes, 16 Shields, 2 Milestones)* | **36** | AlloyDB, Cloud Spanner, Cloud SQL, Firestore, Bigtable, Memorystore, DMS & Datastream |

Switch editions anytime using the **Edition selector dropdown** in the top header or via the `?pack=<pack-id>` URL query parameter.

---

## How Gameplay Works

1. **Roll & Traverse the 100-Tile Board:** Start at Tile 1 (*Project Kickoff*) and navigate 5 progressive architectural tiers up to Tile 100 (*Production Go-Live*).
2. **Architecture Quiz Gating:**
   - **Ladders (Green):** Answer a 3-option architecture quiz question correctly to validate your design and climb the ladder. A wrong answer forfeits the climb.
   - **Resilience Shields (Gold):** Answer correctly to earn **+1 Resilience Shield** in your HUD.
   - **Snakes (Red):** Answer a recovery quiz question correctly (or spend a Resilience Shield) to cut the outage blast radius in half (`ceil(|delta| / 2)`). Missing the quiz triggers the full slide back—complete with **Prevent / Detect / Recover** remediation guidance.
3. **Click-to-Inspect Mode:** Toggle **Mode: Play / Inspect** in the header to click any tile on the board and review its architectural scenario and official documentation link without rolling.
4. **Post-Game Architecture Readiness Report:** Reaching Tile 100 generates a breakdown of your quiz accuracy across every domain category, weak-domain study links, and a one-click shareable summary.

---

## Run Locally (Zero Dependencies)

Requires only **Python 3.9+** (standard library only; no `npm install` or `pip install` needed):

```bash
git clone https://github.com/rominirani/snakes-ladders-gcloud-version.git
cd snakes-ladders-gcloud-version
python3 server.py 8080
```

Then open **http://127.0.0.1:8080** in your browser.

> **Offline `file://` mode:** You can also open `index.html` directly in a browser without a web server; `scenarios.js` bundles all registered packs as an automatic fallback.

---

## Customize & Create Your Own Edition Pack

Want to create a **Google Cloud Security Edition**, **Google Cloud × Wiz Edition**, or a custom training game for your organization?

See **[CUSTOMIZE.md](CUSTOMIZE.md)** for the complete guide and copy-pasteable **LLM Prompt Template**.

### Quick Summary of the Customization Workflow

1. **Generate a Pack JSON:** Copy the prompt template in [`CUSTOMIZE.md`](CUSTOMIZE.md) into Gemini, Claude, or ChatGPT to generate `packs/<your-pack-id>.json` (or ask your AI coding agent in this repo—see [`GEMINI.md`](GEMINI.md)).
2. **Register the Pack:** Add your pack entry to [`packs/manifest.json`](packs/manifest.json).
3. **Validate Schema & Constraints:**
   ```bash
   python3 scripts/validate_pack.py
   ```
   Checks that all scenarios have `shortTag <= 12` chars, snakes include `prevent`/`detect`/`recover`, questions have 3 options, and `docUrl` links match `meta.allowedDocHosts`.
4. **Bundle for Offline Fallback:**
   ```bash
   python3 scripts/bundle_packs.py
   ```
5. **Test Locally:**
   ```bash
   python3 server.py 8080
   # Visit http://127.0.0.1:8080/?pack=<your-pack-id>
   ```

---

## Hosting & Deployment Guide

Because the app consists of static assets (`index.html`, `styles.css`, `game.js`, `scenarios.js`, `packs/*.json`) paired with an optional hardened Python server (`server.py` + `Dockerfile`), you can host it anywhere:

### Option 1: Google Cloud Run (Recommended — Hardened Container)
Includes strict Content Security Policy (CSP) headers, in-memory gzip pre-compression, ETag caching, per-IP rate limiting, and `max-instances=1` cost guardrails:

```bash
gcloud run deploy snakes-ladders-cloud-architect \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated \
  --max-instances=1 \
  --memory=256Mi \
  --cpu=1 \
  --cpu-throttling \
  --concurrency=80 \
  --timeout=10s
```

### Option 2: GitHub Pages / Cloudflare Pages / Netlify
1. Push your fork or branch to GitHub.
2. In your repository settings, enable **GitHub Pages** deploying from the root (`/`) of your `main` branch.
3. Both `fetch('packs/manifest.json')` and `?pack=<id>` work automatically on any static host.

### Option 3: Firebase Hosting
```bash
firebase init hosting   # Set public directory to "." and single-page app to "No"
firebase deploy --only hosting
```

---

## Project Structure

```text
├── index.html                 # Main single-viewport game shell & modals
├── styles.css                 # Responsive dark-mode glassmorphic UI styles
├── game.js                    # Topic-agnostic 10x10 board & quiz engine
├── scenarios.js               # Auto-generated offline bundle (from bundle_packs.py)
├── server.py                  # Hardened zero-dependency Python HTTP server
├── Dockerfile                 # Production container image for Cloud Run
├── packs/
│   ├── manifest.json          # Registry of available edition packs
│   ├── cloud-architect.json   # Cloud Architect Edition (220 scenarios, 168 questions)
│   └── cloud-databases.json   # Google Cloud Databases Edition (54 scenarios, 36 questions)
├── scripts/
│   ├── validate_pack.py       # Schema & constraint validator for packs/*.json
│   └── bundle_packs.py        # Regenerates scenarios.js from packs/manifest.json
├── CUSTOMIZE.md               # Copy-paste LLM prompt template & contributor guide
└── GEMINI.md                  # AI coding agent instructions for automated pack authoring
```
