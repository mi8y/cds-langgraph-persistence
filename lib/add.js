const cds = require("@sap/cds");

const LOG = cds.log("cds-langgraph-persistence");

class AddLangGraphPersistencePlugin extends cds.add.Plugin {
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
}
module.exports = { AddLangGraphPersistencePlugin };
