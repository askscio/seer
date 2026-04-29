#!/usr/bin/env python3
"""Collate niti runs into a *full-detail* side-by-side CSV.

Unlike collate-niti-runs.py (which trims to headline metrics), this produces every
column from the per-agent CSVs, prefixed with a1_/a2_/a3_, so a single row per
question contains the full record from all three agents.

A1 = single_flow_metadata   (ee48307cbf174c19b6946fb7c5583307)
A2 = single_flow            (00f0c8f443c6499f934a46f10524b3e9)
A3 = ta_ai_assistant        (96c9e83e381345469b42a07fed94386d)
"""
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

A1_SOURCES = [
    ("niti-full",                 "runs/niti-full/single_flow_metadata.csv"),
    ("niti-full-resume-a1",       "runs/niti-full-resume-a1/single_flow_metadata.csv"),
    ("niti-full-resume-a1-q5-v2", "runs/niti-full-resume-a1-q5-v2/single_flow_metadata.csv"),
    ("niti-full-resume-a1-q6",    "runs/niti-full-resume-a1-q6/single_flow_metadata.csv"),
]
A2_SOURCE = ("niti-full-a2a3", "runs/niti-full-a2a3/single_flow.csv")
A3_SOURCE = ("niti-ta-retry", "runs/niti-ta-retry/ta_ai_assistant.csv")

# Columns that belong to the evaluation case itself (shared, not agent-specific).
SHARED_COLS = ["row_number", "user_email", "question", "golden_answer", "golden_source"]

# Columns that are per-agent (need a1_/a2_ prefix).
PER_AGENT_COLS = [
    "status", "error",
    "agent_response", "latency_ms", "trace_id",
    "retrieved_doc_urls", "cited_doc_urls", "tool_calls",
    "answer_accuracy_category", "answer_accuracy_score", "answer_accuracy_reasoning",
    "answer_completeness_category", "answer_completeness_score", "answer_completeness_reasoning",
    "citation_correctness_category", "citation_correctness_score", "citation_correctness_reasoning",
    "latency_category", "latency_score", "latency_reasoning",
]


def load(path):
    rows = {}
    with open(os.path.join(ROOT, path)) as fp:
        for row in csv.DictReader(fp):
            rows[int(row["row_number"])] = row
    return rows


def pick_a1(row_num, buckets):
    """Prefer a row with status == 'ok' and judge scores populated; else last seen."""
    fallback = None
    for label, by_row in buckets:
        if row_num not in by_row:
            continue
        r = by_row[row_num]
        if r.get("status") == "ok" and r.get("answer_accuracy_category"):
            return label, r
        fallback = (label, r)
    return fallback if fallback else (None, None)


def main():
    a1_buckets = [(label, load(path)) for label, path in A1_SOURCES]
    a2 = load(A2_SOURCE[1])
    a3 = load(A3_SOURCE[1])

    out_path = os.path.join(ROOT, "runs/collated-niti/niti-collated-full.csv")

    fieldnames = (
        SHARED_COLS
        + ["a1_source_run"]
        + [f"a1_{c}" for c in PER_AGENT_COLS]
        + [f"a2_{c}" for c in PER_AGENT_COLS]
        + [f"a3_{c}" for c in PER_AGENT_COLS]
    )

    with open(out_path, "w", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=fieldnames)
        w.writeheader()
        for rn in range(1, 23):
            label, a1 = pick_a1(rn, a1_buckets)
            a2row = a2.get(rn)
            a3row = a3.get(rn)
            seed = a1 or a2row or a3row or {}

            out = {c: seed.get(c, "") for c in SHARED_COLS}
            out["row_number"] = rn
            out["a1_source_run"] = label or ""
            for c in PER_AGENT_COLS:
                out[f"a1_{c}"] = (a1 or {}).get(c, "")
                out[f"a2_{c}"] = (a2row or {}).get(c, "")
                out[f"a3_{c}"] = (a3row or {}).get(c, "")
            w.writerow(out)

    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
