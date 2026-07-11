# LangChain CDS Persistence Example

A SAP CAP application demonstrating how to build production-ready LangChain agents with **durable conversation persistence** using `@mi8y/cds-langgraph-persistence`. The agent queries a books catalog via CDS tools, and all conversation state — every step, every tool call — is checkpointed to the CAP database.

No external state store. No additional infrastructure. Just your CAP database.

## The Value: Production-Ready Agents with Durability

Agents in production face hard problems: what happens when a long workflow crashes midway? How do you pause for human approval and resume days later? How do you keep conversations isolated per user?

The `CdsCheckpointSaver` solves these by checkpointing agent state to your CAP database at every step:

- **Crash recovery.** An interrupted run resumes from the last saved checkpoint instead of starting over.
- **Human-in-the-loop.** Pause workflows for minutes or days and resume exactly where they left off.
- **Thread isolation.** Separate conversations per user and thread — each has independent history.
- **Zero new infrastructure.** Checkpoint tables live in your CAP project's existing database, on any database CAP supports (SQLite, HANA, PostgreSQL).
- **Multi-tenant by default.** CAP routes checkpoint queries to the correct tenant automatically.

## Walkthrough

The `test.http` file walks through a 6-step scenario that demonstrates durability and thread isolation in action. Each request is sent to `http://localhost:4004`.

### Step 1: Verify empty checkpoints

```
GET /odata/v4/info/Checkpoints
```

The checkpoints table starts empty. No conversations have happened yet.

### Step 2: Ask the agent for all books

```
POST /rest/agent/invoke
{
  "threadId": "test-thread-1",
  "content": "Give me the list of all the books in the catalog."
}
```

The agent uses its `get_books` tool to query the `InfoService.Books` entity via CDS. Behind the scenes, a checkpoint is persisted — the agent's state is now durable.

### Step 3: Ask for books by a specific author

```
POST /rest/agent/invoke
{
  "threadId": "test-thread-1",
  "content": "Provide me with a list of books written by Edgar Allen Poe."
}
```

Same thread. The agent calls `get_books` with an `author` filter. Since the checkpointer saved the previous state, the conversation context accumulates — the agent knows this is a continuation.

### Step 4: Recall conversation history

```
POST /rest/agent/invoke
{
  "threadId": "test-thread-1",
  "content": "What are the questions have I asked you so far?"
}
```

**This is the key moment.** The agent answers by recalling the prior messages — "you asked for all books, then for books by Edgar Allen Poe." This works because the `CdsCheckpointSaver` persisted the full state graph on every step. Without a checkpointer, the agent would have no memory of previous turns.

### Step 5: Inspect persisted checkpoints

```
GET /odata/v4/info/Checkpoints
```

The table is now populated. Each row is a checkpoint — a snapshot of the agent's state at a point in time. These are browseable via OData, making them observable and debuggable.

### Step 6: Prove thread isolation

```
POST /rest/agent/invoke
{
  "threadId": "test-thread-2",
  "content": "What are the questions have I asked you so far?"
}
```

Switching to `test-thread-2` starts a fresh conversation. The agent has no memory of `test-thread-1`'s history. Thread isolation means each user or session gets independent state — no cross-contamination.

## How It Works

1. **CDS plugin auto-registration.** Installing `@mi8y/cds-langgraph-persistence` adds `Checkpoints` and `CheckpointWrites` tables to your CDS model automatically. No manual schema setup.

2. **Checkpoint saver.** The `CdsCheckpointSaver` implements LangGraph's `BaseCheckpointSaver` interface using CDS queries (`SELECT`, `UPSERT`, `DELETE`). It serializes agent state on every step and deserializes it when a thread resumes.

3. **Thread ID composition.** The `thread_id` is composed from the request's `threadId` and the authenticated user ID (`req.user.id`), ensuring each user has isolated conversation history. In multi-tenant setups, the tenant is handled transparently by CAP.

4. **OData observability.** The `InfoService` exposes `Checkpoints` as a projection on the plugin's table, making checkpoint state inspectable via OData — useful for debugging and monitoring.

```cds
service InfoService {
  entity Checkpoints as projection on langgraph.Checkpoints;
}
```

## Project Structure

```
examples/langchain-cds-persistence/
├── .env.example              # Environment template (SAP AI Core credentials)
├── package.json
├── test.http                 # HTTP test scenarios (6 steps)
├── db/
│   └── data/
│       └── InfoService.Books.csv   # Seed data for the books catalog
└── srv/
    ├── info-service.cds      # Books entity + Checkpoints projection
    ├── agent-service.cds     # REST action definition
    └── agent-service.js      # Agent setup with CdsCheckpointSaver
```

## Running the Example

### Prerequisites

- Node.js 20+
- SAP AI Core credentials (for the orchestration model)
- A CAP-supported database (SQLite is used by default for development)

### Setup

```bash
cd examples/langchain-cds-persistence
cp .env.example .env
# Fill in your SAP AI Core credentials in .env
npm install
```

### Start

```bash
npm start
```

The server starts at `http://localhost:4004`.

### Run the test scenarios

Open `test.http` in VS Code with the REST Client extension, or use `curl` to step through the requests in order.

## CDS Memory Store

The `CdsCheckpointSaver` covers short-term agent state (conversation history within a thread). For **long-term memory** — storing facts, user preferences, and knowledge that persists across threads and sessions — the `CdsMemoryStore` is in development and will be added to this example soon.
