import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const extensionRoot = path.resolve("extension");

function read(file) {
  return fs.readFileSync(path.join(extensionRoot, file), "utf8");
}

test("phase 0 extension skeleton keeps manifest MV3 and uses only justified permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background/index.js");
  assert.deepEqual(manifest.permissions, ["storage", "sidePanel", "tabs"]);
  assert.equal(manifest.side_panel.default_path, "sidepanel/index.html");
  assert.equal(manifest.action.default_popup, "popup/index.html");
});

test("phase 0 skeleton centralizes message names, endpoints, and storage keys", () => {
  const messageNames = read("shared/constants/message_names.ts");
  const endpoints = read("shared/constants/endpoints.ts");
  const storageKeys = read("shared/constants/storage_keys.ts");
  assert.match(messageNames, /MESSAGE_NAMES/);
  assert.match(endpoints, /BOOTSTRAP/);
  assert.match(storageKeys, /AUTH_SESSION/);
});

test("phase 0 UI shells do not call fetch directly", () => {
  const files = [
    "popup/main.ts",
    "popup/app/index.ts",
    "popup/views/index.ts",
    "popup/messaging/index.ts",
    "popup/styles/index.ts",
    "sidepanel/main.ts",
    "sidepanel/app/index.ts",
    "sidepanel/views/index.ts",
    "sidepanel/components/index.ts",
    "sidepanel/messaging/index.ts",
    "sidepanel/styles/index.ts",
    "content/index.ts",
    "content/dom/index.ts",
    "content/ui/index.ts",
    "content/messaging/index.ts",
    "content/serializers/index.ts",
    "content/utils/index.ts",
  ];
  for (const file of files) {
    assert.equal(read(file).includes("fetch("), false, `${file} must not call fetch directly`);
  }
});

test("phase 0 router exposes a typed dispatch shape and no legacy auth bridge wiring", () => {
  const router = read("background/router.ts");
  const background = read("background/index.ts");
  assert.match(router, /createBackgroundRouter/);
  assert.match(router, /MESSAGE_NAMES/);
  assert.match(background, /createBackgroundRuntime/);
  assert.equal(background.includes("auth_handoff"), false);
});
