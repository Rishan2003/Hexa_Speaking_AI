/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error inside HEXA'S Speaking AI:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div id="error-boundary-screen" className="min-h-screen flex items-center justify-center bg-gray-50 p-6 font-sans">
          <div className="max-w-md w-full bg-white rounded-2xl border border-gray-100 shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-500 mb-6 text-sm">
              HEXA'S Speaking AI encountered an unexpected rendering error. No worries, your practice transcripts are saved locally.
            </p>
            <div className="bg-gray-50 rounded-lg p-4 text-left font-mono text-xs text-gray-600 overflow-x-auto mb-6 max-h-32">
              {this.state.error?.toString() || 'Unknown error'}
            </div>
            <button
              id="reset-app-button"
              onClick={this.handleReset}
              className="w-full flex items-center justify-center gap-2 bg-[var(--hexa-navy)] hover:bg-[var(--hexa-navy-deep)] text-white font-medium py-3 px-4 rounded-xl transition duration-150"
            >
              <RotateCcw size={16} />
              Return to Safety
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;
