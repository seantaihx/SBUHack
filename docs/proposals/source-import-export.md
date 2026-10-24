# PROPOSED: Source import, grounded comparison, and export API

**Status: PROPOSED, not an accepted contract.** This document is for coordination with Sean. It does not change `contracts/openapi.json`, the existing `/api/v1` schemas, or backend code. Frontend code must not send these fields/routes until Sean confirms the wire contract.

## Goals and boundaries

- Preserve existing text-only `POST /api/v1/runs` behavior.
- Let the user preview the exact extracted source before explicitly submitting it for inference.
- Give baseline and optimized attempts identical immutable source bytes/text and task instructions.
- Preserve source provenance and deterministic references with each run so refresh and exports explain what was used.
- Never treat document contents as system instructions. Do not execute PDF actions, CSV formulas, scripts, or embedded instructions.
- Return explicit failures for unsupported, unsafe, incomplete, or over-limit sources. Do not silently truncate, substitute fixtures, or claim a failed fetch was read.
- Keep parsing/retrieval duration distinct from model-attempt latency and token usage.
- No auth, secrets, or user cookies are forwarded to source URLs or model providers.

## Proposed limits for Sean to confirm

Suggested initial limits, enforced server-side and exposed in error details where safe:

| Input | Proposed limit |
|---|---:|
| Upload request | 10 MiB total; one file |
| Text-based PDF | 100 pages, 10 MiB; reject encrypted, malformed, scanned/image-only, or unsupported files; no OCR |
| CSV | 10,000 data rows, 200 columns, 10 MiB; UTF-8/UTF-8 BOM only; RFC 4180 quoting; comma delimiter only initially |
| Extracted text | 100,000 Unicode characters per source; reject rather than silently truncate |
| Parse/fetch processing | 20 seconds total per request |
| Public webpage | HTTP(S), 5 MiB response, 10-second connect/read deadline, at most 3 redirects |
| Run | Existing limits remain authoritative; source input counts toward provider context/token limits and existing spending reservations |

These are proposals, not current guarantees. Sean should confirm or replace each limit before implementation. For CSV, formula-like cell values are data: preserve them as text and never execute them.

## Source creation and preview routes (proposed)

All paths are relative to `/api/v1`; JSON errors use the existing `{error:{code,message,details}}` envelope. All success responses are JSON. A source is immutable after creation; editing input creates a new source ID.

### `POST /sources/text`

Request JSON:

```json
{ "name": "Pasted text", "text": "Exact user supplied source text" }
```

`name` is optional and limited to 200 characters; `text` is required and nonempty. Reject over-limit content; do not trim or silently shorten source content (whitespace can be meaningful). Response: `201 {"source": SourceSnapshot}`.

### `POST /sources/files`

Request: `multipart/form-data`, one `file` field. The server checks actual file signatures/content as well as filename and declared media type. Accept text-based PDF and CSV only. Response: `201 {"source": SourceSnapshot}`.

### `POST /sources/webpage`

Request JSON:

```json
{ "url": "https://www.example.org/public/report" }
```

Only direct public HTTP(S) page retrieval; no crawling, search, login, JavaScript execution, or access-control bypass. Response: `201 {"source": SourceSnapshot}` only after retrieval and extraction both succeed. Store original and final URL and retrieval time.

### `GET /sources/{source_id}`

Returns `200 {"source": SourceSnapshot}` for a source the backend still retains. It supports refresh restoration and re-opening the exact source preview. The client renders extracted text as text, never HTML.

### Proposed `SourceSnapshot`

```json
{
  "source_id": "<uuid>",
  "kind": "text",
  "name": "Pasted text",
  "media_type": "text/plain",
  "original_url": null,
  "final_url": null,
  "retrieved_at": null,
  "content_sha256": "<hex sha256 of canonical extracted UTF-8 text>",
  "extracted_text": "Exact complete extracted text, never an undocumented prefix",
  "character_count": 29,
  "unit_count": null,
  "truncated": false,
  "references": []
}
```

`kind` is `text|pdf|csv|webpage`. `unit_count` is pages for PDF, data rows for CSV, otherwise null. `references` gives stable source locators for extracted units, e.g. `{ "kind":"pdf_page", "page_number":2, "start_char":120, "end_char":240 }` or `{ "kind":"csv_cell", "row_number":4, "column_name":"value", "start_char":120, "end_char":132 }`. References point into the exact `extracted_text` snapshot; they are not proof that a model's claim is correct. Since this proposal rejects over-limit text, `truncated` is false for accepted snapshots. Keep the flag in the schema so a future negotiated partial-extraction mode cannot be silent.

## Source parsing and retrieval errors

All failures must be safe and actionable, without server paths, parser stacks, DNS answers, private network addresses, source body contents, or credentials in messages/details.

| HTTP | Proposed error codes | Meaning/UI behavior |
|---|---|---|
| `400` | `SOURCE_INVALID`, `SOURCE_URL_INVALID` | Malformed request/source; preserve selected input and show safe reason. |
| `413` | `SOURCE_TOO_LARGE`, `SOURCE_TOO_MANY_PAGES`, `SOURCE_TOO_MANY_ROWS`, `SOURCE_TEXT_TOO_LARGE` | Limit exceeded; explain exact configured limit; do not offer inference on partial content. |
| `415` | `SOURCE_TYPE_UNSUPPORTED`, `SOURCE_PDF_ENCRYPTED`, `SOURCE_PDF_SCANNED`, `SOURCE_CSV_ENCODING_UNSUPPORTED`, `SOURCE_CSV_DELIMITER_UNSUPPORTED` | Unsupported type/content; no successful source preview is fabricated. |
| `422` | `SOURCE_PARSE_FAILED`, `SOURCE_EMPTY`, `SOURCE_URL_UNSUPPORTED_CONTENT` | Malformed/empty extraction or unsupported response. |
| `429` | `SOURCE_RATE_LIMITED` | Retry only after server-provided delay; no repeated run submission. |
| `502`/`504` | `SOURCE_FETCH_FAILED`, `SOURCE_FETCH_TIMEOUT`, `SOURCE_FETCH_TOO_LARGE`, `SOURCE_REDIRECT_BLOCKED`, `SOURCE_DESTINATION_BLOCKED` | Retrieval failed/unsafe; no inference from that source. |
| `503` | `SOURCE_SERVICE_UNAVAILABLE` | Extractor unavailable; no fixture success in API mode. |

Specific PDF errors should explain that OCR is unsupported for image-only PDFs. CSV errors should identify row/column if safe, while preserving valid quoted multiline fields and Unicode. A retrieval success without extracted text is an error, not an empty successful source.

## Run request and response additions (proposed)

Keep all existing fields and behavior. Add one optional source reference to `CreateRun`:

```json
{
  "mode": "demo",
  "tasks": [{ "id": "task-1", "type": "summarize", "prompt": "Summarize the supplied source." }],
  "carbon_intensity_g_per_kwh": 400,
  "source_snapshot_id": "<uuid>",
  "confirm_source_submission": true
}
```

`source_snapshot_id` must resolve to the immutable previewed snapshot. `confirm_source_submission:true` is required when a source is present and records the explicit frontend confirmation. Existing text-only payloads remain valid with neither field. Backend applies the same exact instruction and extracted source text to baseline and optimized prompts; clients do not duplicate or transform extracted content in `tasks[].prompt`.

On the `Run` response, add `source_snapshot` with the snapshot ID, kind, name, media type, original/final URL, retrieval time, content hash, character/unit counts, and source references. For reproduction, backend retains the exact source representation for the run and `GET /sources/{id}` returns it while retained. The run itself snapshots the metadata/hash so later source changes cannot alter past evidence. Include the source representation in JSON exports only if its retention/privacy behavior is agreed; a hash alone is not the source.

Each `Result` may add `source_references: SourceReference[]`; empty means the response supplies no references. Proposed shape:

```json
{
  "source_id": "<uuid>",
  "locator": { "kind": "csv_cell", "row_number": 4, "column_name": "utilization" },
  "excerpt": "91.0%",
  "answer_excerpt": "2015 annual utilization was 91.0%.",
  "excerpt_match_validated": true
}
```

Validation means the cited excerpt and locator exist in the immutable supplied snapshot, not that the reasoning is correct. Missing evidence must be represented explicitly (for example, a documented `not_found_in_source` result status/field), and neither policy may invent evidence. Ask Sean to choose a schema that can express this without conflating it with provider failure. Keep retrieval/parse milliseconds separate from each attempt's `latency_ms`; define whether source tokens are included in `input_tokens` and expose that consistently for both policies/cost reservations.

The EIA regression case should use a saved synthetic table with 2015 utilization `91.0%` and its row locator; removing 2015 must yield the explicit not-found state. A homepage snapshot alone must not satisfy the historical table case.

## URL retrieval safety requirements

Backend fetch must resolve and validate every A/AAAA destination as public, reject loopback/private/link-local/multicast/reserved/metadata addresses for IPv4 and IPv6, revalidate each redirect target, and bind the actual connection to a validated destination to mitigate DNS rebinding. Permit only HTTP(S) on approved ports; cap redirects/time/bytes; validate content type; strip fragments; do not forward cookies, authorization, proxy credentials, or provider secrets. No scripts/active content run. Rejected fetches return safe `SOURCE_*` errors above. Do not run tests against private infrastructure; unit tests should inject controlled DNS/HTTP transports.

## Storage, privacy, and cleanup decision needed

The backend has no current source upload or delete API. Sean must choose before implementation:

1. Whether extracted source is persisted in SQLite, a bounded temporary store, or another approved location.
2. Retention for unbound previews and run-bound snapshots, cleanup after process restart, and whether users can delete/unbind their source.
3. Whether a run record retains source content for exact reproduction or only a hash/reference (a reference is insufficient if its content expires).
4. Whether source text can appear in JSON/PDF exports and what warning/retention applies.

Proposed default for discussion: purge unbound previews after 30 minutes; keep a run-bound immutable snapshot for the same retention period as the run; expose that retention plainly before submission. Do not implement this default without Sean's agreement. This prototype is unauthenticated, so do not upload personal, confidential, or regulated data.

## Frontend behavior and fixture boundary

- Source choice UI: pasted text, PDF, CSV, and public URL (URL remains marked proposed until safe retrieval is implemented).
- File selection is local until user presses the explicit parse/preview action; inference is a second explicit action after preview and warning.
- Show selected filename, parse/fetch progress, content preview, source locator hints, limits, and removal/change controls.
- In API mode call only accepted source routes; an unavailable route is a visible unavailable/error state, never fixture success.
- If UI fixtures are added before backend agreement, mark every fixture-only result as fixture data and keep it behind an explicit fixture-mode boundary. Never label a fixture as parsed from the selected file or fetched from the selected URL.
- Render source text and model output as text; never `dangerouslySetInnerHTML`.

## Sean's exact decisions requested

1. Accept/revise the three source-creation routes and `GET /sources/{id}`.
2. Confirm upload, page/row, extracted text, fetch time/bytes/redirect, and source token limits.
3. Confirm source storage, run snapshot, deletion, retention, and export privacy rules.
4. Confirm `source_snapshot_id` plus explicit submission confirmation on `CreateRun`.
5. Define citation and `not_found_in_source` fields/status, reference validation, and source-token accounting.
6. Approve the URL SSRF controls and source content-type restrictions.

Only after agreement should the shared OpenAPI document/examples and backend change. Until then the existing text-only API remains the accepted contract.
