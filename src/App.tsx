/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RouterProvider } from './services/routerContext';
import { AuthProvider } from './services/authContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NavigationShell } from './components/NavigationShell';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider>
          <NavigationShell />
        </RouterProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
