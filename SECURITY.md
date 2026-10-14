# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **hello@aistartacademy.com** with
the subject line `SECURITY: <short summary>`, a description, and steps to reproduce. We aim to
acknowledge within 3 business days and to ship a fix or mitigation for confirmed issues as fast as
severity requires.

## Supported versions

Security fixes land on `main` and in the latest tagged release.

## Deployment notes for operators

- Never commit `.env`. Every secret is read from the environment; `.env.example` lists them with
  placeholder values only.
- Set a strong `AUTH_SECRET` (`openssl rand -hex 32`) in production.
- The internal MCP API (`/api/internal/mcp/v1/*`) is disabled unless `HUB_MCP_TOKEN` is set. Treat
  that token like an admin password and rotate it if it leaks.
- Webhook endpoints (Stripe, Twilio, Vapi, Zoom) verify provider signatures. Configure each
  provider's signing secret before exposing the endpoint publicly.
- The app stores personal data (contacts, consent records, payments metadata, call transcripts if
  enabled). You are the data controller for your deployment; configure retention and backups
  accordingly.
