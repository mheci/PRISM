// PRISM boot: invoked last after all modules register. Kicks the runtime.
(() => {
  "use strict";
  const Prism = window.__PRISM__;
  if (!Prism) {
    console.error("[PRISM] runtime not found");
    return;
  }
  const run = () => Prism.boot().catch((err) => Prism.log("error", "boot", String(err && err.message || err)));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
