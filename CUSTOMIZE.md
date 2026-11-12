# Creating a Custom Snakes & Ladders Edition Pack

The **Snakes & Ladders** engine is completely topic-agnostic. All scenarios, architecture/domain quiz questions, board tiers, milestones, and documentation link allowlists live in standalone JSON files inside [`packs/`](packs/).

You can create a custom edition—such as **Google Cloud × Wiz Security Edition**, **Apigee API Management Edition**, or **Looker BI Edition**—in 4 steps without touching a single line of game engine code.

---

## Step 1: Generate Your Pack JSON Using an LLM

Copy the prompt below into Gemini, Claude, ChatGPT, or your AI coding assistant. Replace the bracketed placeholders at the top with your topic details:

```markdown
You are a senior Principal Architect and curriculum designer for [YOUR TOPIC, e.g., "Google Cloud × Wiz Cloud Security Posture Management"].

Generate a complete, valid JSON pack file for the Snakes & Ladders game engine matching the exact schema below.

### Topic & Scope
- Pack ID: `[kebab-case-id, e.g., gcloud-wiz-security]`
- Edition Title: `[e.g., Google Cloud × Wiz Edition]`
- Allowed Documentation Hosts: `["docs.cloud.google.com", "cloud.google.com", "www.wiz.io"]`
- Categories / Pillars (4 to 8): `[e.g., IAM & Identity, Attack Path Analysis, Kubernetes Security, Data DSPM, Network Perimeter, Incident Response]`

### Content Requirements
1. **Scenario Pools**:
   - **At least 18 Ladders** (`"ladders"` array): Architectural upgrades, controls, or best practices that accelerate production readiness.
   - **At least 18 Snakes** (`"snakes"` array): Real-world misconfigurations, outages, or attack paths that set teams back. Every snake MUST include non-empty `"prevent"`, `"detect"`, and `"recover"` remediation guidance.
   - **At least 16 Shields** (`"shields"` array): Preventive guardrails or detective controls that grant +1 Resilience Shield.
2. **Strict Constraints**:
   - Every item's `"shortTag"` MUST be **12 characters or fewer** (including spaces) so it fits cleanly inside a board tile.
   - Every `"docUrl"` MUST start with `https://` and use one of the `allowedDocHosts`.
   - Every ladder and snake MUST include a 3-option multiple-choice question (`"q"`, `"opts"` of length 3, `"ans"` in `0..2`, and `"why"`). Shields may optionally include a quiz question as well.

### Required JSON Schema
Output ONLY valid JSON matching this exact structure:
{
  "meta": {
    "id": "your-pack-id",
    "title": "Snakes & Ladders: Your Edition Name",
    "editionBadge": "Your Edition Badge",
    "subtitle": "One-sentence description of what players learn on the board",
    "allowedDocHosts": ["docs.cloud.google.com", "cloud.google.com"],
    "tiers": [
      "Tier 5 (81–100): Autonomous Operations",
      "Tier 4 (61–80): Zero-Trust & Resilience",
      "Tier 3 (41–60): Scale & Automation",
      "Tier 2 (21–40): Core Controls",
      "Tier 1 (1–20): Foundation"
    ],
    "milestones": {
      "1": {
        "shortTag": "Start",
        "badge": "Milestone",
        "jump": "Tile 1",
        "title": "Tile 1 — Project Kickoff",
        "quip": "Every production architecture starts at Tile 1.",
        "tip": "Answer quiz challenges on Ladders, Shields, and Snakes to advance to Tile 100.",
        "docLabel": "Documentation Overview",
        "docUrl": "https://docs.cloud.google.com/"
      },
      "100": {
        "shortTag": "Go-Live",
        "badge": "Milestone",
        "jump": "Tile 100",
        "title": "Tile 100 — Production Go-Live!",
        "quip": "Zero-downtime global launch achieved!",
        "tip": "Review your post-game readiness breakdown across all domains.",
        "docLabel": "Architecture Framework",
        "docUrl": "https://docs.cloud.google.com/architecture/framework"
      }
    }
  },
  "ladders": [
    {
      "id": "lad-example-1",
      "shortTag": "Short <=12ch",
      "category": "Category 1",
      "title": "Service Name: Actionable Best Practice",
      "quip": "1-2 sentences describing what the team implemented.",
      "tip": "Core architectural takeaway and why it works.",
      "docLabel": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "q": "Scenario-based multiple-choice question?",
      "opts": [
        "Plausible distractor A",
        "Correct architectural choice B",
        "Plausible distractor C"
      ],
      "ans": 1,
      "why": "Clear technical explanation of why option B is right and why A and C fail."
    }
  ],
  "snakes": [
    {
      "id": "snk-example-1",
      "shortTag": "Short <=12ch",
      "category": "Category 2",
      "title": "Service Name: Production Misconfiguration or Outage",
      "quip": "What broke or was misconfigured in production.",
      "tip": "Core architectural takeaway.",
      "prevent": "How to prevent this issue architecturally.",
      "detect": "How to detect this early via telemetry/policy.",
      "recover": "How to remediate and recover safely.",
      "docLabel": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "q": "Recovery/mitigation multiple-choice question?",
      "opts": [
        "Correct architectural fix",
        "Plausible distractor 1",
        "Plausible distractor 2"
      ],
      "ans": 0,
      "why": "Detailed explanation."
    }
  ],
  "shields": [
    {
      "id": "shd-example-1",
      "shortTag": "Short <=12ch",
      "category": "Category 3",
      "title": "Service Name: Proactive Guardrail",
      "quip": "What proactive control was enabled.",
      "tip": "Grants +1 Resilience Shield to block a future outage.",
      "docLabel": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "q": "Optional or required quiz question for this shield?",
      "opts": [
        "Distractor 1",
        "Distractor 2",
        "Correct choice"
      ],
      "ans": 2,
      "why": "Detailed explanation."
    }
  ]
}
```

---

## Step 2: Save & Register Your Pack

1. Save your generated JSON to `packs/<your-pack-id>.json`.
2. Add an entry to [`packs/manifest.json`](packs/manifest.json):
   ```json
   {
     "id": "gcloud-wiz-security",
     "title": "Google Cloud × Wiz Security Edition",
     "editionBadge": "Cloud × Wiz Edition",
     "file": "packs/gcloud-wiz-security.json",
     "description": "Cloud security posture, attack path analysis, IAM, and container security"
   }
   ```
   *(Optional)* Change `"defaultPack"` in `packs/manifest.json` if you want your new pack to load by default.

---

## Step 3: Validate & Bundle

Run the zero-dependency validator script to check all schema constraints (`shortTag <= 12` chars, 3 options per question, `prevent`/`detect`/`recover` on snakes, and allowed documentation hosts):

```bash
python3 scripts/validate_pack.py packs/<your-pack-id>.json
```

Then update the offline bundle (`scenarios.js`) so the game also works when opened directly via `file://`:

```bash
python3 scripts/bundle_packs.py
```

---

## Step 4: Test Locally & Share

Start the local server:

```bash
python3 server.py 8080
```

Open `http://localhost:8080` (or link directly to your pack with `http://localhost:8080/?pack=<your-pack-id>`).
