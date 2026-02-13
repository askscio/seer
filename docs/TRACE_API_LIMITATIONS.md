# Trace API Limitations & Investigation Results

## Summary

Trace metadata (token counts, tool calls, execution details) is **not accessible from CLI/scripts**. The internal Glean API that provides traces uses session cookies tied to browser TLS fingerprints, which can't be replayed from non-browser clients.

## What Works

### Public REST API (`/rest/api/v1/*`)
- **Auth:** Bearer token (API key)
- **Endpoint:** `POST /rest/api/v1/agents/runs/wait`
- **Request:** `{ agent_id, input: {...} }` or `{ agent_id, messages: [...] }`
- **Response:** `{ messages: [{ role, content }] }` — text only, no trace data
- **Available:** Agent response text, client-measured latency

### What's Missing from Public API
- Token usage (input/output per LLM call)
- Tool call details (which tools, inputs/outputs)
- Execution trace spans
- System prompts used
- Per-step timing

## What Doesn't Work (and Why)

### Internal API (`/api/v1/*`)
- **Auth:** Session cookie from browser SSO login
- **Endpoint:** `POST /api/v1/runworkflow` → returns `workflowTraceId`
- **Trace Endpoint:** `POST /api/v1/getworkflowtrace` → returns full trace spans
- **Problem:** Cloudflare's `cf_clearance` cookie is **tied to the browser's TLS fingerprint**

### Why Cookie Replay Fails

Tested 4 authentication strategies — all returned 401:

| Strategy | Result |
|----------|--------|
| Session cookie only | 401 "Not allowed" |
| Session cookie + browser headers (User-Agent, Origin, Referer) | 401 "Not allowed" |
| Bearer token + session cookie | 401 "Not allowed" |
| Bearer token + X-Scio-ActAs header | 401 "Not allowed" |

**Root cause:** Cloudflare's bot protection validates the TLS fingerprint of the client against the `cf_clearance` cookie. When Bun/Node.js makes the request, the TLS handshake is different from the browser that originally received the cookie, so Cloudflare rejects it before the request even reaches Glean's backend.

### Key Evidence
- All internal API calls return `401 "Not allowed"` (plain text, not JSON)
- Public API works fine with same Bearer token
- This is a Cloudflare-level block, not a Glean auth issue

## Current Architecture

```
CLI (Bun)
    │
    ├── Public API (/rest/api/v1/agents/runs/wait)
    │   ├── Bearer token auth ✅
    │   ├── Agent response text ✅
    │   ├── Client-measured latency ✅
    │   └── Trace metadata ❌
    │
    └── Internal API (/api/v1/runworkflow)
        ├── Session cookie auth ❌ (TLS fingerprint mismatch)
        └── Full trace metadata (would include tokens, tool calls)
```

## Impact on Seer

### Available Metrics
- ✅ Response quality (LLM-as-judge scoring)
- ✅ Client-measured latency
- ✅ Judge reasoning and confidence
- ✅ Historical tracking across runs

### Unavailable Metrics
- ❌ Token usage per eval run
- ❌ Tool call details and counts
- ❌ LLM call breakdowns
- ❌ Execution trace analysis

## Future Options

### Option 1: Playwright Browser Automation
- Use Playwright to launch a real browser, complete SSO, and make API calls
- The browser context has the correct TLS fingerprint
- **Pro:** Would give full trace access programmatically
- **Con:** Heavy dependency, slow startup, fragile (SSO flow changes)
- **Effort:** Medium (4-6 hours)

### Option 2: Request Internal API Service Account
- Ask Glean eng team for a service account with internal API access
- Would bypass Cloudflare's browser fingerprint requirement
- **Pro:** Clean solution, no browser needed
- **Con:** Requires eng team approval, may not be available
- **Effort:** Unknown (depends on internal process)

### Option 3: Request Trace Data in Public API
- File feature request to include trace metadata in `/rest/api/v1/agents/runs/wait` response
- **Pro:** Clean solution that works for all users
- **Con:** Product decision, unknown timeline
- **Effort:** Low (file request), unknown delivery

### Option 4: Accept Limitation
- Focus on response quality scoring (which is the core value)
- Use CMD+E debug mode in Glean web UI for manual trace inspection
- **Pro:** No additional engineering, ship now
- **Con:** No programmatic token/cost tracking

**Current choice:** Option 4 (accept limitation) with code infrastructure ready for Options 1-3.

## Files

- `src/data/glean.ts` — Agent runner (public API, with internal API fallback)
- `src/lib/internal-agent.ts` — Internal API client (ready for when auth works)
- `src/lib/config.ts` — Config with optional `gleanSessionCookie` field

---

**Date:** 2026-02-13
**Author:** Kenneth + Axon
**Status:** Limitation confirmed. Public API fixed and working. Internal API code preserved for future use.
