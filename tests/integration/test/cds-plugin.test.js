import cds from "@sap/cds";
import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";

const NS = "plugin.langgraph.persistence";

const { expect } = cds.test();

describe("import cds plugin", () => {
  it("should have loaded cds model", async () => {
    const { Checkpoints, CheckpointWrites } = cds.entities(NS);
    expect(Checkpoints).to.exist;
    expect(CheckpointWrites).to.exist;
  });

  it("should create a checkpoint & checkpoint write", async () => {
    const { Checkpoints, CheckpointWrites } = cds.entities(NS);
    const saver = new CdsCheckpointSaver();
    // saver.put()
    // saver.putWrites()

    // saver.getTuple() -> read the checkpoint & pending writes
    // saver.list() -> read the checkpoint & pending writes
    // verify if checkpoint was created -> `expect (await SELECT.from(Checkpoints))...`
    // verify if checkpoint write was created -> `expect (await SELECT.from(CheckpointWrites))...`
  });
});
