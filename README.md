# @mi8y/cds-langgraph-persistence

[![npm version](https://img.shields.io/npm/v/@mi8y/cds-langgraph-persistence)](https://www.npmjs.com/package/@mi8y/cds-langgraph-persistence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![monthly downloads](https://img.shields.io/npm/dm/@mi8y/cds-langgraph-persistence)](https://www.npmjs.com/package/@mi8y/cds-langgraph-persistence)

Take your LangGraph agents to production on SAP CAP. This CDS plugin adds **durable, multi-tenant checkpointing** — your agents survive restarts, recover from failures, and isolate state per tenant, all through the same database your CAP app already uses.

This package is a SAP CAP CDS plugin that provides [**LangGraph persistence**](https://docs.langchain.com/oss/javascript/langgraph/persistence) (Checkpoint & Memory Saver) backed by the CAP data layer. Your agents gain durable, multi-tenant checkpointing on any database CAP supports — SQLite, SAP HANA, PostgreSQL, and more — with zero additional infrastructure.

This initial release includes the **Checkpoint Saver** (`CdsCheckpointSaver`). Memory storage (`CdsMemoryStore`) is planned for a future release.

## Overview

Running AI agents in production introduces hard problems: what happens when a long-running workflow crashes midway? How do you pause for human approval and resume days later? How do you keep each tenant's conversations isolated?

LangGraph's [persistence layer](https://docs.langchain.com/oss/javascript/langgraph/persistence) solves these by saving graph state at every step. This plugin makes that persistence layer run on CAP CDS, so your agents get **production-grade durability** without adding a separate database or state store.

Because CDS handles database mapping, connection pooling, and multi-tenancy natively:

- **Any database.** Develop on SQLite, deploy to HANA or PostgreSQL — no code changes.
- **Multi-tenant by default.** CAP routes DB queries to the correct tenant automatically via `@sap/cds-mtxs`.
- **Crash recovery.** Interrupted runs resume from the last saved checkpoint instead of starting over.
- **Human-in-the-loop.** Pause workflows indefinitely and resume exactly where they left off.
- **Time travel.** Every step is a snapshot — rewind and replay from any point.
- **No new infrastructure.** Checkpoint tables live in your CAP project's existing database.

## Installation

```bash
npm install @mi8y/cds-langgraph-persistence
```

Then register the persistence entities in your CAP project:

```bash
cds add langgraph-persistence
```

This creates `srv/langgraph-persistence.cds` with the import that adds the `Checkpoints` and `CheckpointWrites` entities to your project model. This step is **mandatory** — without it, the entities are not available at build time.

Requires `@sap/cds >=9` as a peer dependency.

## How does this work

The package is a CDS plugin — `cds-plugin.js` auto-registers on startup and tells CDS to load `index.cds`. This adds two entities to your project model under the `plugin.langgraph.persistence` namespace:

| Entity             | Purpose                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `Checkpoints`      | Graph state snapshots — keyed by `(graphName, id, namespace, threadId)` with serialized checkpoint and metadata payloads |
| `CheckpointWrites` | Pending writes linked to each checkpoint — composition child of `Checkpoints`                                            |

CDS handles DDL generation for each target database, and in multi-tenant setups the tables are deployed per tenant automatically.

At runtime, the `CdsCheckpointSaver` writes through CAP CDS queries (`SELECT`, `UPSERT`, `DELETE`), which CDS routes to the correct database and tenant based on the active request context. This means tenant isolation happens transparently — you don't write multi-tenancy logic, CAP handles it.

## Usage

The examples below show agents running inside CAP service handlers. This is important because CAP handlers carry a [CDS context](https://cap.cloud.sap/docs/node.js/cds-context) (`req.user.id`, `req.tenant`) — the checkpointer inherits the active database connection, which CDS automatically routes to the correct tenant.

### Service definition

Define an action on your CAP service. All three agent frameworks hook into the same pattern:

```cds
// srv/agent-service.cds
service AgentService {
  action invoke(message: String) returns String;
}
```

### LangGraph

Build and compile a LangGraph workflow, then invoke it inside a CAP handler with a `thread_id`:

```ts
// srv/agent-service.ts
import cds from "@sap/cds";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";

const State = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

const graph = new StateGraph(State)
  .addNode("agent", async (state) => ({ messages: ["Hello!"] }))
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__")
  .compile({
    checkpointer: new CdsCheckpointSaver({ name: "my-agent" }),
  });

export default class AgentService extends cds.ApplicationService {
  async init() {
    this.on("invoke", async (req) => {
      const { message } = req.data;

      const threadId = `${req.user.id}`;

      const result = await graph.invoke(
        { messages: [message] },
        { configurable: { thread_id: threadId } },
      );

      return result.messages.at(-1) ?? "";
    });

    return super.init();
  }
}
```

### LangChain Agents (`createAgent`)

Use `createAgent` from the `langchain` package — the recommended agent API that runs on LangGraph under the hood:

```ts
// srv/agent-service.ts
import cds from "@sap/cds";
import { createAgent } from "langchain";
import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [searchTool, calculatorTool],
  systemPrompt: "You are a helpful assistant.",
  checkpointer: new CdsCheckpointSaver({ name: "my-agent" }),
});

export default class AgentService extends cds.ApplicationService {
  async init() {
    this.on("invoke", async (req) => {
      const { message } = req.data;

      const result = await agent.invoke(
        { messages: [{ role: "user", content: message }] },
        { configurable: { thread_id: req.user.id } },
      );

      return result.messages.at(-1)?.content ?? "I couldn't process that.";
    });

    return super.init();
  }
}
```

### Deep Agents

Deep Agents run on LangGraph and produce many sub-agents. The checkpointer ensures mid-run failures don't lose completed work:

```ts
// srv/agent-service.ts
import cds from "@sap/cds";
import { createDeepAgent } from "deepagents";
import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";

const agent = createDeepAgent({
  model: "claude-sonnet-4-20250514",
  checkpointer: new CdsCheckpointSaver({ name: "my-agent" }),
});

export default class AgentService extends cds.ApplicationService {
  async init() {
    this.on("invoke", async (req) => {
      const { message } = req.data;

      const result = await agent.invoke(
        { messages: [{ role: "user", content: message }] },
        { configurable: { thread_id: req.user.id } },
      );

      return result.messages.at(-1)?.content ?? "No response generated.";
    });

    return super.init();
  }
}
```

### Thread management

The `thread_id` in `configurable` is how LangGraph separates conversations. In a CAP handler:

```ts
// Per-user conversation — one thread per user (automatically multi-tenant safe)
{
  configurable: {
    thread_id: req.user.id;
  }
}

// Per-session — generate a new thread per request/task
{
  configurable: {
    thread_id: crypto.randomUUID();
  }
}
```

Pick the strategy that fits your use case. For a typical chatbot, scoping by `req.user.id` gives each user a persistent conversation that survives redeploys.

## API

### `new CdsCheckpointSaver(config, serde?)`

Creates a checkpoint saver instance. `config.name` is a **required** identifier that scopes all checkpoints to a specific graph/agent, preventing collisions when multiple graphs share the same database. Optionally accepts a `SerializerProtocol` for custom serialization (defaults to `JsonPlusSerializer`).

| Config Option | Type     | Description                                                                                                                                                                                                                                                     |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string` | **Required.** Graph/agent identifier persisted as the `graphName` column, isolating state per graph.                                                                                                                                                            |
| `ttl`         | `number` | Optional. Time-to-live in milliseconds. When set, each checkpoint receives an `expiresAt = createdAt + ttl` timestamp. A background sweeper deletes threads whose latest checkpoint has expired (see [TTL & Lifecycle Management](#ttl--lifecycle-management)). |

The saver implements the full `BaseCheckpointSaver` from `@langchain/langgraph-checkpoint` interface:

| Method                                           | Description                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `getTuple(config)`                               | Fetch a checkpoint and its pending writes by `thread_id` and optional `checkpoint_id` |
| `list(config, options?)`                         | List checkpoints for a thread with optional `limit`, `before`, and `filter`           |
| `put(config, checkpoint, metadata, newVersions)` | Store a new checkpoint (idempotent upsert)                                            |
| `putWrites(config, writes, taskId)`              | Store pending writes for a checkpoint (idempotent upsert)                             |
| `deleteThread(threadId)`                         | Remove all checkpoints and writes for a given thread                                  |

## Durability in Production

The persistence layer checkpoints state at every graph step. A run interrupted by a **failure, timeout, or human-in-the-loop pause** resumes from its last recorded state without reprocessing previous steps.

Checkpointing enables:

- **Fault tolerance.** Recover from crashes or timeouts without losing completed work.
- **Indefinite interrupts.** Human-in-the-loop workflows can pause for minutes or days and resume exactly where they left off.
- **Time travel.** Every checkpoint is a snapshot you can rewind to, letting you replay from an earlier state.
- **Safe handling of sensitive operations.** For workflows involving payments or irreversible actions, checkpoints provide an audit trail and a recovery point.

In CAP deployments, CDS manages the database connection pool and MTX handles tenant isolation — no additional infrastructure is needed beyond what your CAP application already provides.

### Transaction Isolation

Every checkpointer write operation (`put`, `putWrites`, `deleteThread`) runs in its own independent root transaction via `cds.tx()`. This is critical when the agent is invoked inside an outboxed service — if the service transaction rolls back on failure, the checkpoint data is **not** affected and remains safely persisted. Your agent's state survives even when the enclosing request does not.

### Checkpoint TTL & Lifecycle Management

Checkpoints accumulate on every super-step of a LangGraph workflow. Without cleanup, they grow unbounded. When a graph is configured with a `ttl`, each checkpoint receives an `expiresAt` timestamp (`createdAt + ttl`). A background sweeper then periodically deletes threads whose latest checkpoint has expired.

Add `ttl` to the saver config to attach expiry timestamp to every checkpoint

```ts
const saver = new CdsCheckpointSaver({
  name: "my-agent",
  ttl: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
});
```

#### Option A: Automatic Background Job Configuration

Then configure the sweep interval for the background sweeper job. The default is `false` i.e. no sweeper runs. Set a number in milliseconds to enable periodic cleanup by the sweeper. The sweep interval can be adjusted in your project's CDS configuration:

```json
// package.json or .cdsrc.json
{
  "cds": {
    "requires": {
      "cds-langgraph-persistence": {
        "checkpointer": {
          "ttl": {
            // default 'false'
            "sweeperInterval": 21600000 // 6 hours in milliseconds
          }
        }
      }
    }
  }
}
```

> [!WARNING]
>
> - The sweeper runs in the background of your CAP application. It is **not** a separate process or job — it runs in the same Node.js process as your CAP service. If your CAP app is scaled to multiple instances, each instance will run its own sweeper.
> - In case of multi-tenant setup, the sweeper runs per tenant, cleaning up expired checkpoints in each tenant's isolated database. If you have many tenants, consider the below manual cleanup option using a scheduled job per tenant (using BTP Job Schedule service) to avoid multiple sweeper jobs running concurrently and potentially causing contention on the database.

#### Option B: Manual Cleanup

You can also run the sweeper manually in a scheduled job or via a custom script.

```ts
import { purgeExpiredCheckpoints } from "@mi8y/cds-langgraph-persistence";

// uses the current tenant context to purge expired checkpoints
const purgedThreadsInfo = await purgeExpiredCheckpoints();
console.log(
  `Purged ${purgedThreadsInfo.expired} expired threads, skipped ${purgedThreadsInfo.skipped} threads due to interrupted or in-progress state`,
);
```

## Multi-Tenancy

Multi-tenancy is handled automatically when your CAP application uses `@sap/cds-mtxs`. The plugin's entities are deployed into each tenant's isolated database:

- **SAP HANA** — separate HDI container per tenant
- **SQLite** — separate database file per tenant
- **PostgreSQL** — schema-based isolation

At runtime, CDS routes all checkpoint queries to the correct tenant database based on the active request context. No special plugin configuration is required.

## Supported Databases

Any database with a CAP adapter:

- **SQLite** via `@cap-js/sqlite` (development / testing)
- **SAP HANA** via `@cap-js/hana` (production)
- **PostgreSQL** via `@cap-js/postgres` (production)

## License

[MIT License](./LICENSE)

<small>*Usage requires `@sap/cds` under SAP license terms.</small>
