# Outstanding issue drafts

The repository was searched for open issues covering these items. None were found. GitHub issue creation returned HTTP 403 (`Resource not accessible by integration`), so these drafts are recorded locally and have not been filed.

## Functional

### Add optional OCR for scanned PDF sources

PDF import currently extracts selectable text. Scanned/image-only PDFs return `SOURCE_PDF_SCANNED` because OCR is not installed.

Acceptance:

- Add OCR only with explicit, bounded page/time limits and disclose that OCR was used.
- Preserve page locators and indicate extraction uncertainty in preview.
- Reject malformed/encrypted/unsupported sources safely and never submit partial extraction as complete.
- Add representative scanned-PDF parser tests.

### Add validated answer citations and explicit not-found results

Source snapshots have input locators, but outputs do not have validated citations or a `not_found_in_source` result. Input locators do not prove that a model claim is supported.

Acceptance:

- Agree a versioned result schema for citations and not-found outcomes.
- Validate each cited excerpt and locator against the immutable source snapshot.
- Distinguish unsupported claims from provider failures.
- Add positive, unsupported-claim, and removed-evidence cases for both policies.

### Define source-bound retention and deletion lifecycle

Unbound previews expire after 30 minutes and can be deleted. Source text attached to a run remains in local SQLite without a run/source deletion or retention endpoint; the prototype has no authentication.

Acceptance:

- Agree retention for bound source text and run snapshots.
- Add cleanup and restart/expiry tests.
- Keep source text out of exports unless explicitly approved.
- Document database access and behavior when runs are removed.

### Add representative benchmark review beyond exact and lexical checks

The 24-case synthetic `starter-v2` and analysis export are implemented. Current evaluators are exact/lexical checks; simulated answers match expected values by construction. This does not establish semantic answer quality. Real provider inference remains unverified.

Acceptance:

- Add reviewer-approved workloads and separate automated evaluation from human review.
- Report sample sizes, evaluator methods, provider failures, and incomplete outputs.
- Validate added model IDs, pricing, and account availability before exposing them.
- Keep live evaluation explicit and within existing request/spend limits.

## Visual and accessibility

### Complete browser walkthrough and responsive QA

Automated tests, typecheck, production build, and local simulated HTTP integration pass. A browser automation surface was unavailable during this milestone, so visual, responsive, keyboard and screenshot review remain outstanding.

Acceptance:

- Review desktop, tablet and narrow/mobile widths.
- Check all navigation and controls with keyboard only, visible focus and readable contrast.
- Review loading, empty, network error, queued/running/partial/failed, source confirmation, export and refresh restoration states.
- Capture screenshots that retain execution mode, provenance and assumptions labels.
- Record functional defects separately from cosmetic suggestions.
