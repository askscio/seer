#!/usr/bin/env python3
"""Collate niti runs across three agents into a compact scores-only CSV.

A1 = single_flow_metadata   (ee48307cbf174c19b6946fb7c5583307) — split across
     niti-full/, niti-full-resume-a1/, niti-full-resume-a1-q5-v2/, niti-full-resume-a1-q6/
A2 = single_flow            (00f0c8f443c6499f934a46f10524b3e9) — niti-full-a2a3/
A3 = ta_ai_assistant        (96c9e83e381345469b42a07fed94386d) — niti-ta-retry/
"""
import csv
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

A1_SOURCES = [
    ("niti-full",                 "runs/niti-full/single_flow_metadata.csv"),
    ("niti-full-resume-a1",       "runs/niti-full-resume-a1/single_flow_metadata.csv"),
    ("niti-full-resume-a1-q5-v2", "runs/niti-full-resume-a1-q5-v2/single_flow_metadata.csv"),
    ("niti-full-resume-a1-q6",    "runs/niti-full-resume-a1-q6/single_flow_metadata.csv"),
]
A2_SOURCE = ("niti-full-a2a3", "runs/niti-full-a2a3/single_flow.csv")
A3_SOURCE = ("niti-ta-retry",  "runs/niti-ta-retry/ta_ai_assistant.csv")


def load(path):
    rows = {}
    with open(os.path.join(ROOT, path)) as fp:
        for row in csv.DictReader(fp):
            rows[int(row["row_number"])] = row
    return rows


def pick_a1(row_num, buckets):
    """Prefer a run with status==ok AND populated accuracy; else last seen."""
    best = None
    for label, by_row in buckets:
        if row_num in by_row:
            r = by_row[row_num]
            if r.get("status") == "ok" and r.get("answer_accuracy_category"):
                return label, r
            best = (label, r)
    return best if best else (None, None)


def score(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def avg(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def tool_call_count(raw):
    if not raw:
        return 0
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return len(parsed)
        if isinstance(parsed, dict):
            return 1
    except Exception:
        pass
    return raw.count('"toolName"') or raw.count('"tool"')


def url_count(raw):
    if not raw:
        return 0
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return len(parsed)
    except Exception:
        pass
    return sum(1 for s in raw.split("|") if s.strip().startswith("http"))


def winner_of(scores, prefer="high"):
    """Given {label: value} (possibly None), return winning label or 'tie'.

    prefer='high' picks max, 'low' picks min. Ties return 'tie'.
    Missing values are treated as worst.
    """
    present = {k: v for k, v in scores.items() if v is not None}
    if not present:
        return "tie"
    if prefer == "high":
        best = max(present.values())
    else:
        best = min(present.values())
    winners = [k for k, v in present.items() if v == best]
    return winners[0] if len(winners) == 1 else "tie"


def main():
    a1_buckets = [(label, load(path)) for label, path in A1_SOURCES]
    a2 = load(A2_SOURCE[1])
    a3 = load(A3_SOURCE[1])

    out_path = os.path.join(ROOT, "runs/collated-niti/niti-collated.csv")
    summary_path = os.path.join(ROOT, "runs/collated-niti/niti-summary.csv")

    fieldnames = [
        "row_number", "question", "golden_source",
        # A1
        "a1_source_run", "a1_status", "a1_latency_ms", "a1_trace_id",
        "a1_tool_calls", "a1_cited_url_count",
        "a1_accuracy_cat", "a1_accuracy_score",
        "a1_completeness_cat", "a1_completeness_score",
        "a1_citation_cat", "a1_citation_score",
        "a1_avg_quality_score",
        # A2
        "a2_status", "a2_latency_ms", "a2_trace_id",
        "a2_tool_calls", "a2_cited_url_count",
        "a2_accuracy_cat", "a2_accuracy_score",
        "a2_completeness_cat", "a2_completeness_score",
        "a2_citation_cat", "a2_citation_score",
        "a2_avg_quality_score",
        # A3
        "a3_status", "a3_latency_ms", "a3_trace_id",
        "a3_tool_calls", "a3_cited_url_count",
        "a3_accuracy_cat", "a3_accuracy_score",
        "a3_completeness_cat", "a3_completeness_score",
        "a3_citation_cat", "a3_citation_score",
        "a3_avg_quality_score",
        # winners
        "winner_accuracy", "winner_completeness", "winner_citation",
        "winner_latency", "winner_quality_overall",
    ]

    rows_out = []
    for rn in range(1, 23):
        label, a1 = pick_a1(rn, a1_buckets)
        a2row = a2.get(rn)
        a3row = a3.get(rn)

        def agent_block(r):
            acc = score(r["answer_accuracy_score"]) if r else None
            cmp = score(r["answer_completeness_score"]) if r else None
            cit = score(r["citation_correctness_score"]) if r else None
            lat = score(r["latency_ms"]) if r else None
            return {
                "acc_cat": (r or {}).get("answer_accuracy_category", ""),
                "cmp_cat": (r or {}).get("answer_completeness_category", ""),
                "cit_cat": (r or {}).get("citation_correctness_category", ""),
                "acc": acc, "cmp": cmp, "cit": cit, "lat": lat,
                "avg": avg([acc, cmp, cit]),
                "status": (r or {}).get("status", "missing"),
                "trace": (r or {}).get("trace_id", ""),
                "tools": tool_call_count((r or {}).get("tool_calls", "")),
                "cited": url_count((r or {}).get("cited_doc_urls", "")),
            }

        A = agent_block(a1)
        B = agent_block(a2row)
        C = agent_block(a3row)

        seed = a1 or a2row or a3row or {}
        rows_out.append({
            "row_number": rn,
            "question": seed.get("question", ""),
            "golden_source": seed.get("golden_source", ""),

            "a1_source_run": label or "",
            "a1_status": A["status"],
            "a1_latency_ms": (a1 or {}).get("latency_ms", ""),
            "a1_trace_id": A["trace"],
            "a1_tool_calls": A["tools"],
            "a1_cited_url_count": A["cited"],
            "a1_accuracy_cat": A["acc_cat"], "a1_accuracy_score": A["acc"] if A["acc"] is not None else "",
            "a1_completeness_cat": A["cmp_cat"], "a1_completeness_score": A["cmp"] if A["cmp"] is not None else "",
            "a1_citation_cat": A["cit_cat"], "a1_citation_score": A["cit"] if A["cit"] is not None else "",
            "a1_avg_quality_score": A["avg"] if A["avg"] is not None else "",

            "a2_status": B["status"],
            "a2_latency_ms": (a2row or {}).get("latency_ms", ""),
            "a2_trace_id": B["trace"],
            "a2_tool_calls": B["tools"],
            "a2_cited_url_count": B["cited"],
            "a2_accuracy_cat": B["acc_cat"], "a2_accuracy_score": B["acc"] if B["acc"] is not None else "",
            "a2_completeness_cat": B["cmp_cat"], "a2_completeness_score": B["cmp"] if B["cmp"] is not None else "",
            "a2_citation_cat": B["cit_cat"], "a2_citation_score": B["cit"] if B["cit"] is not None else "",
            "a2_avg_quality_score": B["avg"] if B["avg"] is not None else "",

            "a3_status": C["status"],
            "a3_latency_ms": (a3row or {}).get("latency_ms", ""),
            "a3_trace_id": C["trace"],
            "a3_tool_calls": C["tools"],
            "a3_cited_url_count": C["cited"],
            "a3_accuracy_cat": C["acc_cat"], "a3_accuracy_score": C["acc"] if C["acc"] is not None else "",
            "a3_completeness_cat": C["cmp_cat"], "a3_completeness_score": C["cmp"] if C["cmp"] is not None else "",
            "a3_citation_cat": C["cit_cat"], "a3_citation_score": C["cit"] if C["cit"] is not None else "",
            "a3_avg_quality_score": C["avg"] if C["avg"] is not None else "",

            "winner_accuracy":       winner_of({"a1": A["acc"], "a2": B["acc"], "a3": C["acc"]}),
            "winner_completeness":   winner_of({"a1": A["cmp"], "a2": B["cmp"], "a3": C["cmp"]}),
            "winner_citation":       winner_of({"a1": A["cit"], "a2": B["cit"], "a3": C["cit"]}),
            "winner_latency":        winner_of({"a1": A["lat"], "a2": B["lat"], "a3": C["lat"]}, prefer="low"),
            "winner_quality_overall":winner_of({"a1": A["avg"], "a2": B["avg"], "a3": C["avg"]}),
        })

    with open(out_path, "w", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows_out)
    print(f"wrote {out_path}")

    def agg(values):
        vals = [v for v in values if v is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 2), min(vals), max(vals)

    def cat_dist(values):
        c = Counter(v for v in values if v)
        return "; ".join(f"{k}={n}" for k, n in sorted(c.items(), key=lambda kv: -kv[1]))

    def col(prefix, field):
        return [score(r[f"{prefix}_{field}"]) for r in rows_out]

    with open(summary_path, "w", newline="") as fp:
        w = csv.writer(fp)
        w.writerow(["metric", "a1_single_flow_metadata", "a2_single_flow", "a3_ta_ai_assistant"])

        w.writerow(["questions_evaluated",
                    sum(1 for v in col("a1", "accuracy_score") if v is not None),
                    sum(1 for v in col("a2", "accuracy_score") if v is not None),
                    sum(1 for v in col("a3", "accuracy_score") if v is not None)])

        for label, field in [
            ("accuracy_avg / min / max",     "accuracy_score"),
            ("completeness_avg / min / max", "completeness_score"),
            ("citation_avg / min / max",     "citation_score"),
            ("latency_ms_avg / min / max",   "latency_ms"),
        ]:
            row = [label]
            for prefix in ("a1", "a2", "a3"):
                s = agg(col(prefix, field))
                row.append(f"{s[0]} / {s[1]} / {s[2]}" if s else "n/a")
            w.writerow(row)

        for label, field in [
            ("accuracy_categories",     "accuracy_cat"),
            ("completeness_categories", "completeness_cat"),
            ("citation_categories",     "citation_cat"),
        ]:
            w.writerow([label] + [cat_dist([r[f"{p}_{field}"] for r in rows_out]) for p in ("a1", "a2", "a3")])

        h2h = Counter()
        for r in rows_out:
            h2h[r["winner_quality_overall"]] += 1
        w.writerow(["h2h_overall_wins (a1 / a2 / a3 / tie)",
                    f"{h2h['a1']} / {h2h['a2']} / {h2h['a3']} / {h2h['tie']}", "", ""])

    print(f"wrote {summary_path}")

    # Compact stdout report
    print()
    print(f"{'q':>3} | {'A1 acc/cmp/cit':^18} | {'A2 acc/cmp/cit':^18} | {'A3 acc/cmp/cit':^18} |  A1 lat |  A2 lat |  A3 lat | quality winner")
    print("-" * 125)
    def fmt(v):
        return "-" if v in (None, "") else str(v)
    for r in rows_out:
        print(f"{r['row_number']:>3} | "
              f"{fmt(r['a1_accuracy_score']):>4}/{fmt(r['a1_completeness_score']):>4}/{fmt(r['a1_citation_score']):>4}     | "
              f"{fmt(r['a2_accuracy_score']):>4}/{fmt(r['a2_completeness_score']):>4}/{fmt(r['a2_citation_score']):>4}     | "
              f"{fmt(r['a3_accuracy_score']):>4}/{fmt(r['a3_completeness_score']):>4}/{fmt(r['a3_citation_score']):>4}     | "
              f"{fmt(r['a1_latency_ms']):>7} | {fmt(r['a2_latency_ms']):>7} | {fmt(r['a3_latency_ms']):>7} | "
              f"{r['winner_quality_overall']}")


if __name__ == "__main__":
    main()
