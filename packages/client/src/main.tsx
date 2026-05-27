import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { applyPersistedTheme } from "./themes.js";
import "./styles.css";

// Apply the user's last-known theme *before* the first React paint so
// the LoadingScreen (and everything else up to /api/prefs resolving)
// renders in their palette instead of flashing sky-default.
applyPersistedTheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

// Surface uncaught runtime errors that originate outside React's render
// path too (Promise rejections from effects, raw window errors). Without
// this they'd silently land in devtools and the activity would either keep
// running half-broken or blank without explanation.
window.addEventListener("error", (e) => {
  console.error("[holodle] window.error:", e.error ?? e.message, e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[holodle] unhandledrejection:", e.reason);
});

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
