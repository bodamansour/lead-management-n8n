# AI-Based Lead Management & Scoring System

An automated n8n workflow that takes a lead from first contact to a scored,
classified CRM entry — with zero manual work. Built as the final project of an
AI & Automation internship at Orange Digital Center Egypt × Instant Software
Solutions.

Instead of a sales team manually reading every incoming lead, checking for
duplicates, and deciding how urgent it is, this workflow does it automatically:
it validates the submission, checks it against existing records, scores it
using AI, applies a hybrid scoring model, classifies it by priority, saves it
to the CRM, and notifies both the lead and the team — end to end, in seconds.

## Features

- **Lead Intake & Validation** — receives new leads via a webhook and checks
  that required fields are present and well-formed before processing continues.
- **Duplicate Detection** — checks incoming leads against the CRM sheet to
  avoid creating duplicate entries for the same contact.
- **Automatic Lead ID Generation** — assigns each valid, unique lead a
  traceable ID.
- **AI-Based Lead Scoring** — sends the lead's details (company, industry,
  size, budget, service, message) to an AI model, which returns a score,
  category (HOT / WARM / COLD), reasoning, priority, and a recommended action.
- **Hybrid Scoring** — combines the AI score with rule-based business logic
  for a more reliable final score, rather than trusting the model alone.
- **Lead Classification** — routes each lead into a priority tier based on its
  final score.
- **CRM Storage & Notifications** — saves the scored lead to a CRM sheet and
  automatically emails the lead a confirmation message.

## Workflow

```
Webhook (new lead)
   → Normalize Data
   → Validate Lead ──(invalid)──→ Reject Invalid
   → Duplicate Check ──(duplicate)──→ Skip Duplicate
   → Generate Lead ID
   → AI Scoring (Gemini)
   → Hybrid Score
   → Final Score
   → Classify (HOT / WARM / COLD)
   → Save to CRM (Google Sheets)
   → Send Welcome Email
   → Respond to Webhook
```

## Tech Stack

- **n8n** — workflow orchestration and automation
- **Google Gemini API** — AI-based lead scoring and reasoning
- **Google Sheets** — CRM storage and duplicate lookups
- **Gmail** — automated lead notifications
- **Webhook** — external lead intake (e.g. from a website contact form)

## Setup

1. Import `lead management.json` into your n8n instance (**Workflows → Import
   from File**).
2. Connect your own credentials for each service used in the workflow:
   - Google Sheets OAuth2 (for the CRM sheet)
   - Gmail OAuth2 (for notifications)
   - HTTP Bearer Auth (for the Gemini API key)
3. Replace the placeholder Google Sheet ID in the **Duplicate Check** and
   **Save to CRM** nodes with your own sheet's ID.
4. Activate the workflow. The Webhook node will give you a live URL to submit
   leads to (e.g. from a form or CRM integration).

## Known Limitations

- Lead scoring depends on the quality of the fields submitted; sparse lead
  data produces a less reliable AI score.
- Currently uses Google Sheets as the CRM; a dedicated CRM (HubSpot, Airtable,
  etc.) would scale better for higher lead volume.
- No retry logic yet if the AI scoring call fails — a failed call currently
  stops that lead's processing rather than falling back to a rule-based-only
  score.
