(function attachEditorRuntimeInstrumentation(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before instrumentation");
  }

  function createInstrumentation() {
    const debugApi = global.__editorRuntimeDebug || {};
    const counters = debugApi.counters || {};
    const phases = debugApi.phases || {};
    const marks = debugApi.marks || [];
    const events = debugApi.events || [];
    const enabled = function isEnabled() {
      return global.localStorage?.getItem("editor_debug") === "1";
    };

    function pushEvent(kind, payload) {
      const event = { kind, at: Date.now(), payload: payload || {} };
      events.push(event);
      if (events.length > 400) events.shift();
      return event;
    }

    function increment(counter, amount) {
      counters[counter] = (counters[counter] || 0) + (amount == null ? 1 : amount);
      return counters[counter];
    }

    function mark(name, payload) {
      const entry = { name, at: performance.now(), payload: payload || {} };
      marks.push(entry);
      if (marks.length > 400) marks.shift();
      if (enabled()) {
        console.debug(`[editor] mark:${name}`, payload || {});
      }
      return entry;
    }

    function startPhase(name, payload) {
      phases[name] = {
        started_at: performance.now(),
        completed_at: null,
        duration_ms: null,
        payload: payload || {},
      };
      increment(`phase:${name}:start`);
      pushEvent(`phase:${name}:start`, payload);
    }

    function endPhase(name, payload) {
      const phase = phases[name] || { started_at: performance.now(), payload: {} };
      phase.completed_at = performance.now();
      phase.duration_ms = phase.completed_at - phase.started_at;
      phase.payload = { ...(phase.payload || {}), ...(payload || {}) };
      phases[name] = phase;
      increment(`phase:${name}:end`);
      pushEvent(`phase:${name}:end`, phase.payload);
      if (enabled()) {
        console.debug(`[editor] phase:${name}`, phase);
      }
      return phase;
    }

    function time(label, runner) {
      const startedAt = performance.now();
      increment(`time:${label}:count`);
      return Promise.resolve()
        .then(runner)
        .finally(() => {
          const duration = performance.now() - startedAt;
          counters[`time:${label}:total_ms`] = (counters[`time:${label}:total_ms`] || 0) + duration;
          counters[`time:${label}:last_ms`] = duration;
          pushEvent(`time:${label}`, { duration_ms: duration });
        });
    }

    function snapshot() {
      return {
        enabled: enabled(),
        counters: { ...counters },
        phases: JSON.parse(JSON.stringify(phases)),
        marks: marks.slice(),
        events: events.slice(),
      };
    }

    function reset() {
      Object.keys(counters).forEach((key) => delete counters[key]);
      Object.keys(phases).forEach((key) => delete phases[key]);
      marks.length = 0;
      events.length = 0;
    }

    const api = {
      enabled,
      counters,
      phases,
      marks,
      events,
      increment,
      mark,
      startPhase,
      endPhase,
      time,
      snapshot,
      reset,
      event: pushEvent,
    };

    global.__editorRuntimeDebug = api;
    return api;
  }

  runtime.register("instrumentation", createInstrumentation);
})(window);
