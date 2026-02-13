# Seer Issues & Technical Debt

**Tracks known bugs, technical debt, performance issues, and resolutions**

---

## 🐛 Open Issues

### Critical (Blocks Core Functionality)

*None currently*

---

### High Priority (Impacts User Experience)

*None currently*

---

### Medium Priority (Should Fix Soon)

*None currently*

---

### Low Priority (Nice to Have)

#### Issue #1: No automated testing
**Severity:** Low
**Found:** 2026-02-12 (Phase 1)
**Description:**
- No unit tests, integration tests, or E2E tests
- Relying entirely on manual testing via CLI
- Makes refactoring risky

**Impact:**
- Harder to catch regressions
- Slower development velocity
- Lower confidence in changes

**Proposed Fix:**
- Add Vitest for unit tests
- Test judge prompt generation logic
- Test metric extraction functions
- Mock Glean API for integration tests

**Effort:** Medium (2-3 hours initial setup)
**Priority:** Low (working system, but future risk)

---

#### Issue #2: CLI error messages could be more helpful
**Severity:** Low
**Found:** 2026-02-12
**Description:**
- Some errors just show stack traces
- Could add user-friendly error messages
- Should validate inputs earlier

**Examples:**
- Invalid eval set ID → Generic "not found" error
- Missing API keys → Raw fetch error
- Invalid criterion name → Silent failure

**Proposed Fix:**
- Add input validation with clear error messages
- Catch API errors and provide troubleshooting hints
- Validate .env on startup

**Effort:** Low (1 hour)
**Priority:** Low (users can debug, but UX improvement)

---

#### Issue #3: No progress indicators for long-running evaluations
**Severity:** Low
**Found:** 2026-02-12
**Description:**
- Running eval set with 20 cases shows no progress
- User doesn't know if it's frozen or working
- Could add progress bar or case-by-case updates

**Proposed Fix:**
- Add progress bar using `cli-progress` or similar
- Show "Running case 5/20..." updates
- Estimate time remaining based on avg latency

**Effort:** Low (1 hour)
**Priority:** Low (evals complete, just UX)

---

## ⚠️ Technical Debt

### Architecture Debt

#### TD #1: Hard-coded default criteria
**Added:** 2026-02-12 (Phase 1)
**Location:** `src/criteria/defaults.ts`

**Description:**
- 10 default criteria hard-coded in TypeScript
- Seeded into database on initialization
- No UI or CLI to modify or add custom criteria

**Why it exists:**
- Faster to ship MVP with sensible defaults
- Custom criteria builder is Phase 4

**Cleanup Plan:**
- Phase 4: Add custom criteria UI
- Allow users to define new criteria
- Keep defaults as starting point

**Effort to fix:** Medium (3-4 hours for custom criteria builder)

---

#### TD #2: No ensemble judge implementation yet
**Added:** 2026-02-12
**Location:** `src/lib/judge.ts`

**Description:**
- Single judge per evaluation
- Multi-judge ensemble planned for Phase 3
- Current code doesn't account for parallel judges

**Why it exists:**
- Progressive enhancement approach
- Single judge sufficient for MVP

**Cleanup Plan:**
- Phase 3: Implement `src/lib/ensemble.ts`
- Parallel execution of multiple judges
- Score aggregation and agreement metrics

**Effort to fix:** Medium-High (3-4 hours)

---

#### TD #3: Web UI shares SQLite database without locking considerations
**Added:** 2026-02-13 (Phase 2 planning)
**Location:** `web/lib/db.ts` (planned)

**Description:**
- CLI and Web UI both access same SQLite file
- SQLite has file-level locking
- Concurrent writes from CLI + Web could cause issues

**Why it exists:**
- SQLite is simplest shared DB option
- Single-user tool (low concurrency risk)

**Mitigation:**
- SQLite handles concurrent reads fine
- Concurrent writes will retry automatically
- For high concurrency, migrate to PostgreSQL (Phase 5)

**Cleanup Plan:**
- Monitor for locking issues in practice
- If problematic, add write queue or migrate to PostgreSQL

**Effort to fix:** High (4-6 hours for PostgreSQL migration)

---

### Code Quality Debt

#### TD #4: Judge response parsing uses regex
**Added:** 2026-02-12
**Location:** `src/lib/judge.ts`

**Description:**
- Parsing judge responses with regex: `/SCORE:\s*(\d+)/`
- Fragile if LLM doesn't follow exact format
- Has fallback to re-prompt, but adds latency

**Why it exists:**
- Simplest parsing method for structured output
- Works reliably with good prompting

**Cleanup Plan:**
- Consider Anthropic/OpenAI structured output APIs
- Or use JSON mode with typed schema
- Keep regex as fallback

**Effort to fix:** Low-Medium (2 hours)

---

#### TD #5: No retry logic for API calls
**Added:** 2026-02-12
**Location:** `src/data/glean.ts`, `src/lib/judge.ts`

**Description:**
- API calls fail immediately on network error
- No exponential backoff or retry
- Transient failures cause eval to abort

**Why it exists:**
- Simpler code for MVP
- Most failures are auth/config issues (not transient)

**Cleanup Plan:**
- Add retry with exponential backoff
- Use `p-retry` or similar library
- Distinguish retryable vs non-retryable errors

**Effort to fix:** Low (1-2 hours)

---

### Performance Debt

#### TD #6: Sequential case execution
**Added:** 2026-02-12
**Location:** `src/cli.ts` (run command)

**Description:**
- Eval cases run sequentially (one after another)
- Each case waits for previous to complete
- 20 cases × 5s each = 100s total

**Why it exists:**
- Simpler implementation
- Easier to debug
- Avoids rate limiting issues

**Cleanup Plan:**
- Add parallel execution option: `--parallel <N>`
- Use `Promise.all()` or `p-limit` for concurrency control
- Balance speed vs rate limits

**Effort to fix:** Low-Medium (2 hours)

---

## ✅ Resolved Issues

### Issue: Trace API Access for Token Counts — Partially Resolved
**Severity:** High → Accepted Limitation
**Found:** 2026-02-13
**Resolved:** 2026-02-13 (public API fixed; trace metadata remains unavailable)

**Description:**
- Could not access token usage or tool call metadata from agent executions
- Internal API (`/api/v1/getworkflowtrace`) returned 401 Unauthorized
- Public API (`/rest/api/v1/agents/runs/wait`) was using wrong endpoint format

**Root Causes Found (2):**

1. **Internal API uses Cloudflare-bound session cookies:**
   - Internal APIs (`/api/v1/*`) require browser session cookies
   - Cloudflare's `cf_clearance` cookie is tied to browser TLS fingerprint
   - Cookie replay from CLI/Bun fails because TLS handshake doesn't match
   - Tested 4 auth strategies — all returned 401 "Not allowed"

2. **Public API endpoint was wrong:**
   - Was using: `/rest/api/v1/agents/{id}/runs/wait` (404)
   - Correct: `/rest/api/v1/agents/runs/wait` with `agent_id` in body (200)
   - Also: form-based agents need `input` object, not `messages` array

**Solution:**
- Fixed public API to use correct endpoint and request format
- Agent schema detection: form-based vs. chat-style input handling
- Added schema caching to avoid redundant API calls within a run
- Internal API code preserved as fallback (ready for future auth solutions)
- Graceful degradation: try internal → fall back to public

**What Works Now:**
- ✅ Agent execution via public REST API
- ✅ Response quality scoring (LLM-as-judge)
- ✅ Client-measured latency
- ✅ Correct input format detection (form vs. chat)

**What Remains Unavailable:**
- ❌ Token usage counts (not in public API response)
- ❌ Tool call details (not in public API response)
- ❌ Execution trace spans

**Future Options:**
1. Playwright browser automation (TLS fingerprint match)
2. Request internal API service account from eng
3. Request trace data in public API (feature request)

**Files Changed:**
- `src/data/glean.ts` - Fixed endpoint, request format, added schema caching
- `src/lib/internal-agent.ts` (new) - Internal API client (future use)
- `src/lib/config.ts` - Added optional `gleanSessionCookie`
- `src/cli.ts` - Session expiration error handling
- `docs/TRACE_API_LIMITATIONS.md` - Full investigation results

**Reference:** See `docs/TRACE_API_LIMITATIONS.md` for detailed investigation

---

### Issue: Web UI runtime error - Cannot read properties of undefined (reading 'toFixed')
**Severity:** High
**Found:** 2026-02-13
**Resolved:** 2026-02-13

**Description:**
- Dashboard and eval set detail pages crashed when displaying scores
- `run.overallScore` could be null/undefined from database
- Calling `.toFixed()` on null/undefined threw runtime error

**Root Cause:**
- Database returns `null` for uncompleted runs
- JavaScript doesn't auto-handle null before calling methods
- Missing null checks in TypeScript (type safety not enforced at runtime)

**Fix:**
- Added explicit null/undefined checks: `run.overallScore !== null && run.overallScore !== undefined`
- Applied to all score display locations (Dashboard, Set Detail, Results)
- Prevents crash by only rendering score div when value exists

**Files Changed:**
- `web/app/page.tsx`
- `web/app/sets/[id]/page.tsx`

**Resolution Time:** 10 minutes

---

### Issue: Web UI fails to start - "Unhandled scheme error: bun:sqlite"
**Severity:** Critical
**Found:** 2026-02-13
**Resolved:** 2026-02-13

**Description:**
- Next.js dev server failed to start with module build error
- Webpack couldn't handle `bun:sqlite` imports
- Error: "Reading from 'bun:sqlite' is not handled by plugins"

**Root Cause:**
- CLI runs in Bun → can use `bun:sqlite` (native Bun API)
- Web UI runs in Next.js/Node.js → Webpack doesn't understand Bun-specific imports
- Tried to use same database driver for both environments

**Fix:**
- Installed `better-sqlite3` (Node.js-compatible SQLite driver)
- Updated `web/lib/db.ts`:
  - Changed from `drizzle-orm/bun-sqlite` to `drizzle-orm/better-sqlite3`
  - Changed from `import { Database } from 'bun:sqlite'` to `import Database from 'better-sqlite3'`
- Both drivers connect to same `data/seer.db` file
- Drizzle ORM abstracts the difference

**Files Changed:**
- `web/lib/db.ts`
- `web/package.json` (added better-sqlite3 dependency)

**Resolution Time:** 15 minutes

---

### Issue: Invalid next.config.js option
**Severity:** Medium
**Found:** 2026-02-13
**Resolved:** 2026-02-13

**Description:**
- Next.js warned about unrecognized config key
- `serverComponentsExternalPackages` not valid in Next.js 14

**Fix:**
- Removed invalid option from `next.config.js`
- Simplified webpack config

**Resolution Time:** 5 minutes

---

### Issue: Database migration fails on fresh install
**Severity:** High
**Found:** 2026-02-12
**Resolved:** 2026-02-12

**Description:**
- Running `bun run db:push` failed on fresh clone
- Missing `data/` directory

**Root Cause:**
- Directory not created automatically
- SQLite needs parent directory to exist

**Fix:**
- Added `mkdir -p data` to migration script
- Updated installation docs

**Resolution Time:** 15 minutes

---

### Issue: Agent schema fetch returns 404
**Severity:** High
**Found:** 2026-02-12
**Resolved:** 2026-02-12

**Description:**
- Fetching agent schema failed with 404 Not Found
- Prevented all agent runs

**Root Cause:**
- Wrong endpoint path: `/api/v1/agents/{id}/schemas`
- Correct path: `/rest/api/v1/agents/{id}/schemas`

**Fix:**
- Updated endpoint in `src/data/glean.ts`
- Added to `docs/resources.md` as common issue

**Resolution Time:** 30 minutes

---

### Issue: CLI generates IDs starting with dash
**Severity:** Medium
**Found:** 2026-02-12
**Resolved:** 2026-02-12

**Description:**
- Some generated IDs started with `-` (e.g., `-abc123`)
- Broke CLI parsing: `seer run -abc123` treated as flag
- Users had to escape: `seer run -- -abc123`

**Root Cause:**
- Random ID generator could produce leading dash
- No validation on generated IDs

**Fix:**
- Added CLI-safe ID generation in `src/lib/id.ts`
- Ensures IDs start with alphanumeric character
- Prepends `e_` prefix if needed

**Resolution Time:** 20 minutes

---

## 🔍 Known Limitations

### By Design (Not Bugs)

#### Limitation #1: SQLite single-writer limitation
**Impact:** Medium (for concurrent use)

**Description:**
- SQLite allows only one writer at a time
- CLI and Web UI can conflict on writes

**Mitigation:**
- Low concurrency in practice (single user)
- SQLite retries automatically
- Phase 5: Migrate to PostgreSQL if needed

**Not a bug because:** SQLite trade-off for simplicity

---

#### Limitation #2: Glean chat judge only
**Impact:** Low

**Description:**
- Currently only uses Glean chat for judging
- No direct Anthropic/OpenAI integration yet

**Mitigation:**
- Glean chat is grounded in company context (benefit)
- Can add direct LLM APIs in Phase 3 if needed

**Not a bug because:** Intentional design choice for grounding

---

#### Limitation #3: No multi-user support
**Impact:** Low

**Description:**
- Single SQLite database shared locally
- No user authentication or multi-tenancy

**Mitigation:**
- Tool designed for individual AIOMs
- Each user runs their own instance
- Future: Could add user tables if needed

**Not a bug because:** Single-user tool by design

---

## 📋 Issue Triage Process

### How to Add New Issues

1. **Identify the issue** - Bug, tech debt, or performance problem
2. **Assess severity:**
   - **Critical:** Blocks core functionality, immediate fix needed
   - **High:** Major UX impact, fix within 1 week
   - **Medium:** Noticeable issue, fix within 1 month
   - **Low:** Minor annoyance, fix when convenient
3. **Document:**
   - Clear description
   - Steps to reproduce (if bug)
   - Date found
   - Impact on users
4. **Add to appropriate section** in this file
5. **Link to related code** - File location, line numbers

### When to Fix Issues

- **Critical:** Immediately (drop everything)
- **High:** Before next feature work
- **Medium:** During dedicated bug fix sessions
- **Low:** When refactoring nearby code

---

## 🛠️ Debugging Resources

### Common Problems & Solutions

#### Problem: API calls return 401 Unauthorized
**Solution:**
1. Check `.env` file has correct API keys
2. Verify key scopes in Glean admin
3. Test key with `curl` manually

#### Problem: Database not found
**Solution:**
1. Run `bun run db:push` to create database
2. Check `data/seer.db` exists
3. Verify `drizzle.config.ts` points to correct path

#### Problem: Judge returns unparseable response
**Solution:**
1. Check `eval_scores` table for stored reasoning
2. Add more examples to judge prompt
3. Consider switching to structured output API

#### Problem: Agent execution timeout
**Solution:**
1. Increase timeout in fetch call
2. Check agent complexity (may be slow)
3. Verify network connection to Glean

---

## 📊 Issue Statistics

### Current State (as of 2026-02-13)
- **Open Issues:** 3 (all low priority)
- **Technical Debt Items:** 6
- **Resolved Issues:** 7
- **Known Limitations:** 3

### Issue Resolution Time
- **Average time to fix:** ~35 minutes
- **Fastest fix:** 5 minutes (next.config.js)
- **Slowest fix:** 2 hours (trace API integration)

---

## 🎯 Next Steps

### Immediate Priorities
1. Complete Phase 2A (documentation) ← Current
2. Start Phase 2B (Web UI)
3. Defer issue fixes until after Phase 2 complete

### Future Bug Bash Sessions
- After Phase 2 complete: Fix low-priority issues
- After Phase 3 complete: Address technical debt
- After Phase 4 complete: Performance optimization

---

**Last Updated:** 2026-02-13
**Open Critical Issues:** 0
**Open High-Priority Issues:** 0
**Maintained By:** Kenneth Cassel / Axon
