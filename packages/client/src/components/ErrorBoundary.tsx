import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

// Last-resort error boundary. When something throws during render or in a
// downstream effect that surfaces as a render error (e.g. Zustand selector
// returning undefined and code dereferencing it), React would normally
// unmount the entire tree, leaving the iframe blank. This boundary renders
// a visible card with the message + component stack so the cause is
// inspectable without devtools.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Always log to the console so devtools shows the full stack.
    // The UI version is truncated for readability.
    console.error("[holodle] uncaught error in React tree:", error, info);
    this.setState({ info });
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-full max-w-3xl flex-col p-6">
          <header className="pb-4">
            <h1 className="text-3xl font-extrabold tracking-tight">
              <span className="text-holo-accent">HOLO</span>
              <span className="text-holo-ink">DLE</span>
            </h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-holo-muted">
              Something crashed
            </p>
          </header>
          <div className="rounded-2xl border-2 border-holo-badBd bg-holo-badBg/60 p-4">
            <p className="font-semibold text-holo-bad">
              {this.state.error.name}: {this.state.error.message}
            </p>
            {this.state.info?.componentStack && (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/80 p-3 text-xs text-holo-muted">
                {this.state.info.componentStack.trim()}
              </pre>
            )}
            <p className="mt-3 text-xs text-holo-muted">
              The full stack is in devtools (Ctrl+Shift+I inside the activity).
              Refresh the iframe to try again.
            </p>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
