---
name: serverless-bridge-builder
description: >-
  Build, audit, and harden zero-worker, serverless integration bridges between SaaS platforms,
  databases, and chat channels. Implements Next.js 15+ after() async execution, inbound signature
  verification, compound idempotency (entity_id, modified_time, direction), and bidirectional loop prevention.
---

# Serverless Bridge Builder

Build zero-worker, serverless integration bridges between platforms (e.g. Google Drive, Slack, Discord, Notion, Supabase) running entirely on free serverless tiers (Next.js App Router on Vercel Hobby) with zero always-on background workers.

## Overview
This skill guides the construction and audit of serverless integration pipelines using the 7-phase methodology (P0–P6):
1. **Scaffold & Env**: Type-strict Next.js 15+ with Zod env parsing and static public placeholders.
2. **Database Layer**: Supabase with RLS enabled on all tables and compound unique idempotency.
3. **Primary Service**: Refresh-token auth, streaming without memory buffering, and loop-breaker tags.
4. **Interaction Routing**: Ed25519 / HMAC signature checks, <3s SLA defer ACK, async execution in `after()`.
5. **Bidirectional Sync**: Filter to mapped containers, "Added" vs "Updated" heuristics, rollback on post failure.
6. **Watch Lifecycle**: Webhook renewal crons, token expiration tracking, protected manual poll routes.
7. **Hardening**: Route gating test suites, zero warnings on build, and operational runbooks.

## Quick Start: Auditing a Bridge
Run the built-in CLI verification tool to audit an existing or in-progress bridge:

```bash
uv run python3 .agents/skills/serverless-bridge-builder/scripts/bridge_verify.py audit --dir .
```

To export the audit results to a JSON file:
```bash
uv run python3 .agents/skills/serverless-bridge-builder/scripts/bridge_verify.py audit --dir . --output bridge-audit.json
```

## Core Architectural Rules

1. **Zero Worker Processes**: Never use persistent daemon workers, polling loops, or libraries that require persistent WebSocket connections (e.g., `discord.js`). All external APIs must be accessed via plain `fetch` (REST).
2. **Inbound Verification First**: Every endpoint MUST verify cryptographic signatures (`X-Signature-Ed25519`, HMAC, or Bearer tokens) on the raw request body before parsing JSON or running application logic.
3. **Fast ACK with `after()`**: Webhooks and interactions with latency SLAs (like Discord's 3-second deadline) must return an immediate response, delegating streaming and third-party API mutations to Next.js `after()`.
4. **Compound Idempotency Key**: Use `(entity_id, modified_time, direction)` in an event log table. Do NOT use MD5 hashes or change event IDs.
5. **Rollback on Downstream Failure**: If posting to the destination platform fails, the idempotency row must be deleted and the sync page token must NOT be advanced, allowing automatic retry on the next event.
6. **Loop Prevention**: Writes originating from the bridge must stamp metadata (e.g. `appProperties.source = "bridge"`) to prevent infinite ping-pong loops.

## Common Mistakes

- **Reading JSON before verifying signature**: Attempting `req.json()` before checking the signature consumes the request body and fails cryptographic checks. Always verify on `req.text()`.
- **Buffering entire files in memory**: Using `res.arrayBuffer()` for file transfers hits serverless function memory limits. Always pipe web streams directly to the destination upload API.
- **Advancing tokens on failed deliveries**: Advancing the change token even when downstream webhooks fail drops notifications permanently.
