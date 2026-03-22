import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const staticExtensions = new Set([".html", ".json", ".svg"]);
const generatedFiles = [];
const GENERATED_HEADER = "// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.\n";
const IMPORT_RE = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"'`]+)["']/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
      continue;
    }
    files.push(absolute);
  }
  return files;
}

function rewriteModuleSpecifiers(sourceText) {
  return sourceText
    .replace(/(from\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3")
    .replace(/(import\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3")
    .replace(/(export\s+\*\s+from\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3")
    .replace(/(export\s+\{[^}]+\}\s+from\s+['"])([^'"]+)\.ts(['"])/g, "$1$2.js$3");
}

function normalizeExtensionPath(filePath) {
  return path.relative(extensionDir, filePath).replace(/\\/g, "/");
}

function resolveModuleSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const absolute = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    absolute,
    `${absolute}.ts`,
    `${absolute}.js`,
    path.join(absolute, "index.ts"),
    path.join(absolute, "index.js"),
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith(extensionDir)) {
      return candidate;
    }
  }
  return null;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectBundleModules(entryFile, seen = new Set(), ordered = []) {
  const normalizedEntry = path.resolve(entryFile);
  if (seen.has(normalizedEntry)) {
    return ordered;
  }
  seen.add(normalizedEntry);
  const sourceText = await fs.readFile(normalizedEntry, "utf8");
  const imports = [];
  let match = IMPORT_RE.exec(sourceText);
  while (match) {
    imports.push(match[1]);
    match = IMPORT_RE.exec(sourceText);
  }
  IMPORT_RE.lastIndex = 0;

  for (const specifier of imports) {
    const resolved = resolveModuleSpecifier(normalizedEntry, specifier);
    if (!resolved) {
      continue;
    }
    if (!(await fileExists(resolved))) {
      continue;
    }
    if (!resolved.endsWith(".ts") && !resolved.endsWith(".js")) {
      continue;
    }
    await collectBundleModules(resolved, seen, ordered);
  }

  ordered.push(normalizedEntry);
  return ordered;
}

function buildClassicContentBundle({ entryId, modules }) {
  const registryItems = modules.map(({ id, code }) => {
    return `${JSON.stringify(id)}: function(module, exports, require) {\n${code}\n}`;
  }).join(",\n");

  return `(function() {
  const modules = {
${registryItems}
  };
  const cache = {};

  function dirname(id) {
    const slash = id.lastIndexOf("/");
    return slash === -1 ? "" : id.slice(0, slash);
  }

  function normalize(parts) {
    const output = [];
    for (const part of parts) {
      if (!part || part === ".") {
        continue;
      }
      if (part === "..") {
        output.pop();
        continue;
      }
      output.push(part);
    }
    return output.join("/");
  }

  function resolve(fromId, specifier) {
    if (!specifier.startsWith(".")) {
      return specifier;
    }
    const baseDir = dirname(fromId);
    const raw = normalize((baseDir ? baseDir.split("/") : []).concat(specifier.split("/")));
    const candidates = [raw, raw + ".ts", raw + ".js", raw + "/index.ts", raw + "/index.js"];
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(modules, candidate)) {
        return candidate;
      }
    }
    throw new Error("Unresolved content bundle import: " + specifier + " from " + fromId);
  }

  function executeModule(id) {
    if (cache[id]) {
      return cache[id].exports;
    }
    if (!Object.prototype.hasOwnProperty.call(modules, id)) {
      throw new Error("Unknown content bundle module: " + id);
    }
    const module = { exports: {} };
    cache[id] = module;
    modules[id](module, module.exports, function(specifier) {
      return executeModule(resolve(id, specifier));
    });
    return module.exports;
  }

  executeModule(${JSON.stringify(entryId)});
})();\n`;
}

async function buildClassicContentScript() {
  const entryFile = path.join(extensionDir, "content", "index.ts");
  const orderedFiles = await collectBundleModules(entryFile);
  const modules = [];

  for (const file of orderedFiles) {
    if (!file.endsWith(".ts")) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    });
    modules.push({
      id: normalizeExtensionPath(file),
      code: transpiled.outputText,
    });
  }

  const bundleTarget = path.join(extensionDir, "content", "bundle.js");
  const bundleSource = buildClassicContentBundle({
    entryId: normalizeExtensionPath(entryFile),
    modules,
  });
  await fs.writeFile(bundleTarget, `${GENERATED_HEADER}${bundleSource}`, "utf8");
  generatedFiles.push(path.relative(extensionDir, bundleTarget));
}

async function removeStaleBuildArtifacts(files) {
  const removableJs = files.filter((file) => file.endsWith(".js") && !file.endsWith(".mjs"));

  await Promise.all(removableJs.map((file) => fs.rm(file, { force: true })));
}

async function build() {
  const files = await walk(extensionDir);
  await removeStaleBuildArtifacts(files);

  for (const file of files) {
    const extension = path.extname(file);
    if (extension === ".ts") {
      const source = await fs.readFile(file, "utf8");
      const target = file.replace(/\.ts$/, ".js");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      await fs.writeFile(target, `${GENERATED_HEADER}${rewriteModuleSpecifiers(transpiled.outputText)}`, "utf8");
      generatedFiles.push(path.relative(extensionDir, target));
      continue;
    }

    if (staticExtensions.has(extension)) {
      generatedFiles.push(path.relative(extensionDir, file));
    }
  }

  await buildClassicContentScript();

  process.stdout.write(`Built extension runtime artifacts for ${generatedFiles.length} files.\n`);
}

build().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
