const cds = require("@sap/cds");

const LOG = cds.log("cds-langgraph-persistence");

// Register the 'langgraph-persistence' plugin for the 'cds add' command
cds.add?.register(
  "langgraph-persistence",
  require("./lib/add").AddLangGraphPersistencePlugin,
);

cds.on("loaded", (model) => {
  if (!model.definitions["plugin.langgraph.persistence.Checkpoints"]) {
    LOG.warn(
      `Detected '@mi8y/cds-langgraph-persistence' CDS plugin installation, but no entities found in the model. ` +
        `Did you forget to run 'cds add langgraph-persistence' after installing the package?`,
    );
  }
});
