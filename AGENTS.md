# CDS Persistence Plugin for LangGraph Checkpoint & Memory

This project builds a CDS Plugin for SAP CAP applications to build LangGraph/LangChain/Deep Agents based applications with Checkpoint and Memory persistence. It provides necessary tooling as well as library support for agents built within SAP CAP applications.

## Project Structure

/
├── package.json
├── AGENTS.md <- You are here
├── src
│ ├── checkpoint
│ │ ├── cds-checkpointer.ts
│ │ └── index.ts
│ └── memory
│ ├── cds-memory.ts
│ └── index.ts
├── tests
│ ├── checkpoint
│ └── memory
└── cds-plugin.js

## Development

- Project uses **`pnpm`** as package manager. `npm install -g pnpm` if not already installed.
- `pnpm install` to install dependencies.

## Testing

- Uses Vitest framework and follows `*.test.ts` naming convention.
- `pnpm test` to run tests

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md)
