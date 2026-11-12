#!/usr/bin/env python3
"""Schema and guardrail validator for Snakes & Ladders Edition Packs (`packs/*.json`).

Usage:
  python3 scripts/validate_pack.py               # Validates all packs in packs/manifest.json
  python3 scripts/validate_pack.py packs/my.json # Validates a specific pack file
"""

import json
import os
import sys
from urllib.parse import urlparse

ROOT_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MAX_SHORT_TAG_LEN = 12


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}", file=sys.stderr)


def validate_pack_file(path: str) -> bool:
    print(f"Validating {os.path.relpath(path, ROOT_DIR)}...")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        fail(f"Invalid JSON: {exc}")
        return False

    ok = True
    meta = data.get("meta", {})
    for field in ("id", "title", "editionBadge", "subtitle", "allowedDocHosts", "tiers", "milestones"):
        if field not in meta:
            fail(f"Missing meta.{field}")
            ok = False

    allowed_hosts = set(meta.get("allowedDocHosts", []))
    tiers = meta.get("tiers", [])
    if not isinstance(tiers, list) or len(tiers) != 5:
        fail("meta.tiers must be a list of exactly 5 board tier labels (top to bottom)")
        ok = False

    milestones = meta.get("milestones", {})
    for sq_key in ("1", "100"):
        ms = milestones.get(sq_key)
        if not isinstance(ms, dict):
            fail(f"Missing meta.milestones['{sq_key}']")
            ok = False
        else:
            for req in ("shortTag", "badge", "jump", "title", "quip", "tip", "docLabel", "docUrl"):
                if not ms.get(req):
                    fail(f"meta.milestones['{sq_key}'] missing '{req}'")
                    ok = False

    ladders = data.get("ladders", [])
    snakes = data.get("snakes", [])
    shields = data.get("shields", [])

    if len(ladders) < 7:
        fail(f"Need at least 7 ladders (found {len(ladders)})")
        ok = False
    if len(snakes) < 7:
        fail(f"Need at least 7 snakes (found {len(snakes)})")
        ok = False
    if len(shields) < 6:
        fail(f"Need at least 6 shields (found {len(shields)})")
        ok = False

    seen_ids: set[str] = set()

    def check_common(item: dict, kind: str, idx: int) -> None:
        nonlocal ok
        item_id = item.get("id", "")
        if not item_id:
            fail(f"{kind}[{idx}] missing 'id'")
            ok = False
        elif item_id in seen_ids:
            fail(f"Duplicate scenario id '{item_id}'")
            ok = False
        else:
            seen_ids.add(item_id)

        tag = item.get("shortTag", "")
        if not tag or len(tag) > MAX_SHORT_TAG_LEN:
            fail(f"{kind}[{idx}] ({item_id}): shortTag '{tag}' must be 1..{MAX_SHORT_TAG_LEN} chars")
            ok = False

        for field in ("title", "quip", "tip", "docLabel", "docUrl"):
            if not item.get(field):
                fail(f"{kind}[{idx}] ({item_id}) missing '{field}'")
                ok = False

        url = item.get("docUrl", "")
        if url:
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in allowed_hosts or " " in url:
                fail(
                    f"{kind}[{idx}] ({item_id}): docUrl '{url}' must be https:// in allowedDocHosts {sorted(allowed_hosts)}"
                )
                ok = False

    def check_question(item: dict, kind: str, idx: int) -> None:
        nonlocal ok
        item_id = item.get("id", f"{kind}[{idx}]")
        if not item.get("q") or not item.get("why"):
            fail(f"{item_id} missing question 'q' or rationale 'why'")
            ok = False
        opts = item.get("opts")
        if not isinstance(opts, list) or len(opts) != 3 or not all(isinstance(x, str) and x.strip() for x in opts):
            fail(f"{item_id}: 'opts' must be a list of 3 non-empty strings")
            ok = False
        ans = item.get("ans")
        if ans not in (0, 1, 2):
            fail(f"{item_id}: 'ans' must be 0, 1, or 2")
            ok = False

    for i, lad in enumerate(ladders):
        check_common(lad, "ladders", i)
        check_question(lad, "ladders", i)

    for i, snk in enumerate(snakes):
        check_common(snk, "snakes", i)
        check_question(snk, "snakes", i)
        for pdr in ("prevent", "detect", "recover"):
            if not snk.get(pdr):
                fail(f"snakes[{i}] ({snk.get('id')}) missing '{pdr}' debrief field")
                ok = False

    for i, shd in enumerate(shields):
        check_common(shd, "shields", i)

    if ok:
        total = len(ladders) + len(snakes) + len(shields) + 2
        q_count = len(ladders) + len(snakes)
        print(
            f"  [PASS] {meta.get('editionBadge')}: {total} scenarios "
            f"({len(ladders)} ladders, {len(snakes)} snakes, {len(shields)} shields, 2 milestones) "
            f"& {q_count} questions."
        )
    return ok


def main() -> int:
    targets = sys.argv[1:]
    if not targets:
        manifest_path = os.path.join(ROOT_DIR, "packs", "manifest.json")
        if not os.path.isfile(manifest_path):
            fail("packs/manifest.json not found")
            return 1
        with open(manifest_path, "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
        targets = [os.path.join(ROOT_DIR, p["file"]) for p in manifest.get("packs", [])]

    all_ok = True
    for target in targets:
        if not validate_pack_file(target):
            all_ok = False
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
