#!/usr/bin/env python3
"""Build a local, privacy-preserving song manifest from Mineradio data."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def read_feedback(file: Path) -> dict[str, float]:
    weights: dict[str, float] = {}
    if not file.exists():
        return weights
    event_weight = {"save": 3.0, "like": 3.0, "play": 1.0, "skip": -1.0}
    with file.open("r", encoding="utf-8") as stream:
        for line in stream:
            try:
                row = json.loads(line)
                key = str(row.get("key") or "").lower()
                weights[key] = weights.get(key, 0.0) + event_weight.get(str(row.get("event") or ""), 0.0)
            except Exception:
                continue
    return weights


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("library_index", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--feedback", type=Path)
    args = parser.parse_args()
    source = json.loads(args.library_index.read_text(encoding="utf-8"))
    feedback = read_feedback(args.feedback) if args.feedback else {}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with args.output.open("w", encoding="utf-8") as stream:
        for record in source.get("records", []):
            local_id = str(record.get("id") or "")
            if not local_id:
                continue
            # The public dataset id is stable without exposing the user's original path.
            public_id = hashlib.sha256(local_id.encode("utf-8")).hexdigest()[:24]
            row = {
                "id": public_id, "local_file_id": local_id,
                "title": record.get("name") or "", "artist": record.get("artist") or "",
                "album": record.get("album") or "", "duration": record.get("duration") or 0,
                "audio_path": record.get("audioPath") or "", "cover_path": record.get("coverPath") or "",
                "preference_weight": feedback.get(("local:" + local_id).lower(), feedback.get(local_id.lower(), 0.0)),
            }
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    print(json.dumps({"ok": True, "tracks": count, "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




