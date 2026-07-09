const cds = require("@sap/cds");

// add this plugin's root to cds.env.roots
// cds find the `index.cds` file to be loaded into CDS model and available for any DB or tenancy approach
const root = __dirname;
if (!cds.env.roots.includes(root)) cds.env.roots.push(root);
