// Builds the installable app into dist/ (no dependencies needed).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const shell = readFileSync("app/shell.html", "utf8");
const page = readFileSync("app/sparks.html", "utf8");
writeFileSync("dist/index.html", shell.replace("<!--SPARKS-->", page));

for (const f of ["config.js", "adapter.js", "manifest.webmanifest"]) cpSync(`app/${f}`, `dist/${f}`);
cpSync("app/icons", "dist/icons", { recursive: true });

const sw = readFileSync("app/sw.js", "utf8").replace("__BUILD__", Date.now().toString(36));
writeFileSync("dist/sw.js", sw);
writeFileSync("dist/.nojekyll", "");

console.log("Built dist/");
