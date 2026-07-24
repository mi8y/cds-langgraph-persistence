import cds from "@sap/cds";
import {
  CdsCheckpointSaver,
  purgeExpiredCheckpoints,
} from "@mi8y/cds-langgraph-persistence";

const NS = "plugin.langgraph.persistence";

const { expect } = cds.test();

function makeCheckpoint(id) {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };
}

function makeMetadata(source = "input", step = -1, extra = {}) {
  return { source, step, parents: {}, ...extra };
}

function makeConfig(threadId, checkpointNs = "", checkpointId) {
  return {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

async function cleanup() {
  const { CheckpointWrites, Checkpoints } = cds.entities(NS);
  await DELETE.from(CheckpointWrites);
  await DELETE.from(Checkpoints);
}

describe("CDS Plugin Integration", () => {
  // ── CDS Plugin — Model Loading ──────────────────────────────────────

  describe("CDS Plugin — Model Loading", () => {
    it("should expose Checkpoints entity via cds.entities()", () => {
      const { Checkpoints } = cds.entities(NS);
      expect(Checkpoints).to.exist;
      expect(Checkpoints.name).to.equal(`${NS}.Checkpoints`);
    });

    it("should expose CheckpointWrites entity via cds.entities()", () => {
      const { CheckpointWrites } = cds.entities(NS);
      expect(CheckpointWrites).to.exist;
      expect(CheckpointWrites.name).to.equal(`${NS}.CheckpointWrites`);
    });
  });

  // ── CDS Plugin — Database Deployment ─────────────────────────────────

  describe("CDS Plugin — Database Deployment", () => {
    beforeEach(cleanup);

    it("should have Checkpoints table created and queryable", async () => {
      const { Checkpoints } = cds.entities(NS);
      const rows = await SELECT.from(Checkpoints);
      expect(rows).to.be.an("array").that.is.empty;
    });

    it("should have CheckpointWrites table created and queryable", async () => {
      const { CheckpointWrites } = cds.entities(NS);
      const rows = await SELECT.from(CheckpointWrites);
      expect(rows).to.be.an("array").that.is.empty;
    });
  });

  // ── Cross-API: CheckpointSaver → Raw CQL ────────────────────────────

  describe("Cross-API — CheckpointSaver writes to CDS tables", () => {
    beforeEach(cleanup);

    it("put() should create a row in the Checkpoints table", async () => {
      const { Checkpoints } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const cpId = "cp-cql-1";
      const threadId = "thread-1";

      await saver.put(
        makeConfig(threadId, "", cpId),
        makeCheckpoint(cpId),
        makeMetadata(),
        {},
      );

      const rows = await SELECT.from(Checkpoints);
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].id).to.equal(cpId);
      expect(rows[0].threadId).to.equal(threadId);
      expect(rows[0].namespace).to.equal("");
      expect(rows[0].checkpoint).to.be.a("string");
      expect(rows[0].metadata).to.be.a("string");
    });

    it("putWrites() should create rows in the CheckpointWrites table", async () => {
      const { CheckpointWrites } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const cpId = "cp-cql-2";
      const threadId = "thread-2";
      const config = makeConfig(threadId, "", cpId);

      await saver.put(config, makeCheckpoint(cpId), makeMetadata(), {});

      const writes = [
        ["channel-a", { data: "hello" }],
        ["channel-b", { data: "world" }],
      ];
      await saver.putWrites(config, writes, "task-1");

      const rows = await SELECT.from(CheckpointWrites);
      expect(rows).to.have.lengthOf(2);
      expect(rows.map((r) => r.channel)).to.have.members([
        "channel-a",
        "channel-b",
      ]);
      expect(rows.map((r) => r.taskId)).to.eql(["task-1", "task-1"]);
    });

    it("writes should reference their parent checkpoint via composition", async () => {
      const { Checkpoints } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const cpId = "cp-comp-1";
      const threadId = "thread-comp";
      const config = makeConfig(threadId, "", cpId);

      await saver.put(config, makeCheckpoint(cpId), makeMetadata(), {});
      await saver.putWrites(
        config,
        [
          ["ch-1", "val-1"],
          ["ch-2", "val-2"],
        ],
        "task-comp",
      );

      const result = await SELECT.one
        .from(Checkpoints)
        .columns((c) => {
          c.id;
          c.writes((w) => {
            w.channel;
            w.taskId;
            w.idx;
          });
        })
        .where({ graphName: "test", id: cpId });

      expect(result.writes).to.have.lengthOf(2);
      expect(result.writes.map((w) => w.channel)).to.have.members([
        "ch-1",
        "ch-2",
      ]);
      expect(result.writes[0].taskId).to.equal("task-comp");
    });
  });

  // ── Cross-API: Raw CQL → CheckpointSaver ────────────────────────────

  describe("Cross-API — Raw CQL reads via CheckpointSaver", () => {
    beforeEach(cleanup);

    it("getTuple() should read a checkpoint inserted via raw CQL", async () => {
      const { Checkpoints } = cds.entities(NS);
      const cpId = "cp-raw-1";
      const threadId = "thread-raw";

      const checkpoint = makeCheckpoint(cpId);
      const metadata = makeMetadata("loop", 0, { custom: "raw-test" });

      await INSERT.into(Checkpoints).entries({
        graphName: "test",
        id: cpId,
        namespace: "",
        threadId,
        type: "json",
        checkpoint: JSON.stringify(checkpoint),
        metadata: JSON.stringify(metadata),
      });

      const saver = new CdsCheckpointSaver({ name: "test" });
      const result = await saver.getTuple(makeConfig(threadId));

      expect(result).to.exist;
      expect(result.checkpoint.id).to.equal(cpId);
      expect(result.config.configurable.thread_id).to.equal(threadId);
      expect(result.metadata.source).to.equal("loop");
      expect(result.metadata.step).to.equal(0);
      expect(result.metadata.custom).to.equal("raw-test");
    });

    it("list() should list checkpoints inserted via raw CQL", async () => {
      const { Checkpoints } = cds.entities(NS);
      const threadId = "thread-list-raw";

      for (let i = 1; i <= 3; i++) {
        const cpId = `cp-list-${i}`;
        await INSERT.into(Checkpoints).entries({
          graphName: "test",
          id: cpId,
          namespace: "",
          threadId,
          type: "json",
          checkpoint: JSON.stringify(makeCheckpoint(cpId)),
          metadata: JSON.stringify(makeMetadata("loop", i)),
        });
      }

      const saver = new CdsCheckpointSaver({ name: "test" });
      const results = [];
      for await (const tuple of saver.list(makeConfig(threadId))) {
        results.push(tuple);
      }

      expect(results).to.have.lengthOf(3);
      expect(results.map((r) => r.checkpoint.id)).to.have.members([
        "cp-list-1",
        "cp-list-2",
        "cp-list-3",
      ]);
    });
  });

  // ── Cross-API: deleteThread() cleanup verification ──────────────────

  describe("Cross-API — deleteThread() cleans both tables", () => {
    beforeEach(cleanup);

    it("should remove all Checkpoints and CheckpointWrites for a thread", async () => {
      const { Checkpoints, CheckpointWrites } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const threadId = "thread-del-target";
      const otherThread = "thread-del-other";

      // Arrange: create data in two threads
      for (const [tid, cpId] of [
        [threadId, "cp-del-a"],
        [otherThread, "cp-del-b"],
      ]) {
        await saver.put(
          makeConfig(tid, "", cpId),
          makeCheckpoint(cpId),
          makeMetadata(),
          {},
        );
        await saver.putWrites(
          makeConfig(tid, "", cpId),
          [[`ch-${cpId}`, "val"]],
          `task-${cpId}`,
        );
      }

      // Assert: both threads have data
      expect(await SELECT.from(Checkpoints)).to.have.lengthOf(2);
      expect(await SELECT.from(CheckpointWrites)).to.have.lengthOf(2);

      // Act
      await saver.deleteThread(threadId);

      // Assert: target thread gone, other thread untouched
      const remainingCps = await SELECT.from(Checkpoints);
      const remainingWrites = await SELECT.from(CheckpointWrites);
      expect(remainingCps).to.have.lengthOf(1);
      expect(remainingCps[0].threadId).to.equal(otherThread);
      expect(remainingWrites).to.have.lengthOf(1);
      expect(remainingWrites[0].channel).to.equal("ch-cp-del-b");
    });
  });

  // ── Real Persistence — Data survives across CheckpointSaver instances

  describe("Real Persistence — Data survives across instances", () => {
    beforeEach(cleanup);

    it("should read data created by a different CheckpointSaver instance", async () => {
      const cpId = "cp-persist";
      const threadId = "thread-persist";
      const config = makeConfig(threadId, "", cpId);
      const checkpoint = makeCheckpoint(cpId);
      const metadata = makeMetadata("loop", 0, { custom: "persistence" });

      // Instance A: write data
      let saver = new CdsCheckpointSaver({ name: "test" });
      await saver.put(config, checkpoint, metadata, {});
      await saver.putWrites(config, [["ch-p", { persisted: true }]], "task-p");

      // Release reference — new instance should read from same DB
      saver = new CdsCheckpointSaver({ name: "test" });

      const result = await saver.getTuple(config);
      expect(result).to.exist;
      expect(result.checkpoint.id).to.equal(cpId);
      expect(result.metadata.source).to.equal("loop");
      expect(result.metadata.custom).to.equal("persistence");
      expect(result.pendingWrites).to.have.lengthOf(1);
      expect(result.pendingWrites[0][2]).to.deep.equal({ persisted: true });

      // Cross-verify via raw CQL from the fresh instance's era
      const { Checkpoints } = cds.entities(NS);
      const dbRows = await SELECT.from(Checkpoints).where({
        graphName: "test",
        id: cpId,
      });
      expect(dbRows).to.have.lengthOf(1);
    });

    it("should isolate data between different threads", async () => {
      const saver = new CdsCheckpointSaver({ name: "test" });
      const threadA = "thread-iso-a";
      const threadB = "thread-iso-b";
      const cpA = "cp-iso-a";
      const cpB = "cp-iso-b";

      await saver.put(
        makeConfig(threadA, "", cpA),
        makeCheckpoint(cpA),
        makeMetadata("input", -1, { owner: "A" }),
        {},
      );
      await saver.put(
        makeConfig(threadB, "", cpB),
        makeCheckpoint(cpB),
        makeMetadata("input", -1, { owner: "B" }),
        {},
      );

      // Now create fresh instance and verify isolation
      const saverB = new CdsCheckpointSaver({ name: "test" });

      const resultA = await saverB.getTuple(makeConfig(threadA));
      expect(resultA.checkpoint.id).to.equal(cpA);
      expect(resultA.metadata.owner).to.equal("A");

      const resultB = await saverB.getTuple(makeConfig(threadB));
      expect(resultB.checkpoint.id).to.equal(cpB);
      expect(resultB.metadata.owner).to.equal("B");
    });
  });

  // ── CDS Plugin — Context isolation (namespace) ───────────────────────

  describe("CDS Plugin — Namespace isolation", () => {
    beforeEach(cleanup);

    it("should isolate checkpoints by checkpoint_ns", async () => {
      const saver = new CdsCheckpointSaver({ name: "test" });
      const threadId = "thread-ns";
      const nsA = "ns-alpha";
      const nsB = "ns-beta";

      await saver.put(
        makeConfig(threadId, nsA, "cp-ns-a"),
        makeCheckpoint("cp-ns-a"),
        makeMetadata("input", -1, { ns: "alpha" }),
        {},
      );
      await saver.put(
        makeConfig(threadId, nsB, "cp-ns-b"),
        makeCheckpoint("cp-ns-b"),
        makeMetadata("input", -1, { ns: "beta" }),
        {},
      );

      const resultA = await saver.getTuple(makeConfig(threadId, nsA));
      expect(resultA.metadata.ns).to.equal("alpha");

      const resultB = await saver.getTuple(makeConfig(threadId, nsB));
      expect(resultB.metadata.ns).to.equal("beta");
    });
  });

  // ── CDS Plugin — TTL & Lifecycle Management ─────────────────────────

  describe("CDS Plugin — expiresAt on put()", () => {
    beforeEach(cleanup);

    it("put() should set expiresAt when ttl is configured", async () => {
      const { Checkpoints } = cds.entities(NS);
      const ttl = 60_000;
      const saver = new CdsCheckpointSaver({ name: "test-ttl", ttl });
      const cpId = "cp-ttl-1";
      const threadId = "thread-ttl-1";

      await saver.put(
        makeConfig(threadId, "", cpId),
        makeCheckpoint(cpId),
        makeMetadata(),
        {},
      );

      const rows = await SELECT.from(Checkpoints).where({ id: cpId });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].expiresAt).to.be.a("string");

      const createdAt = new Date(rows[0].createdAt).getTime();
      const expiresAt = new Date(rows[0].expiresAt).getTime();
      expect(expiresAt - createdAt).to.be.closeTo(ttl, 5000);
    });

    it("put() should leave expiresAt null when ttl is not configured", async () => {
      const { Checkpoints } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test-no-ttl" });
      const cpId = "cp-no-ttl-1";
      const threadId = "thread-no-ttl-1";

      await saver.put(
        makeConfig(threadId, "", cpId),
        makeCheckpoint(cpId),
        makeMetadata(),
        {},
      );

      const rows = await SELECT.from(Checkpoints).where({ id: cpId });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].expiresAt).to.be.null;
    });
  });

  describe("CDS Plugin — purgeExpiredCheckpoints()", () => {
    beforeEach(cleanup);

    it("should delete expired threads that have no pending writes", async () => {
      const { Checkpoints } = cds.entities(NS);
      const graphName = "test-purge-delete";
      const threadId = "thread-purge-ok";
      const cpId = "cp-purge-ok";
      const pastDate = new Date(Date.now() - 60_000).toISOString();

      await INSERT.into(Checkpoints).entries({
        graphName,
        id: cpId,
        namespace: "",
        threadId,
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint(cpId)),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: pastDate,
      });

      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);

      const result = await purgeExpiredCheckpoints();

      expect(result.expired).to.equal(1);
      expect(result.skipped).to.equal(0);
      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(0);
    });

    it("should skip expired threads that have pending writes", async () => {
      const { Checkpoints, CheckpointWrites } = cds.entities(NS);
      const graphName = "test-purge-skip";
      const threadId = "thread-purge-skip";
      const cpId = "cp-purge-skip";
      const pastDate = new Date(Date.now() - 60_000).toISOString();

      await INSERT.into(Checkpoints).entries({
        graphName,
        id: cpId,
        namespace: "",
        threadId,
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint(cpId)),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: pastDate,
      });

      await INSERT.into(CheckpointWrites).entries({
        checkpoint_graphName: graphName,
        checkpoint_id: cpId,
        checkpoint_namespace: "",
        checkpoint_threadId: threadId,
        channel: "ch-1",
        type: "json",
        value: JSON.stringify("test-value"),
        taskId: "task-skip",
        idx: 0,
      });

      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);

      const result = await purgeExpiredCheckpoints();

      expect(result.expired).to.equal(0);
      expect(result.skipped).to.equal(1);
      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);
      expect(
        await SELECT.from(CheckpointWrites).where({ checkpoint_id: cpId }),
      ).to.have.lengthOf(1);
    });

    it("should not delete threads whose expiresAt is in the future", async () => {
      const { Checkpoints } = cds.entities(NS);
      const graphName = "test-purge-future";
      const threadId = "thread-purge-future";
      const cpId = "cp-purge-future";
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();

      await INSERT.into(Checkpoints).entries({
        graphName,
        id: cpId,
        namespace: "",
        threadId,
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint(cpId)),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: futureDate,
      });

      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);

      const result = await purgeExpiredCheckpoints();

      expect(result.expired).to.equal(0);
      expect(result.skipped).to.equal(0);
      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);
    });

    it("should not delete threads with null expiresAt", async () => {
      const { Checkpoints } = cds.entities(NS);
      const graphName = "test-purge-null";
      const threadId = "thread-purge-null";
      const cpId = "cp-purge-null-no-ttl";

      await INSERT.into(Checkpoints).entries({
        graphName,
        id: cpId,
        namespace: "",
        threadId,
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint(cpId)),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: null,
      });

      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);

      const result = await purgeExpiredCheckpoints();

      expect(result.expired).to.equal(0);
      expect(result.skipped).to.equal(0);
      expect(
        await SELECT.from(Checkpoints).where({ id: cpId }),
      ).to.have.lengthOf(1);
    });

    it("should return correct expired and skipped counts for mixed scenario", async () => {
      const { Checkpoints, CheckpointWrites } = cds.entities(NS);
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();

      // Thread A: expired, no pending writes — should be deleted
      await INSERT.into(Checkpoints).entries({
        graphName: "test-purge-mixed",
        id: "cp-mixed-a",
        namespace: "",
        threadId: "thread-mixed-a",
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint("cp-mixed-a")),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: pastDate,
      });

      // Thread B: expired, HAS pending writes — should be skipped
      await INSERT.into(Checkpoints).entries({
        graphName: "test-purge-mixed",
        id: "cp-mixed-b",
        namespace: "",
        threadId: "thread-mixed-b",
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint("cp-mixed-b")),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: pastDate,
      });
      await INSERT.into(CheckpointWrites).entries({
        checkpoint_graphName: "test-purge-mixed",
        checkpoint_id: "cp-mixed-b",
        checkpoint_namespace: "",
        checkpoint_threadId: "thread-mixed-b",
        channel: "ch-mixed",
        type: "json",
        value: JSON.stringify("pending"),
        taskId: "task-mixed",
        idx: 0,
      });

      // Thread C: not expired (future) — should not appear in counts
      await INSERT.into(Checkpoints).entries({
        graphName: "test-purge-mixed",
        id: "cp-mixed-c",
        namespace: "",
        threadId: "thread-mixed-c",
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint("cp-mixed-c")),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: futureDate,
      });

      // Thread D: null expiresAt — should not appear in counts
      await INSERT.into(Checkpoints).entries({
        graphName: "test-purge-mixed",
        id: "cp-mixed-d",
        namespace: "",
        threadId: "thread-mixed-d",
        type: "json",
        checkpoint: JSON.stringify(makeCheckpoint("cp-mixed-d")),
        metadata: JSON.stringify(makeMetadata()),
        expiresAt: null,
      });

      const result = await purgeExpiredCheckpoints();

      expect(result.expired).to.equal(1);
      expect(result.skipped).to.equal(1);

      // Thread A deleted
      expect(
        await SELECT.from(Checkpoints).where({ threadId: "thread-mixed-a" }),
      ).to.have.lengthOf(0);

      // Thread B still exists
      expect(
        await SELECT.from(Checkpoints).where({ threadId: "thread-mixed-b" }),
      ).to.have.lengthOf(1);

      // Thread C still exists
      expect(
        await SELECT.from(Checkpoints).where({ threadId: "thread-mixed-c" }),
      ).to.have.lengthOf(1);

      // Thread D still exists
      expect(
        await SELECT.from(Checkpoints).where({ threadId: "thread-mixed-d" }),
      ).to.have.lengthOf(1);
    });

    it("should handle empty database gracefully", async () => {
      const result = await purgeExpiredCheckpoints();
      expect(result.expired).to.equal(0);
      expect(result.skipped).to.equal(0);
    });
  });

  // ── CDS Plugin — Transaction Isolation ───────────────────────────────

  describe("CDS Plugin — Transaction Isolation", () => {
    beforeEach(cleanup);

    it("put() should persist checkpoint when outer transaction rolls back", async () => {
      const { Checkpoints } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const cpId = "cp-tx-iso-1";
      const threadId = "thread-tx-iso";

      // plugin disable manual transactions if kind is `sqlite` hence force default kind
      cds.requires.db.kind = "sql";

      try {
        await cds.tx(async () => {
          await saver.put(
            makeConfig(threadId, "", cpId),
            makeCheckpoint(cpId),
            makeMetadata(),
            {},
          );
          throw new Error("Simulated outbox rollback");
        });
      } catch (e) {
        expect(e.message).to.equal("Simulated outbox rollback");
      }

      const rows = await SELECT.from(Checkpoints).where({ id: cpId });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0].id).to.equal(cpId);
      expect(rows[0].threadId).to.equal(threadId);
      expect(rows[0].graphName).to.equal("test");
    });

    it("putWrites() should persist writes when outer transaction rolls back", async () => {
      const { CheckpointWrites } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const cpId = "cp-tx-iso-2";
      const threadId = "thread-tx-iso-2";
      const config = makeConfig(threadId, "", cpId);

      // plugin disable manual transactions if kind is `sqlite` hence force default kind
      cds.requires.db.kind = "sql";

      await saver.put(config, makeCheckpoint(cpId), makeMetadata(), {});

      const writes = [
        ["channel-a", { data: "hello-tx" }],
        ["channel-b", { data: "world-tx" }],
      ];

      try {
        await cds.tx(async () => {
          await saver.putWrites(config, writes, "task-tx-iso");
          throw new Error("Simulated outbox rollback");
        });
      } catch (e) {
        expect(e.message).to.equal("Simulated outbox rollback");
      }

      const rows = await SELECT.from(CheckpointWrites).where({
        checkpoint_id: cpId,
      });
      expect(rows).to.have.lengthOf(2);
      expect(rows.map((r) => r.taskId)).to.eql(["task-tx-iso", "task-tx-iso"]);
      expect(rows.map((r) => r.channel)).to.have.members([
        "channel-a",
        "channel-b",
      ]);
    });

    it("deleteThread() should take effect even when outer transaction rolls back", async () => {
      const { Checkpoints, CheckpointWrites } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const threadA = "thread-tx-del-a";
      const threadB = "thread-tx-del-b";

      // plugin disable manual transactions if kind is `sqlite` hence force default kind
      cds.requires.db.kind = "sql";

      for (const [tid, cpId] of [
        [threadA, "cp-tx-del-a"],
        [threadB, "cp-tx-del-b"],
      ]) {
        await saver.put(
          makeConfig(tid, "", cpId),
          makeCheckpoint(cpId),
          makeMetadata(),
          {},
        );
        await saver.putWrites(
          makeConfig(tid, "", cpId),
          [[`ch-${cpId}`, "val"]],
          `task-${cpId}`,
        );
      }

      try {
        await cds.tx(async () => {
          await saver.deleteThread(threadA);
          throw new Error("Simulated outbox rollback");
        });
      } catch (e) {
        expect(e.message).to.equal("Simulated outbox rollback");
      }

      const remainingCps = await SELECT.from(Checkpoints);
      const remainingWrites = await SELECT.from(CheckpointWrites);
      expect(remainingCps).to.have.lengthOf(1);
      expect(remainingCps[0].threadId).to.equal(threadB);
      expect(remainingWrites).to.have.lengthOf(1);
    });

    it("chained checkpoints should survive outer transaction rollback", async () => {
      const { Checkpoints } = cds.entities(NS);
      const saver = new CdsCheckpointSaver({ name: "test" });
      const threadId = "thread-tx-chain";

      // plugin disable manual transactions if kind is `sqlite` hence force default kind
      cds.requires.db.kind = "sql";

      try {
        await cds.tx(async () => {
          await saver.put(
            makeConfig(threadId),
            makeCheckpoint("cp-chain-1"),
            makeMetadata("loop", 1),
            {},
          );
          await saver.put(
            makeConfig(threadId, "", "cp-chain-1"),
            makeCheckpoint("cp-chain-2"),
            makeMetadata("loop", 2),
            {},
          );
          throw new Error("Simulated outbox rollback");
        });
      } catch (e) {
        expect(e.message).to.equal("Simulated outbox rollback");
      }

      const rows = await SELECT.from(Checkpoints)
        .where({ threadId })
        .orderBy("id");
      expect(rows).to.have.lengthOf(2);
      expect(rows[0].id).to.equal("cp-chain-1");
      expect(rows[0].parent_id).to.be.null;
      expect(rows[1].id).to.equal("cp-chain-2");
      expect(rows[1].parent_id).to.equal("cp-chain-1");
    });
  });
});
