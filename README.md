# n8n-nodes-emailsherlock

n8n community node for the [EmailSherlock](https://emailsherlock.com/api) email verification API. It checks whether an address can receive mail (syntax, MX, SMTP probe) and returns reputation data about the domain behind it.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation tool.

## Installation

In n8n, open **Settings > Community Nodes > Install** and enter:

```
n8n-nodes-emailsherlock
```

See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) if the menu is not visible on your instance.

## Credentials

Create an API key at [emailsherlock.com/api](https://emailsherlock.com/api), then add an **EmailSherlock API** credential in n8n and paste the key.

Two key types exist:

- `es_live_` keys verify real addresses and spend credits.
- `es_test_` sandbox keys return deterministic fixtures, spend nothing, and are made for building your workflow before you go live. See [Sandbox testing](#sandbox-testing).

The credential test calls the account-status endpoint (`GET /v1/credits`) to validate the key. It spends no credits, live or sandbox.

## Operations

### Verify Email

Verifies one address per input item, synchronously. The output item is the full API response for that address.

### Verify Batch

Verifies a list of addresses in one synchronous request. The **Emails** field accepts addresses separated by commas or newlines, or an expression that resolves to an array, for example `{{ $json.recipients }}`. The node outputs one item per address, in the order you sent them. Addresses the API could not process come back as `{ "email": "...", "error": "invalid_email" }` items.

Batch requests skip the live SMTP probe: addresses that need it answer `result=unknown` with `reason=verification_pending`, and the probe runs in the background. Verify the same address again after a short wait to get the final verdict from cache, or use a verification job. See [Retrying transient results](#retrying-transient-results).

### Submit Verification Job

For larger lists that need definitive inbox verdicts. Unlike Verify Batch, a job runs every address through the full pipeline including the SMTP probe, so the results carry real `valid`/`invalid` verdicts instead of `verification_pending`. Accepts up to 10000 addresses, charged per address at submit. Addresses that cannot be processed are refunded automatically.

- **Wait for Completion** (default on): the node polls the job until it finishes and returns the results directly. **Max Wait** caps the polling; a job larger than the budget returns still processing, and you poll **Get Verification Job** yourself afterwards.
- Turn **Wait for Completion** off to return the job id immediately. Drive the polling yourself, for example with a **Wait** node followed by **Get Verification Job** (the n8n-idiomatic pattern for long jobs).
- **Split Results Into Items** (default on): one output item per address, in submit order. Off returns the whole job object (`id`, `status`, `progress`, `results`).

### Get Verification Job

Reads a job by its **Job ID**. Returns the status and, once the job completed, the per-address results. An unknown or expired id (jobs are kept 7 days) answers `404 No such job`.

### Get Account Status

Reads the credit balance, the key's rate-limit window and the plan. Spends no credits, so it is also the cheapest way to check that a key works (this is what the credential test uses).

## Output fields

| Field | Type | Meaning |
|---|---|---|
| `email` | string | The address you sent |
| `result` | string | `valid`, `invalid`, `catch_all`, `disposable`, `role` or `unknown` |
| `deliverable` | boolean or null | `true` only after the mailbox accepted the probe, `false` only on a proven failure, `null` means unproven |
| `reason` | string or null | Why the pipeline decided, for example `mailbox_accepts` or `greylisted`. Transient reasons signal a retry |
| `mx` | boolean | The domain has reachable MX records |
| `mx_record` | string or null | The primary MX host, when one was resolved |
| `disposable` | boolean | Throwaway or temporary-mail provider |
| `role` | boolean | Role address such as `info@` or `sales@` |
| `catch_all` | boolean | The host accepts mail for any local part. Always-accept hosts (mail.ru and similar) answer `result=catch_all` with `deliverable=null` rather than a misleading `valid` |
| `free_email` | boolean or null | The domain is a freemail provider |
| `score` | number or null | 0 to 1 confidence, higher is safer to send to |
| `freshness` | string | `fresh`, `cached_recent` or `cached_stale_refreshed` |
| `checked_at` | string or null | When the underlying verification ran (ISO 8601) |
| `domain` | object or null | Domain intelligence, `null` when the domain has not been crawled yet |

The `domain` object:

| Field | Type | Meaning |
|---|---|---|
| `domain.name` | string | The domain behind the address |
| `domain.types` | array or null | Host classification: `freemail`, `disposable`, `custom`, `company`, `government`, `education`, `public`, `isp` |
| `domain.score` | number or null | 0 to 100 domain reputation score, higher is better |
| `domain.spf` | boolean or null | An SPF record exists |
| `domain.dkim` | boolean or null | A DKIM record was found |
| `domain.dmarc` | boolean or null | A DMARC record exists |
| `domain.dmarc_policy` | string or null | `none`, `quarantine` or `reject` |
| `domain.mta_sts` | boolean or null | An MTA-STS policy is published |
| `domain.tls_rpt` | boolean or null | A TLS-RPT record exists |
| `domain.bimi` | boolean or null | A BIMI record exists |
| `domain.dane` | boolean or null | DANE/TLSA records exist for the MX hosts |
| `domain.blacklists` | integer or null | Number of public DNS blacklists currently listing the domain's mail infrastructure |
| `domain.dnssec` | string or null | `secure`, `insecure` or `bogus` |
| `domain.caa` | boolean or null | A CAA record restricts certificate issuance |

Full reference: [emailsherlock.com/api/docs](https://emailsherlock.com/api/docs) and the machine-readable [OpenAPI spec](https://api.emailsherlock.com/v1/openapi.json).

## Retrying transient results

Four `reason` values are transient: `greylisted`, `smtp_timeout`, `smtp_unreachable` and `verification_pending`. The mailbox could not be probed to a final verdict yet, so a retry after a short wait usually resolves them.

For lists, a verification job is usually the better fit: it runs the SMTP probe for every address up front, so the results are final and you avoid the retry loop entirely. The retry pattern below is for the synchronous single/batch path.

A simple retry loop in n8n:

1. **EmailSherlock** node verifies the address.
2. An **If** node checks `{{ ["greylisted", "smtp_timeout", "smtp_unreachable", "verification_pending"].includes($json.reason) }}`.
3. On the true branch, a **Wait** node pauses for 10 to 15 minutes, then connects back to the EmailSherlock node.
4. On the false branch, the verdict is final and the workflow continues.

The retried call is answered from cache once the background probe finished, so it costs no extra waiting time on the API side.

## Error handling

| HTTP status | API code | What the node does |
|---|---|---|
| 401 / 403 | `unauthorized` | Fails with a hint to check the credential |
| 402 | `insufficient_credits` | Fails with a hint to top up at [emailsherlock.com/api](https://emailsherlock.com/api) |
| 429 | `rate_limit_exceeded` | Fails and reports the `Retry-After` wait time in seconds |
| 503 | `verify_unavailable` | Fails; the API refunded the credits for the call, retry later |

Enable **Continue On Fail** on the node to route errors into the output stream instead of stopping the workflow.

## Sandbox testing

With an `es_test_` key the local part of the address controls the result, so you can test every branch of your workflow deterministically:

| Address | Result |
|---|---|
| `valid@example.com` | `result=valid` |
| `invalid@example.com` | `result=invalid` |
| `catch-all@example.com` | `catch_all=true` |
| `disposable@example.com` | `disposable=true` |
| `role@example.com` | `role=true` |
| `unknown@example.com` | `result=unknown` |
| `pending@example.com` | `result=unknown`, `reason=verification_pending` (the batch retry case) |
| `ratelimit@example.com` | HTTP 429 |
| `servererror@example.com` | HTTP 503 |

Sandbox responses carry the `X-Sandbox: true` header and never spend credits.

## Why verify before sending

Bounced mail damages your sender reputation. Verifying a list before a campaign keeps hard bounces out and flags risky categories (disposable, role, catch-all) so you can decide what to do with them. You can [verify an email address](https://emailsherlock.com/verify) manually on the EmailSherlock site to see the same checks this node runs.

## License

[MIT](LICENSE)
