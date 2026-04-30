import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";
import { logError } from "@/lib/logger";

// ─── Route-level error element (used by React Router errorElement prop) ───────

export function RouteErrorElement() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <button
        className="text-sm underline"
        onClick={() => window.location.replace("/")}
      >
        Take Me Back
      </button>
    </div>
  );
}

// ─── Root error boundary (catches catastrophic render errors) ─────────────────

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("AppErrorBoundary caught unhandled error", { message: error.message, componentStack: info.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">A fatal error occurred</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            {this.state.error.message}
          </p>
          <button
            className="text-sm underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
