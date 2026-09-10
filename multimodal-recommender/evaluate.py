#!/usr/bin/env python3
"""Compute ranking metrics for Mineradio recommendation JSONL data."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def load_rows(file: Path):
    with file.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            query_id = str(row.get("query_id") or row.get("recommendationId") or "")
            candidate_id = str(row.get("candidate_id") or row.get("key") or "")
            if not query_id or not candidate_id:
                continue
            event = str(row.get("event") or "")
            default_label = {"save": 3, "like": 3, "play": 2, "skip": 0, "impression": 0}.get(event, 0)
            yield query_id, {
                "candidate_id": candidate_id,
                "label": max(0.0, float(row.get("label", default_label) or 0)),
                "score": float(row.get("score", -float(row.get("rank", 0) or 0)) or 0),
                "rank": int(row.get("rank", 0) or 0),
            }


def metrics(rows, cutoffs):
    groups = defaultdict(dict)
    for query_id, row in rows:
        previous = groups[query_id].get(row["candidate_id"])
        if previous is None or row["label"] > previous["label"]:
            groups[query_id][row["candidate_id"]] = row
    totals = {f"recall@{k}": 0.0 for k in cutoffs}
    totals.update({f"ndcg@{k}": 0.0 for k in cutoffs})
    totals["mrr"] = 0.0
    evaluated = 0
    for candidates in groups.values():
        relevant = [item for item in candidates.values() if item["label"] > 0]
        if not relevant:
            continue
        ranked = sorted(candidates.values(), key=lambda item: (item["rank"] <= 0, item["rank"] if item["rank"] > 0 else -item["score"], -item["score"]))
        evaluated += 1
        first_hit = next((index + 1 for index, item in enumerate(ranked) if item["label"] > 0), None)
        if first_hit:
            totals["mrr"] += 1.0 / first_hit
        ideal = sorted((item["label"] for item in candidates.values()), reverse=True)
        for cutoff in cutoffs:
            top = ranked[:cutoff]
            hits = sum(1 for item in top if item["label"] > 0)
            totals[f"recall@{cutoff}"] += hits / len(relevant)
            dcg = sum((2 ** item["label"] - 1) / math.log2(index + 2) for index, item in enumerate(top))
            idcg = sum((2 ** label - 1) / math.log2(index + 2) for index, label in enumerate(ideal[:cutoff]))
            totals[f"ndcg@{cutoff}"] += dcg / idcg if idcg else 0
    return {"queries": evaluated, **{name: round(value / evaluated, 6) if evaluated else 0 for name, value in totals.items()}}


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate Recall@K, NDCG@K and MRR")
    parser.add_argument("input", type=Path)
    parser.add_argument("--k", default="5,10,20")
    args = parser.parse_args()
    cutoffs = sorted({max(1, int(value)) for value in args.k.split(",") if value.strip()})
    print(json.dumps(metrics(load_rows(args.input), cutoffs), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




