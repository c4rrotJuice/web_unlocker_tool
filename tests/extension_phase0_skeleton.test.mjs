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
  assert.match(messageNames, /PING/);
  assert.match(messageNames, /WORK_IN_EDITOR_REQUEST/);
  assert.match(endpoints, /BOOTSTRAP/);
  assert.match(storageKeys, /AUTH_SESSION/);
});

test("phase 0 UI shells do not call fetch directly", () => {
  const files = [
    "popup/main.ts",
    "sidepanel/main.ts",
    "content/index.ts",
    "shared/utils/runtime_message.ts",
  ];
  for (const file of files) {
    assert.equal(read(file).includes("fetch("), false, `${file} must not call fetch directly`);
  }
});

test("phase 0 router exposes the canonical dispatch path and no legacy auth bridge wiring", () => {
  const router = read("background/messaging/router.ts");
  const background = read("background/index.ts");
  assert.match(router, /createBackgroundRouter/);
  assert.match(router, /MESSAGE_NAMES/);
  assert.match(router, /createRouteTable/);
  assert.match(background, /createBackgroundRuntime/);
  assert.equal(background.includes("auth_handoff"), false);
});

test("phase 0 manifest points at buildable artifacts", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(fs.existsSync(path.join(extensionRoot, "background/index.ts")), true);
  assert.equal(fs.existsSync(path.join(extensionRoot, "content/index.ts")), true);
  assert.equal(fs.existsSync(path.join(extensionRoot, manifest.action.default_popup)), true);
  assert.equal(fs.existsSync(path.join(extensionRoot, manifest.side_panel.default_path)), true);
});
