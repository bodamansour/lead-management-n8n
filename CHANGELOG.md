# Changelog

## v2 (October 2026)

Improves the internship capstone version (v1, August 2026).

### Fixed
- **Duplicate Check** now looks up the lead's email. In v1 it looked up `lead_id`,
  which doesn't exist yet at that step, so duplicates were never caught.
- **AI Scoring** now calls the Gemini API endpoint
  (`generativelanguage.googleapis.com`) with the `x-goog-api-key` header. In v1 the
  URL pointed to the AI Studio website and used Bearer auth.
- **Save to CRM** now saves the score, label, reason, priority, and recommended
  action. In v1 only 7 contact fields were saved.
- The rule score is scaled to 0-100. Its maximum was 80, so HOT was almost
  unreachable.
- Invalid and duplicate leads now get a webhook reply (HTTP 400 or `duplicate`)
  instead of no reply.
- If Gemini fails or returns unreadable text, the lead is still scored with the
  rules only (2 tries, then fallback).
- The confirmation email's broken sentence is fixed, and n8n's footer is turned off.
- Budget and employee values like `$5,000` are read correctly.
- Intent keywords match whole words, so "now" no longer matches "know".

### Added
- **Config** node for the company name, team email, AI criteria, thresholds,
  weights, and model.
- **Alert Team (HOT)** email.
- Email format check in **Validate Lead**.
- Names, emails, and phone numbers are no longer sent to the AI.
- `extras/error-alert.json`, `extras/daily-lead-summary.json`,
  `extras/test-form.html`, and `crm-columns.csv`.

### Tested
On n8n 2.42.5 with a local mock of the Gemini API: HOT, WARM, and COLD leads;
missing email; invalid email; duplicate; AI down; unreadable AI answer; and an
HTML form post. Google Sheets and Gmail were replaced with mocks in the test
copy, so connect real credentials and send one test lead before going live.
