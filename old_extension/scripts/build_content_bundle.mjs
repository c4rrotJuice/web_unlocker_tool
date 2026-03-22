import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
      continue;
    }
    if (entry.isFile() && absolute.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

function rewriteModuleSpecifiers(sourceText) {
  return sourceText
    .replace(/(from\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3")
    .replace(/(import\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3")
    .replace(/(export\s+\*\s+from\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3");
}

async function main() {
  const files = await walk(extensionDir);
  for (const sourcePath of files) {
    const targetPath = sourcePath.replace(/\.ts$/, ".js");
    const sourceText = await fs.readFile(sourcePath, "utf8");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, rewriteModuleSpecifiers(sourceText));
  }
  process.stdout.write(`Built ${files.length} extension module files.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
