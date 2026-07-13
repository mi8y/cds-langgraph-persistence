import {
  Checkpoints,
  CheckpointWrites,
} from "#cds-models/plugin/langgraph/persistence";
import { CdsCheckpointSaver } from "@/index";
import {
  CheckpointSaverTestInitializer,
  validate,
} from "@langchain/langgraph-checkpoint-validation";
import cds from "@sap/cds";

export const cdsCheckpointSaverTestInitializer: CheckpointSaverTestInitializer<CdsCheckpointSaver> =
  {
    checkpointerName: "@langchain/langgraph-checkpoint-cds",

    async beforeAll() {
      const csn = await cds.load("index.cds").then(cds.minify);
      cds.model = cds.compile.for.nodejs(csn);

      cds.requires.db = {
        kind: "sqlite",
        impl: "@cap-js/sqlite",
        credentials: { url: ":memory:" },
      };

      cds.db = await cds.connect.to("db");

      // @ts-ignore
      await cds.deploy("index.cds", {}).to(cds.db);
    },

    async afterAll() {
      // @ts-ignore
      await cds.db.disconnect?.();
    },

    async createCheckpointer() {
      return new CdsCheckpointSaver({ id: "test" });
    },

    async destroyCheckpointer() {
      await DELETE.from(CheckpointWrites);
      await DELETE.from(Checkpoints);
    },
  };

validate(cdsCheckpointSaverTestInitializer);
