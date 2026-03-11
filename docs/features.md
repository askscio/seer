# Seer Features

## Completed

### Core Eval Engine (Phase 1 — Feb 12)
- SQLite database with 6 tables (eval_sets, eval_cases, eval_criteria, eval_runs, eval_results, eval_scores)
- LLM-as-judge via Glean Chat API
- CLI commands: create sets, add cases, run evals, view results
- Drizzle ORM with migrations

### Agent Integration (Phase 2 — Feb 13)
- Agent execution via `POST /rest/api/v1/runworkflow` with unified API key
- Trace metadata: workflowTraceId, agentTraceInfo, tool calls, reasoning chains
- Auto-detect form-based vs chat-style agents via schema API
- Schema caching within eval runs
- Correct internal API payload format (workflowId, fields, author/fragments)

### Smart Generation (Phase 3 — Feb 13)
- ADVANCED toolkit agent with `enableCompanyTools: true`
- Two-phase: find real inputs from CRM/docs → generate grounded eval guidance per input
- Raw fetch bypasses SDK Zod validation (ADVANCED not in enum)
- CONTENT vs UPDATE message filtering for clean text extraction

### Three-Call Judge Architecture (Phase 4 — Feb 17)
- **Call 1 (Coverage):** Reference-based scoring against eval guidance. Theme decomposition (COVERED/TOUCHED/MISSING)
- **Call 2 (Faithfulness):** Reference-free scoring against agent's own reasoning chain. No expected answer needed
- **Call 3 (Factuality):** Search-verified via ADVANCED agent. Judge independently searches company data. Cites sources per claim
- All calls use Opus 4.6 via `modelSetId: OPUS_4_6_VERTEX`
- XML-tagged output parsing replaces fragile regex

### Categorical Scoring (Phase 4 — Feb 17)
- Replaced 0-10 continuous scales with 5-level categories: full/substantial/partial/minimal/failure
- Based on I/O psychology SJT research (15% reliability gain, 37% validity gain)
- Categories map to numeric values for aggregation (full=10, substantial=7.5, etc.)
- Judge commits to a defined bucket instead of picking an arbitrary number

### Multi-Judge Ensemble (Phase 4 — Feb 17)
- `--multi-judge` flag runs through Opus 4.6 + GPT-5 (Gemini available via ADVANCED)
- Majority vote aggregation for categorical scores
- Each judge's reasoning preserved in output
- Graceful degradation if a model fails
- CLI + web UI support

### Web UI (Phases 2-4 — Feb 13-17)
- Next.js dashboard with eval set cards, run history, score display
- **Eval set detail page** redesigned: latest run hero, run history, collapsed test inputs
- **Run eval modal**: Quick/Deep/Custom modes, multi-judge picker (select 1+ models)
- Editable test cases with inline edit/delete
- Results table with expandable details, categorical score badges
- Markdown rendering (react-markdown + @tailwindcss/typography)
- Settings page for API key management (saves to data/settings.json)
- **Research-backed tooltips** throughout UI (citing SJT, G-Eval, RAGAS, FreshQA, Verga)

### Glean-Branded Frontend (Phase 4 — Feb 17)
- DM Sans + DM Mono typography (Glean's fallback fonts)
- Electric Blue (#343CED) primary actions
- Oatmeal (#F6F3EB) warm backgrounds
- Cement (#777767) secondary text
- Custom card shadows, warm borders, score traffic lights
- `prose-seer` markdown class with Glean-toned variables

### Configuration
- Unified `GLEAN_API_KEY` (chat + search + agents + documents scopes)
- Config priority: data/settings.json → .env → error
- Legacy key fallback (GLEAN_CHAT_API_KEY, GLEAN_AGENT_API_KEY)

### Documentation & Research
- Evaluation framework spec (`docs/evaluation-framework.md`)
- 4 research guides: Petri patterns, best practices, QA judge prompts, dynamic eval
- GKO presentation deck for AIOM team training
- Full architecture and feature tracking docs

---

## Planned

### Custom Criteria Builder
Let users define their own scoring criteria with custom rubrics via UI.
- Per-eval-set criteria selection
- Custom rubric text editor

### Eval Comparison View
Compare two runs side-by-side. A/B testing for agents.
- Score delta per case and criterion
- Regression detection

### Instance-Specific Rubrics
Generate rubrics per-query (not just per-agent). Smart generator produces theme checklists with importance tagging (CRITICAL/IMPORTANT/SUPPLEMENTARY).
- Per Rubric RL research (Wolfe, 2025)

### Historical Execution Mining
Generate eval sets from real agent runs (Glean internal pattern) instead of synthetic QA pairs.
- Avoids staleness problem entirely

---

## Known Limitations

- **Token counts** not available via REST API (FR-2147). See `docs/TRACE_API_LIMITATIONS.md`
- **Web build** has Drizzle type mismatch (dev server works, production build fails on strict types)
- **SDK version** doesn't support ADVANCED agent mode or modelSetId — using raw fetch
- **Static eval guidance** can go stale as company data changes — faithfulness judge (reference-free) mitigates this
