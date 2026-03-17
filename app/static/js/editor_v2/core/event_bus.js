export function createEventBus() {
  const listeners = new Map();

  return {
    on(eventName, handler) {
      const handlers = listeners.get(eventName) || new Set();
      handlers.add(handler);
      listeners.set(eventName, handlers);
      return () => handlers.delete(handler);
    },
    emit(eventName, payload) {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(payload);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
