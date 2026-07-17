const cds = require("@sap/cds");

const LOG = cds.log("cds-langgraph-persistence");

cds.on("loaded", (model) => {
  if (!model.definitions["plugin.langgraph.persistence"]) {
    LOG.warn(
      `Detected '@mi8y/cds-langgraph-persistence' CDS plugin installation, but no entities found in the model. ` +
        `Did you forget to run 'cds add langgraph-persistence' after installing the package?`,
    );
  }
});

if (cds.add) {
  // Register the 'langgraph-persistence' plugin for the 'cds add' command
  cds.add.register(
    "langgraph-persistence",
    class extends cds.add.Plugin {
      static help() {
        return "LangGraph persistence — checkpoint & memory storage";
      }

      async run() {
        const srvRelPath = cds.env.folders?.srv || "srv/";

        const cdsFileRelPath = cds.utils.path.join(
          srvRelPath,
          "langgraph-persistence.cds",
        );
        const cdsFileAbsPath = cds.utils.path.join(cds.root, cdsFileRelPath);

        if (!cds.utils.fs.existsSync(cdsFileAbsPath)) {
          await cds.utils
            .write(`using from '@mi8y/cds-langgraph-persistence';\n`)
            .to(cdsFileAbsPath);
          LOG.info(
            `Added import of LangGraph persistence entities: '${cdsFileRelPath}'`,
          );
        } else {
          LOG.info(
            `CDS file importing LangGraph persistence entities already exists: '${cdsFileRelPath}'`,
          );
        }
      }
    },
  );
}
