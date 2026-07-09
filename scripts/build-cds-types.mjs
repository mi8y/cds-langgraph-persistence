import path from "path";
import shell from "shelljs";

const ROOT = path.resolve(
  path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
);
const OUT_DIR = path.join(ROOT, "@cds-models");
const TMP_CJS = path.join(ROOT, "tmp/cds-cjs");
const TMP_ESM = path.join(ROOT, "tmp/cds-esm");
const CDS_FILE = "index.cds";

shell.rm("-rf", OUT_DIR, TMP_CJS, TMP_ESM);

// Generate CJS
shell.cd(ROOT);
let result = shell.exec(
  `npx cds-typer --targetModuleType cjs --outputDirectory ${TMP_CJS} ${CDS_FILE}`,
);
if (result.code !== 0) {
  shell.echo("Error: CJS cds-typer failed");
  shell.exit(1);
}

// Generate ESM
result = shell.exec(
  `npx cds-typer --targetModuleType esm --outputDirectory ${TMP_ESM} ${CDS_FILE}`,
);
if (result.code !== 0) {
  shell.echo("Error: ESM cds-typer failed");
  shell.exit(1);
}

// Copy CJS .js + .d.ts
shell.mkdir("-p", OUT_DIR);
shell.ls(TMP_CJS).forEach((entry) => {
  shell.cp("-R", path.join(TMP_CJS, entry), path.join(OUT_DIR, entry));
});

// Copy ESM .js as .mjs (with corrected import paths)
const jsFiles = shell.find(TMP_ESM).filter((f) => /\.js$/.test(f));
for (const file of jsFiles) {
  const relPath = path.relative(TMP_ESM, file);
  const mjsPath = path.join(OUT_DIR, relPath.replace(/\.js$/, ".mjs"));
  let content = shell.cat(file);
  content = content.replace(/from\s+['"](.+?)\.js['"]/g, 'from "$1.mjs"');
  shell.mkdir("-p", path.dirname(mjsPath));
  shell.ShellString(content).to(mjsPath);
}

shell.rm("-rf", TMP_CJS, TMP_ESM);

shell.echo("@cds-models/ generated with CJS (.js) + ESM (.mjs)");
