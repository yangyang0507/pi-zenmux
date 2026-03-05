# ZenMux Provider Extension for pi

This package adds a `zenmux` provider to pi using the extension API (`registerProvider`), as requested in [badlogic/pi-mono#1811](https://github.com/badlogic/pi-mono/issues/1811).

## Features

- Registers provider name: `zenmux`
- Uses API key env var: `ZENMUX_API_KEY`
- Uses bundled model snapshot (`zenmux-models.generated.js`) at runtime
- Routes Anthropic models to `https://zenmux.ai/api/anthropic` with `anthropic-messages`
- Routes non-Anthropic models to `https://zenmux.ai/api/v1` with `openai-completions`
- Model `maxTokens` is merged from `https://models.dev/api.json` during generation

## Install

### Local path

```bash
pi install /absolute/path/to/pi-zenmux
```

### NPM

```bash
pi install npm:pi-zenmux
```

## Configure

Set API key:

```bash
export ZENMUX_API_KEY="your-zenmux-key"
```

Or use `~/.pi/agent/auth.json`:

```json
{
  "zenmux": {
    "type": "api_key",
    "key": "your-zenmux-key"
  }
}
```

## Use

```bash
pi --provider zenmux --model anthropic/claude-opus-4.6
```

You can also start `pi` normally and switch with `/model`.

## Optional endpoint override

If you need to route to a different ZenMux domain:

```bash
export ZENMUX_BASE_URL="https://zenmux.ai"
```

The extension derives:

- OpenAI-compatible base: `${ZENMUX_BASE_URL}/api/v1`
- Anthropic-compatible base: `${ZENMUX_BASE_URL}/api/anthropic`

## Publish

```bash
npm run generate:models
npm run check
npm login
npm publish --access public
```

## Dev / Test

```bash
npm install
npm run generate:models
npm run typecheck
npm test
```
