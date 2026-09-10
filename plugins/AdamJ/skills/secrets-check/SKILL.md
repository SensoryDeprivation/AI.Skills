---
description: Scan all modified files for secrets, API keys, and credentials. Use before any git commit or push operation.
---

Scan every file listed in `git status --porcelain` for secrets and credentials.

Check each file for these patterns:

- Anthropic API keys: `sk-ant-`
- Google API keys: `AIza`
- AWS access keys: `AKIA`, `ASIA`
- GitHub tokens: `ghp_`, `gho_`, `github_pat_`
- Slack tokens: `xoxb-`, `xoxp-`
- Stripe keys: `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`
- Private key PEM blocks: `-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`
- Certificate blocks: `-----BEGIN CERTIFICATE-----`
- JWT tokens: three dot-separated base64 segments starting with `eyJ`
- Inline assignments: `password =`, `secret =`, `api_key =`, `token =` followed by a non-placeholder value

Also flag any untracked sensitive filenames: `.env`, `.env.local`, `id_rsa`, `id_ed25519`, `credentials.json`, `service-account.json`, `*.pem`, `*.key`, `*.pfx`, `*.p12`.

**If findings are detected:**
- List each: file path, line number, pattern matched
- Explain the risk briefly
- Do NOT proceed with any git operation
- Tell the user to rotate any exposed credentials immediately

**If no findings:**
- Confirm "No secrets or credentials detected" and report ready to commit
