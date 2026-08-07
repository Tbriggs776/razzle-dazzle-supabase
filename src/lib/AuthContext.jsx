import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Supabase-backed AuthContext (POC).
 *
 * Keeps the exact same interface the app consumed from base44's AuthContext
 * (user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError,
 * appPublicSettings, logout, navigateToLogin, checkAppState) so no page code
 * had to change. In the POC it resolves to a seeded demo user immediately.
 *
 * To move to real auth: replace `base44.auth.me()` handling with a Supabase
 * sign-in flow and gate `isAuthenticated` on the session.
 */
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      // No remote public-settings call in the POC; the app is open.
      setAppPublicSettings({ id: 'razzle-dazzle', public_settings: {} });
      setIsLoadingPublicSettings(false);
      await checkUserAuth();
    } catch (error) {
      console.error('App state check failed:', error);
      setAuthError({ type: 'unknown', message: error.message || 'Failed to load app' });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = async () => {
    setUser(null);
    setIsAuthenticated(false);
    await base44.auth.logout();
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
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
