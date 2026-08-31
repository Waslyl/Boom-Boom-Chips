import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A rendering bug should cost a player their screen, not their evening. The
 * match itself lives on the server, so reloading drops them back into it with
 * their seat and their bombs intact.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[bbc] render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="screen-shell items-center justify-center text-center">
        <div className="glass max-w-sm rounded-[var(--radius-xl)] p-6">
          <h1 className="text-2xl">Something broke</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-dim)]">
            Your game is still on the server. Reload and you will drop back into it.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-5 w-full"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <pre className="mt-4 max-h-32 overflow-auto text-left text-[0.65rem] text-[var(--color-ink-faint)]">
            {error.message}
          </pre>
        </div>
      </div>
    );
  }
}
