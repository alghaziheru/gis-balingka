# Security Policy

## Supported Versions

Security fixes are applied to the latest commit on the `main` branch.

## Reporting a Vulnerability

If you discover a security vulnerability (such as authentication bypass, path traversal, injection, or data exposure), **please do not open a public GitHub issue**.

Instead, please report it privately using **GitHub Private Vulnerability Reporting** under the repository's **Security → Advisories** tab, or contact the maintainer directly via GitHub. Include:

- A clear description of the vulnerability and potential impact
- Steps to reproduce or a minimal proof of concept
- Any suggested remediation if known

We aim to acknowledge reports within 72 hours and coordinate a fix before public disclosure.

## Production Deployment Hardening Checklist

When deploying this application on a public VPS:

1. **Always set `ADMIN_PASSPHRASE` in `.env`:** Leaving it empty is intended for `localhost` development only. Use a strong random passphrase (`>= 24` characters).
2. **Use HTTPS via a reverse proxy (Caddy / Nginx):** Because `X-Admin-Passphrase` is sent over HTTP headers, always terminate TLS in front of Node (`HOST=127.0.0.1` + reverse proxy on port `443`).
3. **Built-in server protections:**
   - Timing-safe SHA-256 passphrase comparison (`crypto.timingSafeEqual`)
   - Passphrase-protected reads on `GET /api/suggestions` (preventing public exposure of citizen submissions) and all mutating editor endpoints
   - Sliding-window in-memory rate limiting on `POST /api/editor/verify` and `POST /api/suggestions`
   - Strict static path-traversal guard and standard HTTP security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`)
   - Request JSON payload size caps (`8 KB`–`512 KB` depending on route)
4. **Back up `data/balingka.db` regularly** and ensure `data/` is never exposed statically.
