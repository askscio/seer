# Seer Features

## Completed

### Core Eval Engine (Phase 1 — Feb 12)
- SQLite database with 6 tables (eval_sets, eval_cases, eval_criteria, eval_runs, eval_results, eval_scores)
- 10 default scoring criteria: 4 continuous, 1 categorical, 2 binary, 3 metric
- LLM-as-judge via Glean Chat API
- CLI commands: create sets, add cases, run evals, view results
- Drizzle ORM with migrations

### Agent Integration (Phase 2 — Feb 13)
- Agent execution via `POST /rest/api/v1/runworkflow` with CHAT-scoped key
- Trace metadata: workflowTraceId, agentTraceInfo, tool calls, reasoning chains
- Auto-detect form-based vs chat-style agents via schema API
- Schema caching within eval runs

### Smart Generation (Phase 3 — Feb 13)
- ADVANCED toolkit agent with `enableCompanyTools: true` for grounded generation
- Two-phase: find real inputs from CRM/docs → generate expected outputs per input
- Raw fetch (bypasses SDK — ADVANCED not in Zod enum yet)
- CONTENT vs UPDATE message filtering for clean text extraction

### Web UI (Phase 2-3 — Feb 13)
- Next.js dashboard with eval set cards, run history, score display
- Eval set detail with editable test cases (inline edit/delete)
- Run results table with expandable details, score color coding
- Markdown rendering (react-markdown + @tailwindcss/typography)
- Settings page for API key management (saves to data/settings.json)
- Shared SQLite database between CLI and web

### Configuration
- Unified `GLEAN_API_KEY` (chat + search + agents scopes)
- Config priority: data/settings.json → .env → error
- Legacy key fallback (GLEAN_CHAT_API_KEY, GLEAN_AGENT_API_KEY)

---

## In Progress

### Judge Refactor
- Move judge to ADVANCED agent infra with Opus 4.6 (`modelSetId: "OPUS_4_6_VERTEX"`)
- Research-backed prompt templates (XML-structured, CoT-then-score, behavioral anchoring)
- QA pair grading patterns (input + expected + actual → score)
- Reference guides written: `docs/guide-petri-judge-patterns.md`, `docs/guide-judge-best-practices.md`

---

## Planned

### Multi-Judge Ensemble
Run same eval with multiple judge models. Compute inter-rater agreement, confidence intervals, and flag high-disagreement cases. Helps validate scoring reliability.
- Files to create: `src/lib/ensemble.ts`, `src/lib/reliability.ts`
- New CLI flag: `--ensemble model1,model2`
- Consensus threshold and flagging

### Custom Criteria Builder
Let users define their own scoring criteria beyond the 10 defaults. Custom rubrics, score types, and weights.
- UI page for creating/editing criteria
- Per-eval-set criteria selection
- Custom rubric text editor

### Eval Comparison View
Compare two runs side-by-side to see if agent changes improved scores. A/B testing for agents.
- Web UI: select two runs, view diff
- Score delta per case and criterion
- Regression detection

---

## Known Limitations

- **Token counts** not available via REST API (FR-2147). See `docs/TRACE_API_LIMITATIONS.md`
- **Web build** has Drizzle type mismatch (dev server works, production build fails on strict types)
- **SDK version** doesn't support ADVANCED agent mode — using raw fetch as workaround
