import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let msg = error?.message || 'Unexpected error occurred.';
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error) {
        msg = `Database access error (${parsed.operationType || 'read'}): ${parsed.error}`;
      }
    } catch {
      // plain string
    }
    return { hasError: true, message: msg };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Study Cloud ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-4">
          <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-[var(--card-bg)] p-6 text-center space-y-4 shadow-xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="font-['Sora'] text-lg font-extrabold">Something went wrong</h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
            >
              <RotateCw className="h-4 w-4" />
              <span>Reload Study Cloud</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
