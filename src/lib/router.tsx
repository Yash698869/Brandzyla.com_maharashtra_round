import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

interface RouterContextValue {
  path: string;
  search: string;
  query: Record<string, string>;
  navigate: (to: string, replace?: boolean) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function parseQuery(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!search) return params;
  const clean = search.startsWith('?') ? search.slice(1) : search;
  for (const part of clean.split('&')) {
    if (!part) continue;
    const [key, val] = part.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
  }
  return params;
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  const [search, setSearch] = useState(() => window.location.search || '');

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname || '/');
      setSearch(window.location.search || '');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    const url = new URL(to, window.location.origin);
    const newPath = url.pathname || '/';
    const newSearch = url.search || '';

    if (replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }

    setPath(newPath);
    setSearch(newSearch);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const query = useMemo(() => parseQuery(search), [search]);

  const value = useMemo(
    () => ({
      path,
      search,
      query,
      navigate,
    }),
    [path, search, query, navigate]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return ctx;
}

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  className?: string;
  children: React.ReactNode;
  replace?: boolean;
}

export function Link({ href, className, children, replace, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (
      e.button === 0 &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      (!rest.target || rest.target === '_self')
    ) {
      e.preventDefault();
      navigate(href, replace);
    }
  }

  return (
    <a href={href} className={className} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
