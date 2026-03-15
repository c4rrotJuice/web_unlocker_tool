(function attachEditorRuntimeCore(global) {
  const runtime = global.WritiorEditorRuntime || (global.WritiorEditorRuntime = {});

  runtime.register = function registerRuntimeModule(name, value) {
    if (!name) throw new Error("Runtime module name is required");
    runtime[name] = value;
    return value;
  };

  runtime.require = function requireRuntimeModule(name) {
    const value = runtime[name];
    if (!value) {
      throw new Error(`[editor] Required runtime module missing: ${name}`);
    }
    return value;
  };
})(window);
