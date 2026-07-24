import { CdsCheckpointSaver } from "./cds-checkpointer";
import { Checkpoints } from "#cds-models/plugin/langgraph/persistence";
import cds from "@sap/cds";

const LOG = cds.log("cds-langgraph-persistence");

export type PurgedThreadInfo = {
  expired: number;
  skipped: number;
};

/**
 * Sweeps expired checkpoints across all graphs in the current tenant context.
 *
 * Checkpoints are ordered by `createdAt DESC` within each `(graphName, threadId)`,
 * so the first row seen for each group is the latest. If that checkpoint's
 * `expiresAt` is in the past AND the thread has no pending writes
 * (i.e. it is not interrupted / in-progress), the entire thread is deleted.
 *
 * @returns {Promise<PurgedThreadInfo>} The number of deleted expired threads and skipped threads (due to interrupted / in-progress state).
 */
async function purgeExpiredCheckpoints(): Promise<PurgedThreadInfo> {
  const now = new Date();
  const tenant = cds.context?.tenant || "default";

  // checkpointer cache for each graph name
  const checkpointerCache = new Map<string, CdsCheckpointSaver>();
  function getCheckpointer(graphName: string): CdsCheckpointSaver {
    let checkpointer = checkpointerCache.get(graphName);
    if (!checkpointer) {
      checkpointer = new CdsCheckpointSaver({ name: graphName });
      checkpointerCache.set(graphName, checkpointer);
    }
    return checkpointer;
  }

  // first find all the threads which are expired
  const expiredThreads = await SELECT.from(Checkpoints)
    .columns("graphName", "threadId", "expiresAt")
    .groupBy("graphName", "threadId")
    .where({ expiresAt: { "!=": null }, and: { expiresAt: { "<": now } } })
    .orderBy("createdAt desc");

  if (!expiredThreads || expiredThreads.length === 0) {
    return { expired: 0, skipped: 0 };
  }

  // then for each of the expired thread, check if it is in interrupted / in-progress state (i.e. has pending writes)
  let expiredThreadCount = 0;
  for (const c of expiredThreads) {
    const checkpointer = getCheckpointer(c.graphName!);

    const tuple = await checkpointer.getTuple({
      configurable: {
        thread_id: c.threadId,
      },
    });
    if (!tuple) continue;

    // if a thread in interrupted/in-progress state, it will have pending writes with info
    if (tuple.pendingWrites && tuple.pendingWrites.length === 0) {
      await checkpointer.deleteThread(c.threadId!);
      expiredThreadCount++;

      LOG.debug(
        `Deleted expired thread '${c.threadId}' for graph '${c.graphName}'`,
      );
    } else {
      LOG.debug(
        `Thread ${c.threadId} in graph ${c.graphName} has pending writes i.e. it's in interrupted state or in-progress, skipping...`,
      );
    }
  }

  LOG.debug(
    `Purged checkpoints for tenant - '${tenant}' - ` +
      `${expiredThreadCount} expired threads deleted, ${expiredThreads.length - expiredThreadCount} threads skipped due to interrupted or in-progress state`,
  );
  return {
    expired: expiredThreadCount,
    skipped: expiredThreads.length - expiredThreadCount,
  };
}

export { purgeExpiredCheckpoints };
