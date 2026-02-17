# Seer Resources

## Project Documentation

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System architecture, data flow, component design |
| [features.md](./features.md) | Feature tracking and roadmap |
| [issues.md](./issues.md) | Bug tracking and known limitations |
| [evaluation-framework.md](./evaluation-framework.md) | Evaluation philosophy and dimension design |
| [TRACE_API_LIMITATIONS.md](./TRACE_API_LIMITATIONS.md) | Token count access investigation |

## Research Guides

| Document | Purpose |
|----------|---------|
| [guide-petri-judge-patterns.md](./guide-petri-judge-patterns.md) | Anthropic's judge prompting patterns (XML, CoT, calibration) |
| [guide-judge-best-practices.md](./guide-judge-best-practices.md) | G-Eval, RAGAS, MT-Bench — general eval best practices |
| [guide-qa-judge-prompts.md](./guide-qa-judge-prompts.md) | QA pair grading templates, theme decomposition, anti-patterns |
| [research-dynamic-eval.md](./research-dynamic-eval.md) | Stale QA problem: FreshQA, validity windows, reference-free eval |

## Key External References

### Evaluation Methodology

| Source | Key Takeaway for Seer |
|--------|----------------------|
| [Raschka — LLM Evaluation: 4 Approaches](https://magazine.sebastianraschka.com/p/llm-evaluation-4-approaches) | Combine methods — no single approach is sufficient. LLM-as-judge is "rubric-sensitive": scoring quality is bounded by rubric quality, not model quality. |
| [Cavanagh — LLM-as-Judge](https://kenneth.computer/research/notes/llm-as-judge) | **Categorical classification outperforms continuous scales** (15% reliability gain, 37% validity gain via SJT framework). Multi-judge cross-family panels show complementary error profiles. Narrative-score decoupling is a real failure mode: judge reasoning can contradict its own score. Single-judge pipelines are unreliable. |
| [Siro et al. — Learning to Judge (GER-Eval)](https://arxiv.org/html/2602.08672v1) | LLM judges are **unreliable for factual/knowledge-intensive domains** (ICC below 0.3 for domain-specific tasks like SumPubMed). Conversational evaluation is reliable; factual assessment requires human or tool-grounded verification. Advocates hybrid human-LLM frameworks. |
| [Wolfe — Rubric RL](https://cameronrwolfe.substack.com/p/rubric-rl) | Instance-specific rubrics (per-query) outperform generic rubrics. Implicit aggregation (holistic score) outperforms explicit weighted sums. Purely synthetic rubrics without reference answers degrade performance. Dynamic rubric management: create negative rubrics, maintain active sets by discriminative power. |

### Academic Papers

| Paper | Relevance |
|-------|-----------|
| Gu et al. (2024) — "Survey on LLM-as-a-Judge" | Three paradigms: pointwise, pairwise, binary. Comprehensive bias taxonomy. |
| Verga et al. (2024) — "Replacing Judges with Juries" | Ensemble reliability > single judge. Cross-model panels reduce family-specific bias. |
| Liu et al. (2023) — "G-Eval" | CoT-then-score improves human correlation 10-20%. Form-filling evaluation pattern. |
| Shahul et al. (2023) — "RAGAS" | Faithfulness via claim decomposition. Reference-free RAG evaluation. |
| Vu et al. (2023) — "FreshQA" | Temporal volatility taxonomy: fast-changing vs slow-changing answers. |
| Zheng et al. (2023) — "MT-Bench" | Pointwise scoring with anchored rubrics. Chatbot Arena Elo methodology. |

### Internal Glean References

| Source | Relevance |
|--------|-----------|
| Lauren Zhu — "Agent Eval" | Internal eval sets mined from historical executions. AGENTS_UNIFORM eval set. |
| Lauren Zhu — "Agents Quality and Eval Requirements" | Step-level instruction following judges. Pairwise comparison with ordered logit models. |
| Zane Homsi — "Autonomous Agent Evals PRD" | Customer-facing eval tool design. Golden set workflow. |
| Thai Tran / Megha — "Agent Evaluation and Observability PRD" | Eval set upload + annotation. Accuracy, task completion rate, CSAT, latency. |
| #aiom-team Slack (Jan 28, 2026) | Team discussion on LLM-as-judge biases, rubric-forced scoring, self-learning eval loops. |
| FR-2147 | Feature request: BigQuery token usage logs (DBS, eBay, Indeed, LinkedIn, Wayfair, Zillow). |

## Glean API Integration

**Single API key** (`GLEAN_API_KEY`) with chat + search + agents scopes.

| Endpoint | Purpose |
|----------|---------|
| `POST /rest/api/v1/runworkflow` | Agent execution with trace metadata |
| `POST /rest/api/v1/chat` | Judge calls (Opus 4.6) + smart generation (ADVANCED agent) |
| `GET /rest/api/v1/agents/{id}/schemas` | Agent schema (form fields vs chat-style) |
| `GET /rest/api/v1/agents/{id}` | Agent name + description |

### Payload Notes

`runworkflow` uses internal API format:
- `workflowId` (not `agent_id`)
- `fields` (not `input`) for form-based agents
- `author`/`fragments` (not `role`/`content`) for messages
- `enableTrace: true` for trace metadata
- `stream: false` for blocking response

Judge calls use:
- `agentConfig.modelSetId: "OPUS_4_6_VERTEX"` for Opus 4.6
- `agentConfig.agent: "DEFAULT"` for coverage/faithfulness (no company tools)
- `agentConfig.agent: "ADVANCED"` + `toolSets.enableCompanyTools: true` for factuality verification
