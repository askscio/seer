# Seer Features & Development Log

**Tracks completed features, in-progress work, and planned enhancements**

---

## ✅ Completed Features

### Phase 0: Project Setup
**Completed:** 2026-02-12

- [x] Project structure created - Initial directory layout
- [x] Dependencies installed - Bun + TypeScript + Commander + Drizzle
- [x] TypeScript configuration - Strict mode, path resolution
- [x] Environment template - `.env.example` with all required keys
- [x] Project documentation - README.md, CLAUDE.md
- [x] Core types defined - Domain models in `src/types.ts`
- [x] Git setup - `.gitignore` configured

**Files:** 7 | **Time:** ~30 minutes

---

### Phase 1: MVP - CLI + SQLite + All Scoring Types
**Completed:** 2026-02-12

#### Database Layer
- [x] Full relational schema - 6 tables with foreign keys
  - `eval_sets` - Eval set collections
  - `eval_cases` - Individual test queries
  - `eval_criteria` - Scoring dimensions
  - `eval_runs` - Evaluation executions
  - `eval_results` - Agent responses + metrics
  - `eval_scores` - Individual criterion scores
- [x] Migration system - Drizzle Kit integration
- [x] Seed script - Default criteria insertion
- [x] Bun SQLite integration - Native SQLite driver
- [x] Query helpers - Type-safe database operations

**Location:** `src/db/`

#### Default Criteria (10 total)
- [x] **Continuous (0-10):** 4 criteria
  - Task Success - Did agent complete the task?
  - Factual Groundedness - Response grounded in facts?
  - Relevance - How relevant to query?
  - Instruction Following - Followed instructions?
- [x] **Categorical:** 1 criterion
  - Response Completeness - complete/partial/incomplete
- [x] **Binary:** 2 criteria
  - Tool Usage Correctness - yes/no
  - Safety - yes/no
- [x] **Metrics:** 3 criteria
  - Response Latency - milliseconds
  - Token Efficiency - total tokens
  - Tool Call Count - number of tool invocations

**Location:** `src/criteria/defaults.ts`

#### Glean Integration
- [x] Agent API client - Execute custom Glean agents
- [x] Schema fetching - Auto-detect form vs chat agents
- [x] Dual input support - Form-based and chat-style
- [x] Response parsing - Extract text from GLEAN_AI messages
- [x] Tool call extraction - Parse tool usage from responses
- [x] Latency measurement - Accurate timing

**Location:** `src/data/glean.ts`

#### Judge Implementation
- [x] Anthropic Claude support - Primary judge model
- [x] OpenAI GPT support - Alternative judge (future)
- [x] Continuous scoring - 0-10 with detailed rubric
- [x] Categorical scoring - Category selection with definitions
- [x] Binary scoring - Yes/no with reasoning
- [x] Metric extraction - Direct measurement (no LLM)
- [x] Structured prompt generation - Per score type
- [x] Response parsing - Regex + fallback
- [x] Reasoning capture - Store judge explanations

**Location:** `src/lib/judge.ts`

#### CLI Commands
- [x] `seer set create` - Create new eval set
- [x] `seer set add-case` - Add test cases
- [x] `seer set view` - View eval set details
- [x] `seer run <set-id>` - Run evaluation
- [x] `seer results <run-id>` - View detailed results
- [x] `seer list sets` - List all eval sets
- [x] `seer list runs` - List all runs
- [x] CLI-safe ID generation - No leading dashes
- [x] Interactive prompts - Add cases flow
- [x] Colored output - Chalk integration

**Location:** `src/cli.ts`

#### Validation
- [x] TypeScript compiles - No errors
- [x] Database schema applied - Migrations run successfully
- [x] Default criteria seeded - 10 criteria inserted
- [x] Eval set creation works - End-to-end tested
- [x] Test case addition works - Interactive flow tested
- [x] Listing commands work - Database queries functional

**Files:** 16 | **Time:** ~4-5 hours

---

## ✅ Completed Features (Continued)

### Phase 2C: AI Eval Set Generation
**Completed:** 2026-02-13

- [x] `src/lib/generate.ts` - AI generation logic
- [x] Metadata generation - Set name + description via Glean chat
- [x] Test case generation - Grounded in company context
- [x] Schema awareness - Fetch agent schema, generate appropriate cases
- [x] Human review workflow - Preview before save (CLI + Web)
- [x] CLI command: `seer generate` - Generate from terminal
- [x] Web UI integration - "Generate with AI" button
- [x] API endpoint: `/api/generate` - Web UI backend

**Goal:** Use Glean chat to generate eval sets automatically

**Files:** 4 (generate.ts, CLI update, API route, UI update)

---

## 🚧 In Progress

*No active development work*

---

### Phase 2A: Documentation Structure
**Status:** Complete ✓
**Completed:** 2026-02-13

- [x] `docs/architecture.md` - System architecture and component design
- [x] `docs/features.md` - **This file** - Feature tracking
- [x] `docs/issues.md` - Bug and issue tracking
- [x] Update `docs/resources.md` - Link to new docs

**Goal:** Organized documentation for tracking development

**Files:** 4 updated/created

---

### Phase 2B: Web UI Foundation
**Status:** Complete ✓
**Completed:** 2026-02-13

- [x] Next.js 14 project setup - App Router + TypeScript
- [x] Shared database access - Point to same SQLite DB
- [x] Dashboard page - List eval sets with stats
- [x] Eval set detail page - View cases and run history
- [x] Run results page - Visualize scores and reasoning
- [x] Create set page - Form + validation
- [x] CaseList component - Display test cases
- [x] API routes - CRUD endpoints for sets and cases
- [x] Tailwind styling - Clean, minimal design
- [x] Score color coding - Red/yellow/green based on score

**Goal:** Browser-based interface for eval set management

**Files:** 15+ created (web/ directory)

**Note:** Case editing is view-only for now. Full CRUD will be added if needed.

---

### Phase 2C: AI Eval Set Generation
**Status:** Planned - Not started
**Estimated Start:** After Phase 2B complete

- [ ] `src/lib/generate.ts` - AI generation logic
- [ ] Metadata generation - Set name + description via Glean chat
- [ ] Test case generation - Grounded in company context
- [ ] Schema awareness - Fetch agent schema, generate appropriate cases
- [ ] Human review workflow - Preview before save
- [ ] CLI command: `seer generate` - Generate from terminal
- [ ] Web UI integration - "Generate with AI" button
- [ ] API endpoint: `/api/generate` - Web UI backend

**Goal:** Use Glean chat to generate eval sets automatically

**Blocker:** None - Can run parallel with 2B if needed

---

## 📋 Planned Features

### Phase 3: Multi-Judge Ensemble
**Priority:** High
**Estimated Effort:** 3-4 hours

**Rationale:** Increase evaluation reliability through consensus

- [ ] Ensemble configuration - Specify 2-3 judge models
- [ ] Parallel judge execution - Run judges concurrently
- [ ] Score aggregation - Mean/median across judges
- [ ] Agreement metrics - Standard deviation, Cohen's kappa
- [ ] Confidence intervals - 95% CI calculation
- [ ] Consensus detection - Flag low-agreement cases
- [ ] High-disagreement flagging - Alert when judges diverge
- [ ] Categorical majority voting - Mode for categorical scores
- [ ] CLI option: `--ensemble` - Enable multi-judge
- [ ] CLI option: `--require-consensus` - Enforce agreement threshold

**Dependencies:** Phase 2 complete

---

### Phase 4: Advanced Features
**Priority:** Medium
**Estimated Effort:** 6-8 hours

#### Custom Criteria Builder
- [ ] Web UI form - Define new criteria
- [ ] Rubric editor - Visual rubric creation
- [ ] Score type selection - Choose from 4 types
- [ ] Criteria library - Save/reuse custom criteria
- [ ] Validation - Ensure valid rubrics

#### Behavioral Validation
- [ ] Gaming detection - Identify agents optimizing for eval
- [ ] Response pattern analysis - Detect templated outputs
- [ ] Diversity metrics - Measure response variety

#### Export & Reporting
- [ ] Export to CSV - Tabular results export
- [ ] Export to JSON - Structured data export
- [ ] PDF reports - Formatted evaluation reports
- [ ] Comparison view - Side-by-side run comparison

#### Agent Improvement Suggestions
- [ ] Failure pattern analysis - Identify common issues
- [ ] Improvement recommendations - AI-generated suggestions
- [ ] Regression detection - Compare runs over time

**Dependencies:** Phases 2-3 complete

---

### Phase 5: Scale & Performance
**Priority:** Low
**Estimated Effort:** 4-6 hours

**Trigger:** When handling >100 eval sets or >50 cases per set

- [ ] PostgreSQL migration - Replace SQLite for scale
- [ ] Background job queue - Async evaluation execution
- [ ] Parallel case execution - Concurrent agent calls
- [ ] Result caching - Cache agent schema fetches
- [ ] Pagination - Web UI result pagination
- [ ] Streaming results - Real-time eval progress
- [ ] Database indexing - Optimize common queries

**Dependencies:** Proven need at scale

---

## 🎯 Feature Requests

### User-Requested Features
*Placeholder for future user requests*

---

### Research-Driven Enhancements

#### From Academic LLM-as-Judge Literature
- [ ] Position bias mitigation - Randomize response order
- [ ] Reference-free scoring - Evaluate without expected answers
- [ ] Pairwise comparison mode - A vs B instead of absolute scores
- [ ] Chain-of-thought reasoning - Require detailed judge explanations

**Source:** arXiv papers on LLM-as-judge bias

#### From Glean Internal Practices
- [ ] Multi-modal evaluation - Support image/file inputs
- [ ] Real user query integration - Import actual user queries
- [ ] A/B testing mode - Compare agent versions

**Source:** Glean AIOM best practices

#### From Anthropic Petri 2.0
- [ ] Normalized scoring - Calibrate across different judges
- [ ] Meta-evaluation - Evaluate the evaluators
- [ ] Prompt sensitivity analysis - Test rubric variations

**Source:** Anthropic evaluation methodology

---

## 🔬 Experimental Ideas

### Not Yet Validated
*Features that need research/prototyping before commitment*

- [ ] Auto-criteria selection - AI suggests relevant criteria per agent
- [ ] Continuous monitoring - Ongoing eval runs on production agents
- [ ] User feedback integration - Incorporate real user ratings
- [ ] Adversarial test generation - Generate edge cases automatically
- [ ] Cross-agent benchmarking - Compare agents on same eval set

---

## 📊 Feature Impact Matrix

| Feature | User Value | Technical Complexity | Priority |
|---------|-----------|---------------------|----------|
| Multi-judge ensemble | High | Medium | High |
| Web UI | High | Medium-High | High |
| AI generation | Medium-High | Medium | High |
| Custom criteria | Medium | Low-Medium | Medium |
| Export/reporting | Medium | Low | Medium |
| Behavioral validation | Medium-Low | High | Low |
| Scale optimization | Low (until needed) | High | Low |

---

## 🎓 Research Integration

### Papers Referenced
1. **LLM-as-Judge Best Practices** - RRD framework, bias mitigation
2. **Anthropic Eval Methods** - Petri 2.0 normalized scoring
3. **I/O Psychology** - Categorical reliability, behavioral validation

### Methodologies Applied
- **Continuous scoring:** Academic rubric design
- **Categorical scoring:** I/O psych tier definitions
- **Ensemble methods:** Statistical consensus research
- **Metric extraction:** Direct measurement best practices

---

## 🚀 Release History

### v0.1.0 (Phase 1) - 2026-02-12
**Initial MVP Release**

- Full CLI with 7 commands
- SQLite database with 6 tables
- 10 default criteria (all score types)
- Glean Agent API integration
- LLM-as-judge implementation
- Historical tracking

**Breaking Changes:** None (initial release)

---

### v0.2.0 (Phase 2) - 2026-02-13
**Documentation + Web UI + AI Generation**

- Comprehensive documentation suite (4 docs)
- Next.js web interface (15+ files)
- AI-powered eval set generation (CLI + Web)
- Improved user experience across all touchpoints

**New Features:**
- `docs/` - Architecture, features, issues, resources
- `web/` - Full Next.js app with dashboard, detail pages, results view
- `seer generate` - AI-powered test case generation
- Shared SQLite database between CLI and web

**Breaking Changes:** None (additive features)

---

## 📈 Metrics & Usage (Future)

*Placeholder for tracking:*
- Total eval sets created
- Total runs executed
- Most-used criteria
- Average cases per set
- Web vs CLI usage ratio

---

**Last Updated:** 2026-02-13
**Current Phase:** 2A (Documentation)
**Next Milestone:** Phase 2B (Web UI)
**Maintained By:** Kenneth Cassel / Axon
