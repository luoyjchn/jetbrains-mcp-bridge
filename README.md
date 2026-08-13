# jetbrains-mcp-bridge

Bridge JetBrains IDE features to Claude Code via the Model Context Protocol.

## Installation

```bash
claude plugin install jetbrains-mcp-bridge
```

## Configuration

Run the setup command inside your Claude Code session to generate the MCP configuration:

```
/jetbrains-mcp-bridge-setup
```

This configures the bridge to connect with your running JetBrains IDE.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
