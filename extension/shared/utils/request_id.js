// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
let sequence = 0;
export function createRequestId(prefix = "runtime") {
    sequence += 1;
    return `${prefix}-${Date.now()}-${sequence}`;
}
