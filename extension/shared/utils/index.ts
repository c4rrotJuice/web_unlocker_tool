export function noop() {}

export function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

export { sendRuntimeMessage } from "./runtime_message.ts";
