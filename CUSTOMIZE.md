# Creating a Custom Snakes & Ladders Edition Pack

The **Snakes & Ladders** engine is completely topic-agnostic. All scenarios, architecture/domain quiz questions, board tiers, milestones, and documentation link allowlists live in standalone JSON files inside [`packs/`](packs/).

You can create a custom edition—such as **Google Cloud Security Edition**, **Google Cloud × Wiz Edition**, **GKE Platform Engineering**, or **FinOps Edition**—in 4 steps without touching a single line of game engine code.

---

## Step 1: Generate Your Pack JSON Using an LLM

Copy the prompt below into Gemini, Claude, ChatGPT, or your AI coding assistant. Replace the bracketed placeholders at the top with your topic details:

```markdown
You are a senior Principal Architect and curriculum designer for [YOUR TOPIC, e.g., "Google Cloud Security & Wiz Cloud Security Posture Management"].

Generate a complete, valid JSON pack file for the Snakes & Ladders game engine matching the exact schema below.

### Topic & Scope
- Pack ID: `[kebab-case-id, e.g., gcloud-wiz-security]`
- Edition Title: `[e.g., Google Cloud × Wiz Security Edition]`
- Allowed Documentation Hosts: `["docs.cloud.google.com", "cloud.google.com", "www.wiz.io"]`
- Categories / Pillars (4 to 8): `[e.g., IAM & Identity, Attack Path Analysis, Kubernetes & Container Security, Data DSPM, Network Perimeter, Incident Response]`

### Content Requirements
1. **Scenarios (`scenarios` object)**:
   - Generate at least:
     - **18 Ladders** (`"type": "ladder"`, `"delta"` between `+8` and `+16`): Architectural upgrades, controls, or best practices that accelerate production readiness.
     - **18 Snakes** (`"type": "snake"`, `"delta"` between `-8` and `-17`): Real-world misconfigurations, outages, or attack paths that set teams back. Every snake MUST include `"prevent"`, `"detect"`, and `"recover"` remediation guidance.
     - **16 Shields** (`"type": "shield"`, `"delta": 0`): Preventive guardrails, detective controls, or automated policies that grant +1 Resilience Shield.
     - **2 Milestones** (`"type": "milestone"`, keys `"ms-tile-1"` and `"ms-tile-100"`): Tile 1 kickoff and Tile 100 victory scenarios.
   - **Strict constraints**:
     - Every scenario's `"shortTag"` MUST be **12 characters or fewer** (including spaces) so it fits cleanly inside a board tile.
     - Every `"docUrl"` MUST start with `https://` and use one of the `allowedDocHosts`.
     - Every `"questionIds"` array must reference valid keys in `"questionBank"`.

2. **Question Bank (`questionBank` object)**:
   - Generate at least **36 multiple-choice questions** (`q-1`, `q-2`, ...).
   - Every question MUST have:
     - `"prompt"`: A realistic scenario-based question.
     - `"options"`: Exactly **3 strings** (1 correct answer, 2 plausible distractors).
     - `"answerIndex"`: `0`, `1`, or `2`.
     - `"rationale"`: Clear technical explanation of why the correct option works and why the others fail.
     - `"docUrl"` and `"docLabel"`.

### Required JSON Schema
Output ONLY valid JSON matching this exact structure:
{
  "meta": {
    "id": "your-pack-id",
    "title": "Snakes & Ladders",
    "edition": "Your Edition Name",
    "subtitle": "One-sentence description of what players learn on the board",
    "version": "1.0.0",
    "author": "Your Name or Team",
    "defaultDocHost": "docs.cloud.google.com",
    "allowedDocHosts": ["docs.cloud.google.com", "cloud.google.com"],
    "categories": ["Category 1", "Category 2", "Category 3", "Category 4"],
    "tiers": [
      { "rows": [0, 1], "name": "Tier 1 (1–20): Foundation" },
      { "rows": [2, 3], "name": "Tier 2 (21–40): Core Controls" },
      { "rows": [4, 5], "name": "Tier 3 (41–60): Scale & Automation" },
      { "rows": [6, 7], "name": "Tier 4 (61–80): Zero-Trust & Resilience" },
      { "rows": [8, 9], "name": "Tier 5 (81–100): Autonomous Operations" }
    ]
  },
  "milestones": {
    "1": { "shortTag": "Start", "scenarioId": "ms-tile-1" },
    "100": { "shortTag": "Go-Live", "scenarioId": "ms-tile-100" }
  },
  "scenarios": {
    "ld-example": {
      "type": "ladder",
      "delta": 12,
      "shortTag": "Short <=12ch",
      "category": "Category 1",
      "service": "Service Name",
      "title": "Actionable Title",
      "happened": "1-2 sentences describing what the team implemented.",
      "impact": "1-2 sentences describing the measurable engineering benefit.",
      "lesson": "Core architectural takeaway.",
      "docTitle": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "questionIds": ["q-1"]
    },
    "sn-example": {
      "type": "snake",
      "delta": -12,
      "shortTag": "Short <=12ch",
      "category": "Category 2",
      "service": "Service Name",
      "title": "Actionable Incident Title",
      "happened": "What broke or was misconfigured in production.",
      "impact": "Blast radius and operational impact.",
      "lesson": "Core architectural takeaway.",
      "prevent": "How to prevent this issue architecturally.",
      "detect": "How to detect this early via telemetry/policy.",
      "recover": "How to remediate and recover safely.",
      "docTitle": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "questionIds": ["q-2"]
    },
    "sh-example": {
      "type": "shield",
      "delta": 0,
      "shortTag": "Short <=12ch",
      "category": "Category 3",
      "service": "Service Name",
      "title": "Guardrail Title",
      "happened": "What proactive control was enabled.",
      "impact": "Grants +1 Resilience Shield to block a future outage.",
      "lesson": "Core architectural takeaway.",
      "docTitle": "Official Doc Title",
      "docUrl": "https://docs.cloud.google.com/...",
      "questionIds": ["q-3"]
    }
  },
  "questionBank": {
    "q-1": {
      "prompt": "Scenario question text?",
      "options": [
        "Correct architectural choice",
        "Plausible distractor 1",
        "Plausible distractor 2"
      ],
      "answerIndex": 0,
      "rationale": "Detailed explanation.",
      "docUrl": "https://docs.cloud.google.com/...",
      "docLabel": "Official Doc Title"
    }
  }
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
     "edition": "Cloud Security Edition",
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
