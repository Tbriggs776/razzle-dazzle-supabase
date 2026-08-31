import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabaseClient';

/**
 * Session-based auth, backed by Supabase Auth + the modular access model.
 *
 * Exposes the same fields the app already consumed (user, isAuthenticated,
 * isLoadingAuth, isLoadingPublicSettings, authError, appPublicSettings, logout,
 * navigateToLogin, checkAppState) plus `access`, `can()` and `login()` for the
 * data-driven nav and route guards.
 */
const AuthContext = createContext();

const LEVEL = { none: 0, view: 1, edit: 2, admin: 3 };

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null); // { user, modules: [{key,permission,pages,...}] }
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const loadUser = useCallback(async () => {
    try {
      const [me, acc] = await Promise.all([base44.auth.me(), base44.auth.getAccess()]);
      setUser(me);
      setAccess(acc);
      setIsAuthenticated(true);
      // my_access() returns user: null for a login the access model does not
      // recognise as ACTIVE — a roster-less signup left inactive, or someone an
      // admin disabled. (Crew logins are active, so their user is non-null and
      // they pass through to the portal.) App.jsx has consumed this error type
      // since day one; this is the first thing that produces it. Without it, an
      // inactive login just saw an empty app while its session kept working.
      if (acc && !acc.user) {
        setAuthError({ type: 'user_not_registered' });
      } else {
        setAuthError(null);
      }
    } catch (e) {
      setUser(null);
      setAccess(null);
      setIsAuthenticated(false);
      if (e?.status && e.status !== 401) setAuthError({ type: 'unknown', message: e.message });
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadUser();
      } else {
        setUser(null);
        setAccess(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, [loadUser]);

  const login = async (email, password) => {
    setAuthError(null);
    await base44.auth.login(email, password);
    // onAuthStateChange fires loadUser(); do it eagerly too for snappy UX.
    await loadUser();
  };

  const logout = async () => {
    await base44.auth.logout();
    setUser(null);
    setAccess(null);
    setIsAuthenticated(false);
  };

  const permFor = useCallback(
    (moduleKey) => {
      if (user?.role === 'admin') return 'admin';
      return access?.modules?.find((m) => m.key === moduleKey)?.permission || 'none';
    },
    [access, user]
  );

  const can = useCallback(
    (moduleKey, level = 'view') => LEVEL[permFor(moduleKey)] >= LEVEL[level],
    [permFor]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        access,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings: false,
        authError,
        appPublicSettings: { id: 'razzle-dazzle', public_settings: {} },
        login,
        logout,
        permFor,
        can,
        navigateToLogin: () => {},
        checkAppState: loadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
