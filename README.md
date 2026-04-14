# OpenCode Anthropic Auth Plugin (MoerAI Fork)

Forked from [ex-machina-co/opencode-anthropic-auth](https://github.com/ex-machina-co/opencode-anthropic-auth) — synced with upstream v1.5.1.

This fork stays in sync with upstream and includes MoerAI-specific patches when needed.

> [!TIP]
> It is STRONGLY advised that you pin the plugin to a version. This will keep you from getting automatic updates; however, this will protect you from nefarious updates.
>
> This holds true for ANY OpenCode plugin. If you do not pin them, OpenCode will automatically update them on startup. It's a massive vulnerability waiting to happen.

#### Example of pinned version

```json
{
  "plugin": ["@ex-machina/opencode-anthropic-auth@1.6.0"]
}
```

## Authentication Methods

### macOS / Ubuntu (Linux)

```bash
# 1. Clone this fork
git clone https://github.com/MoerAI/opencode-anthropic-auth.git ~/.config/opencode/opencode-anthropic-auth

# 3. Login
opencode auth login  # → Anthropic → Claude Pro/Max
```

## Configuration

The plugin supports the following environment variables:

| Variable                          | Description                                                                                                                                                                                 |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ANTHROPIC_BASE_URL`              | Override the API endpoint URL (e.g. for proxying). Must be a valid HTTP(S) URL.                                                                                                             |
| `ANTHROPIC_INSECURE`              | Set to `1` or `true` to skip TLS certificate verification. Only effective when `ANTHROPIC_BASE_URL` is also set.                                                                            |
| `EXPERIMENTAL_KEEP_SYSTEM_PROMPT` | Set to `1` or `true` to keep the sanitized system prompt in the `system[]` field instead of relocating it to a user message. See [System Prompt Sanitization](#system-prompt-sanitization). |

## How It Works

1. Initiates a PKCE OAuth flow against Anthropic's authorization endpoint
2. Exchanges the authorization code for access and refresh tokens
3. Automatically refreshes expired tokens
4. Injects the required OAuth headers and beta flags into API requests
5. Sanitizes the system prompt for compatibility (see below)
6. Zeros out model costs (since usage is covered by the subscription)

### System Prompt Sanitization

The Anthropic API for Max subscriptions has specific requirements for the system prompt to identify as Claude Code. The plugin rewrites the system prompt on each request using an **anchor-based** approach that minimizes what gets changed:

1. **Identity swap** — The OpenCode identity line is removed and replaced with the Claude Code identity.
2. **Paragraph removal by anchor** — Any paragraph containing a known URL anchor (e.g. `github.com/anomalyco/opencode`, `opencode.ai/docs`) is removed entirely. This is resilient to upstream rewording — as long as the anchor URL appears somewhere in the paragraph, the removal works regardless of surrounding text changes.
3. **Inline text replacements** — Short branded strings inside paragraphs we want to keep are replaced (e.g. "OpenCode" → "the assistant" in the professional objectivity section).

Everything else in the system prompt is preserved: tone/style guidance, task management instructions, tool usage policy, environment info, skills, user/project instructions, and file paths containing "opencode". The system prompt is then **split** and only the billing header and identity line are left in the system prompt. The remainder is moved into a user message to bypass system prompt checks.

> [!NOTE]
> Set `EXPERIMENTAL_KEEP_SYSTEM_PROMPT=1` to skip the relocation step. The sanitized system prompt will remain in `system[]` in its entirety. This may cause API rejections for OAuth-authenticated requests.

## Development

### Local Testing

Use `bun run dev` to test plugin changes locally without publishing to npm:

```bash
bun run dev
```

This does three things:

1. Builds the plugin
2. Symlinks the build output into `.opencode/plugins/` so OpenCode loads it as a local plugin
3. Starts `tsc --watch` for automatic rebuilds on source changes

After starting the dev script, restart OpenCode in this project directory to pick up the local build. Any edits to `src/` will trigger a rebuild — restart OpenCode again to load the new version.

Ctrl+C stops the watcher and cleans up the symlink. If the process was killed without cleanup (e.g. `kill -9`), you can manually remove the symlink:

```bash
bun run dev:clean
```

> [!NOTE]
> If you have the npm version of this plugin in your global OpenCode config, both will load. The local version takes precedence for auth handling.

### Publishing

This project uses [changesets](https://github.com/changesets/changesets) for versioning and publishing. See the [changeset README](.changeset/README.md) for more details.

```bash
bun install
bun test
bun run build
```

## License

MIT
