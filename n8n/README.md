# NearGrow Ads — n8n Automation Workflows

This directory contains importable n8n workflow definitions for automated lead processing, inquiry routing, and operational health monitoring.

## Included Workflows

1. **`new-lead-notification.json`**:
   - Triggers when an inquiry is received from `/api/leads`.
   - Validates the incoming payload.
   - Dispatches formatted email notifications to the NearGrow Ads strategy team.
   - Appends lead details to the internal Google Sheets lead tracker.

2. **`lead-routing.json`**:
   - Evaluates the requested `serviceInterest`.
   - Routes high-ticket Google Ads inquiries to the Paid Media desk.
   - Routes Google Business Profile inquiries to the Local SEO team.
   - Routes Website Development inquiries to the engineering team.

3. **`operational-monitoring.json`**:
   - Health check poller that checks `/api/health` every 15 minutes.
   - Alerts administrators if endpoint response time exceeds 2500ms or fails.

## Setup Instructions

1. Log into your n8n Cloud or self-hosted instance.
2. Select **Workflows > Import from File** and select any `.json` file in this folder.
3. Configure your credentials for SMTP email and Google Workspace.
4. Set the webhook URL in your `.env` file as `N8N_LEAD_WEBHOOK_URL`.
