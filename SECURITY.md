# Security

## Reporting

Open a private security advisory on GitHub, or contact the maintainers through
the repository issue tracker without including secrets.

## Data boundary

- The plugin's default data root is `~/.dsh/cortex`.
- It does not read another memory plugin's database.
- `hash` mode is fully local.
- `local` embedding mode sends text only to the configured local endpoint.
- `remote` embedding mode sends text to the configured remote endpoint.
- API keys are stored locally and redacted from the settings API.

## Never include in an issue

- API keys, credentials, session logs with private text
- Full SQLite files or backups
- Personal memory snapshots

## Dependencies

The runtime uses Node built-ins (`node:sqlite`, `node:crypto`, `node:http`)
and has no required third-party runtime dependencies. Optional local embedding
requires the user to run an OpenAI-compatible local service such as Ollama.
