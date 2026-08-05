/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Route, RoutePath } from '../types';

interface RouterContextType {
  currentRoute: Route;
  navigate: (path: RoutePath, params?: Record<string, string>) => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

// Helper to parse current URL path into Route & parameters
function parseLocation(): Route {
  const path = window.location.pathname;
  
  // Match /practice/:sessionId
  if (path.startsWith('/practice/')) {
    const sessionId = path.replace('/practice/', '');
    if (sessionId && sessionId !== 'setup') {
      return { path: '/practice', params: { sessionId } };
    }
  }

  // Match /results/:sessionId
  if (path.startsWith('/results/')) {
    const sessionId = path.replace('/results/', '');
    if (sessionId) {
      return { path: '/results', params: { sessionId } };
    }
  }

  // Default direct matching
  const validPaths: RoutePath[] = [
    '/',
    '/login',
    '/onboarding',
    '/dashboard',
    '/practice/setup',
    '/history',
    '/settings',
  ];

  if (validPaths.includes(path as RoutePath)) {
    return { path: path as RoutePath };
  }

  // Fallback / Not Found route
  return { path: '/' };
}

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<Route>({ path: '/' });

  // Handle URL updates
  const updateRoute = () => {
    setCurrentRoute(parseLocation());
  };

  useEffect(() => {
    // Initial parse
    updateRoute();

    // Listen to browser forward/backward buttons
    window.addEventListener('popstate', updateRoute);
    return () => {
      window.removeEventListener('popstate', updateRoute);
    };
  }, []);

  const navigate = (path: RoutePath, params?: Record<string, string>) => {
    let urlPath: string = path;
    if (path === '/practice' && params?.sessionId) {
      urlPath = `/practice/${params.sessionId}`;
    } else if (path === '/results' && params?.sessionId) {
      urlPath = `/results/${params.sessionId}`;
    }

    // Push state and trigger state re-render
    window.history.pushState(null, '', urlPath);
    setCurrentRoute({ path, params });
  };

  return (
    <RouterContext.Provider value={{ currentRoute, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = () => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
};
