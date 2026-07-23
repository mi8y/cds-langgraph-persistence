import {
  Checkpoints,
  CheckpointWrite,
  CheckpointWrites,
} from "#cds-models/plugin/langgraph/persistence";
import { type RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  ChannelVersions,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  copyCheckpoint,
  maxChannelVersion,
  PendingWrite,
  SerializerProtocol,
  TASKS,
  WRITES_IDX_MAP,
} from "@langchain/langgraph-checkpoint";
import cds from "@sap/cds";

/**
 * Configuration for {@link CdsCheckpointSaver}.
 *
 * Every instance must be scoped to a unique `name` so that checkpoints and
 * pending writes belonging to different graphs/agents never collide when they
 * are stored in the same database.
 */
export type CdsCheckpointSaverConfig = {
  /**
   * A **required** identifier matching the graph/agent this saver belongs to.
   *
   * It is persisted as the `graphName` column and used as a composite key in
   * the `Checkpoints` and `CheckpointWrites` entities, isolating state per
   * graph. Use a stable, human-readable value such as `"my-agent"`.
   */
  name: string;
};

/**
 * A LangGraph {@link BaseCheckpointSaver} backed by the SAP CAP data layer.
 *
 * Instances persist graph state (checkpoints and pending writes) through CAP
 * CDS queries (`SELECT`, `UPSERT`, `DELETE`), which CDS routes to the correct
 * database and tenant based on the active request context. This gives agents
 * durable, multi-tenant checkpointing on any database CAP supports (SQLite,
 * SAP HANA, PostgreSQL, …) without additional infrastructure.
 *
 * A saver is scoped to a single graph via the mandatory {@link CdsCheckpointSaverConfig.name},
 * preventing collisions when multiple graphs share the same database.
 *
 * @example
 * ```ts
 * const saver = new CdsCheckpointSaver({ name: "my-agent" });
 * const graph = new StateGraph(State).compile({ checkpointer: saver });
 * ```
 */
export class CdsCheckpointSaver extends BaseCheckpointSaver {
  protected config: CdsCheckpointSaverConfig;

  // The graph name is used to scope the checkpoints and writes to a specific graph instance.
  protected graphName: string;

  constructor(config: CdsCheckpointSaverConfig, serde?: SerializerProtocol) {
    super(serde);
    this.config = config;
    this.graphName = config.name;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    if (!config.configurable) {
      throw new Error(`Empty "config.configurable" supplied`);
    }

    const checkpointId: string | undefined = config.configurable.checkpoint_id;
    const checkpointNamespace: string = config.configurable.checkpoint_ns ?? "";
    const threadId: string | undefined = config.configurable.thread_id;
    if (!threadId) {
      return undefined;
    }

    let query = SELECT.one
      .from(Checkpoints)
      .columns((c) => {
        (c.threadId,
          c.namespace,
          c.id,
          c.parent_id,
          c.type,
          c.checkpoint,
          c.metadata,
          c.writes((w) => {
            (w.taskId, w.channel, w.type, w.value);
          }));
      })
      .where({
        graphName: this.graphName,
        threadId: threadId,
        namespace: checkpointNamespace,
        ...(checkpointId ? { id: checkpointId } : {}),
      });

    if (!checkpointId) {
      query = query.orderBy("id desc").limit(1);
    }

    const resCheckpoint = await query;
    if (!resCheckpoint) {
      return undefined;
    }

    const checkpoint = (await this.serde.loadsTyped(
      resCheckpoint.type ?? "json",
      resCheckpoint.checkpoint ?? "",
    )) as Checkpoint;

    const metadata = (await this.serde.loadsTyped(
      resCheckpoint.type ?? "json",
      resCheckpoint.metadata ?? "",
    )) as CheckpointMetadata;

    const pendingWrites = await Promise.all(
      (resCheckpoint.writes ?? []).map(async (w) => {
        return [
          w.taskId,
          w.channel,
          await this.serde.loadsTyped(w.type ?? "json", w.value ?? ""),
        ] as [string, string, unknown];
      }),
    );

    if (checkpoint.v < 4 && resCheckpoint.parent_id) {
      await this.migratePendingSends(
        checkpoint,
        resCheckpoint.threadId!,
        resCheckpoint.parent_id,
      );
    }

    return {
      checkpoint: checkpoint,
      config: {
        configurable: {
          thread_id: resCheckpoint.threadId,
          checkpoint_ns: resCheckpoint.namespace,
          checkpoint_id: resCheckpoint.id,
        },
      },
      parentConfig: resCheckpoint.parent_id
        ? {
            configurable: {
              thread_id: resCheckpoint.threadId,
              checkpoint_ns: resCheckpoint.namespace,
              checkpoint_id: resCheckpoint.parent_id,
            },
          }
        : undefined,
      metadata: metadata,
      pendingWrites: pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { limit, before, filter } = options ?? {};

    const threadId: string | undefined = config.configurable?.thread_id;
    const checkpointNamespace: string | undefined =
      config.configurable?.checkpoint_ns;

    let query = SELECT.from(Checkpoints)
      .columns((c) => {
        (c.threadId,
          c.namespace,
          c.id,
          c.parent_id,
          c.type,
          c.checkpoint,
          c.metadata,
          c.writes((w) => {
            (w.taskId, w.channel, w.type, w.value);
          }));
      })
      .orderBy("id desc")
      .where({ graphName: this.graphName });

    if (threadId !== undefined) {
      query = query.where({
        ...query.where,
        threadId: threadId,
      });
    }

    if (checkpointNamespace !== undefined && checkpointNamespace !== null) {
      query = query.where({
        ...query.where,
        namespace: checkpointNamespace,
      });
    }

    if (before?.configurable?.checkpoint_id !== undefined) {
      query = query.where({
        ...query.where,
        id: { "<": before.configurable.checkpoint_id },
      });
    }

    // CAP CDS does not support native JSON operations - so we filter them in memory after fetching the results
    const sanitizedFilter = Object.fromEntries(
      Object.entries(filter ?? {}).filter(([, value]) => value !== undefined),
    );
    const hasFilter = Object.keys(sanitizedFilter).length > 0;

    // apply filter if no limit is specified, otherwise we will filter in memory after fetching the results
    if (limit !== undefined && !hasFilter) {
      query = query.limit(limit);
    }

    const resCheckpoints = await query;
    if (!resCheckpoints) {
      return;
    }

    let yielded = 0;
    // TODO: from minimum CDS 10 SQLite onwards, use `streaming` option
    // with CDS 9, the cursor is not released leading to errors
    for (const checkpointState of resCheckpoints) {
      if (limit !== undefined && yielded >= limit) {
        break;
      }

      const deserializedMetadata = (await this.serde.loadsTyped(
        checkpointState.type ?? "json",
        checkpointState.metadata ?? "",
      )) as CheckpointMetadata & Record<string, unknown>;

      if (hasFilter) {
        // since not filtered in the query, we filter in memory
        const matchesFilter = Object.entries(sanitizedFilter).every(
          ([key, value]) => deserializedMetadata[key] === value,
        );
        if (!matchesFilter) {
          continue;
        }
      }

      const checkpoint = (await this.serde.loadsTyped(
        checkpointState.type ?? "json",
        checkpointState.checkpoint ?? "",
      )) as Checkpoint;

      const pendingWrites = await Promise.all(
        (checkpointState.writes ?? []).map(async (w) => {
          return [
            w.taskId,
            w.channel,
            await this.serde.loadsTyped(w.type ?? "json", w.value ?? ""),
          ] as [string, string, unknown];
        }),
      );

      if (checkpoint.v < 4 && checkpointState.parent_id) {
        await this.migratePendingSends(
          checkpoint,
          checkpointState.threadId!,
          checkpointState.parent_id,
        );
      }

      yield {
        config: {
          configurable: {
            thread_id: checkpointState.threadId,
            checkpoint_ns: checkpointState.namespace,
            checkpoint_id: checkpointState.id,
          },
        },
        checkpoint: checkpoint,
        parentConfig: checkpointState.parent_id
          ? {
              configurable: {
                thread_id: checkpointState.threadId,
                checkpoint_ns: checkpointState.namespace,
                checkpoint_id: checkpointState.parent_id,
              },
            }
          : undefined,
        metadata: deserializedMetadata,
        pendingWrites: pendingWrites,
      };

      yielded++;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    if (!config.configurable) {
      throw new Error(`Empty "config.configurable" supplied`);
    }

    const checkpointNamespace: string = config.configurable.checkpoint_ns ?? "";
    const parentCheckpointId: string | undefined =
      config.configurable.checkpoint_id;
    const threadId: string | undefined = config.configurable.thread_id;
    if (!threadId) {
      throw new Error(
        `Missing "thread_id" field in passed in "config.configurable"`,
      );
    }

    const newChannelValues = Object.fromEntries(
      Object.entries(checkpoint.channel_values).filter(
        ([key]) => key in newVersions,
      ),
    );
    const newChannelVersions = Object.fromEntries(
      Object.entries(checkpoint.channel_versions).filter(
        ([key]) => key in newVersions,
      ),
    );

    const filteredCheckpoint = {
      ...checkpoint,
      channel_values: newChannelValues,
      channel_versions: newChannelVersions,
    };

    const preparedCheckpoint: Partial<Checkpoint> =
      copyCheckpoint(filteredCheckpoint);

    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);
    if (type1 !== type2) {
      throw new Error(
        "Failed to serialized checkpoint and metadata to the same type.",
      );
    }

    const valueDecoder = new TextDecoder("utf-8");
    // run in an independent transaction, so cds outboxed consumption won't rollback the checkpointers
    await cds.tx(() =>
      UPSERT.into(Checkpoints).entries({
        graphName: this.graphName,
        id: checkpoint.id,
        namespace: checkpointNamespace,
        threadId: threadId,
        parent: parentCheckpointId
          ? {
              graphName: this.graphName,
              id: parentCheckpointId,
              namespace: checkpointNamespace,
              threadId: threadId,
            }
          : null,
        type: type1,
        checkpoint: valueDecoder.decode(serializedCheckpoint),
        metadata: valueDecoder.decode(serializedMetadata),
      }),
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    if (!config.configurable) {
      throw new Error(`Empty "config.configurable" supplied`);
    }

    const checkpointNamespace: string = config.configurable.checkpoint_ns ?? "";
    const checkpointId: string | undefined = config.configurable.checkpoint_id;
    if (!checkpointId) {
      throw new Error(
        `Missing "checkpoint_id" field in passed in "config.configurable"`,
      );
    }
    const threadId: string | undefined = config.configurable.thread_id;
    if (!threadId) {
      throw new Error(
        `Missing "thread_id" field in passed in "config.configurable"`,
      );
    }

    const pendingWrites: CheckpointWrite[] = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(write[1]);
        const valueDecoder = new TextDecoder("utf-8");
        return {
          threadId: threadId,
          checkpoint_graphName: this.graphName,
          checkpoint_id: checkpointId,
          checkpoint_namespace: checkpointNamespace,
          checkpoint_threadId: threadId,
          taskId: taskId,
          // Special channels are stored at fixed negative indices so they
          // never collide with regular per-step writes (whose `idx` is the
          // ordinal within `writes`).
          idx: WRITES_IDX_MAP[write[0]] ?? idx,
          channel: write[0],
          type: type,
          value: valueDecoder.decode(serializedValue),
        };
      }),
    );

    // run in an independent transaction, so cds outboxed consumption won't rollback the checkpointers
    await cds.tx(() => UPSERT.into(CheckpointWrites).entries(pendingWrites));
  }

  async deleteThread(threadId: string): Promise<void> {
    // run in an independent transaction, so cds outboxed consumption won't rollback the checkpointers
    await cds.tx(async () => {
      await DELETE.from(CheckpointWrites).where({
        checkpoint_graphName: this.graphName,
        checkpoint_threadId: threadId,
      });
      await DELETE.from(Checkpoints).where({
        graphName: this.graphName,
        threadId: threadId,
      });
    });
  }

  protected async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    parentId: string,
  ) {
    const parentWrites = await SELECT.from(CheckpointWrites)
      .where({
        checkpoint_graphName: this.graphName,
        checkpoint_threadId: threadId,
        checkpoint_id: parentId,
        channel: TASKS,
      })
      .orderBy("taskId", "idx");

    if (parentWrites === undefined || parentWrites.length === 0) {
      return;
    }

    checkpoint.channel_values[TASKS] = await Promise.all(
      parentWrites.map((w) =>
        this.serde.loadsTyped(w.type ?? "json", w.value ?? ""),
      ),
    );
    checkpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }
}
