# JARVIS Trading Control PWA

A dependency-free, iPhone-first static PWA for the existing `Jarvis-Dashboard` repository. It ships as a locked frontend shell because no API Gateway routes, request methods, or response formats were available to verify.

## What is safe to deploy now

- Responsive black/red-neon mobile command-center layout sized for an iPhone 13.
- Installable PWA shell with offline static asset caching.
- Explicit loading/integration boundary: no dashboard API requests are made.
- Disabled start/stop controls; the app cannot affect the - A separate deployment configuration file. It intentionally contains no credentials.

## Integration checklist

Before enabling a screen, verify each capability in the existing API Gateway and document:

1. Public base URL and the exact approved path.
2. HTTP method and required headers/authentication scheme.
3. A redacted success response and failure response.
4. Whether a start/stop endpoint triggers real trading or only the service process.

Then copy `config.example.js` to `config.js` and add **only** those confirmed route mappings. Do not include 
## Local preview

Serve this directory from any HTTPS-capable static host (or a local static server for development). iPhone installation is available through Safari’s Share → Add to Home Screen after it is served over HTTPS.

## Repository handoff

The GitHub connector was not authorized in this workspace and no local clone was present, so these files were prepared as a repository-ready folder rather than committed. Copy its contents into `Jarvis-Dashboard`, commit, and deploy via the repository’s existing static-hosting workflow.
