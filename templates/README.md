# n8n workflow templates

Reference workflow templates for the EmailSherlock node, kept here for
provenance (n8n's verified-node review wants template changes visible on
GitHub). The templates themselves are submitted to the n8n template gallery
through the [Creator Portal](https://n8n.io/creators/), not shipped in the npm
package.

## list-cleaning-verify-batch.json

A list-cleaning starter: verify a batch of addresses in one synchronous call,
then split them into safe-to-send and review-first.

**Flow:** Manual Trigger to Verify Batch to an IF on `result == valid`, with one
output for valid addresses and one for everything else.

It uses the `es_test_` sandbox addresses (`valid@`, `invalid@`, `disposable@`,
`role@`, `catch-all@`, `unknown@` at `example.com`), so it runs the same way for
anyone who imports it, with no credits spent.

### Gallery copy (submit via the Creator Portal)

**Title:** Clean an email list before you send (EmailSherlock)

**Description:**

> Verify a list of email addresses in one batch and split it into safe-to-send
> and review-first before a campaign goes out. The EmailSherlock node checks each
> address (syntax, MX, disposable, role, catch-all, deliverability) and returns
> one item per address. An IF node routes valid addresses one way and everything
> else (invalid, disposable, role, catch-all, unknown) the other, so you keep hard
> bounces out of your send and decide what to do with the risky ones.
>
> How to use it:
>
> - Add an EmailSherlock API credential on the Verify Batch node. Start with an
>   `es_test_` sandbox key to watch every branch run deterministically with no
>   credits spent, then switch to an `es_live_` key for real addresses.
> - Replace the sample addresses with your own, or map an expression like
>   `{{ $json.recipients }}` from an earlier node (a spreadsheet read, a CRM
>   export, a form submission).
> - Extend the IF into a Switch if you want separate lanes for disposable, role,
>   and catch-all.
>
> Get a free key at emailsherlock.com.

### Submission checklist

1. Import `list-cleaning-verify-batch.json` into your own n8n, attach an
   `es_test_` credential, and run it once to confirm the split works.
2. Sign in to the Creator Portal with the same account that owns the verified
   node, create a new template, paste the workflow, and use the title and
   description above.
3. After it goes live, the template appears on the node's integration page on
   n8n.io. Note the gallery URL on EM-990.
