import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = "auth_session_token";
/** Clé SecureStore pour la session Firebase (auth téléphone). */
const FIREBASE_USER_KEY = "firebase_auth_user";

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface PhoneUserInfo {
  uid: string;
  phoneNumber: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isNewUser: boolean;
  isGuest: boolean;
  clearIsNewUser: () => void;
  login: () => Promise<void>;
  loginWithPhone: (info: PhoneUserInfo) => Promise<void>;
  /** Sign in with a backend session token (returned by /api/auth/phone/verify-otp). */
  loginWithSession: (token: string, isNew?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (reason?: string, reasonDetail?: string) => Promise<void>;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isNewUser: false,
  isGuest: false,
  clearIsNewUser: () => {},
  login: async () => {},
  loginWithPhone: async () => {},
  loginWithSession: async () => {},
  logout: async () => {},
  deleteAccount: async (_reason?: string, _reasonDetail?: string) => {},
  enterGuestMode: () => {},
  exitGuestMode: () => {},
  refreshUser: async () => {},
});

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      // 1. Essai avec le token backend (Google OAuth)
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        const res = await fetch(`${apiBase}/api/auth/user`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          setIsLoading(false);
          return;
        }
        // Token expiré ou invalide — on le supprime
        await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      }

      // 2. Fallback : session Firebase (auth téléphone)
      const raw = await SecureStore.getItemAsync(FIREBASE_USER_KEY);
      if (raw) {
        const info: PhoneUserInfo = JSON.parse(raw);
        setUser({
          id: info.uid,
          email: null,
          firstName: null,
          lastName: null,
          profileImageUrl: null,
        });
        setIsLoading(false);
        return;
      }

      // Aucune session
      setUser(null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  /** Connexion Google OAuth via le backend API. */
  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiBase = getApiBaseUrl();
      if (!apiBase) {
        console.error("API base URL is not configured.");
        setIsLoading(false);
        return;
      }

      const redirectUri = AuthSession.makeRedirectUri();
      const startUrl = `${apiBase}/api/auth/google?mobile_redirect=${encodeURIComponent(redirectUri)}`;

      const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);

      if (result.type !== "success" || !result.url) {
        setIsLoading(false);
        return;
      }

      const resultUrl = new URL(result.url);
      const token = resultUrl.searchParams.get("token");
      const error = resultUrl.searchParams.get("error");

      if (error) {
        console.error("Google sign-in error:", error);
        setIsLoading(false);
        return;
      }

      if (token) {
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
        setIsNewUser(resultUrl.searchParams.get("isNewUser") === "true");
        setIsGuest(false);
        await fetchUser();
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Login error:", err);
      setIsLoading(false);
    }
  }, [fetchUser]);

  /**
   * Connexion avec un token de session backend (retourné par /api/auth/phone/verify-otp).
   * Remplace l'ancien flow Firebase Phone Auth — fonctionne dans Expo Go.
   */
  const loginWithSession = useCallback(async (token: string, isNew = false) => {
    setIsLoading(true);
    try {
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
      await SecureStore.deleteItemAsync(FIREBASE_USER_KEY);
      setIsNewUser(isNew);
      setIsGuest(false);
      await fetchUser();
    } catch (err) {
      console.error("loginWithSession error:", err);
      setIsLoading(false);
    }
  }, [fetchUser]);

  /**
   * Connexion par téléphone (Firebase OTP) — conservé pour rétrocompatibilité.
   */
  const loginWithPhone = useCallback(async (info: PhoneUserInfo) => {
    setIsLoading(true);
    try {
      await SecureStore.setItemAsync(FIREBASE_USER_KEY, JSON.stringify(info));
      setUser({
        id: info.uid,
        email: null,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      });
      setIsNewUser(true);
      setIsGuest(false);
    } catch (err) {
      console.error("loginWithPhone error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
    } finally {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      await SecureStore.deleteItemAsync(FIREBASE_USER_KEY);
      await AsyncStorage.removeItem("user_active_mode");
      setUser(null);
      setIsNewUser(false);
      setIsGuest(false);
    }
  }, []);

  const deleteAccount = useCallback(async (reason?: string, reasonDetail?: string) => {
    try {
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (token) {
        const apiBase = getApiBaseUrl();
        await fetch(`${apiBase}/api/users/me`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason, reasonDetail }),
        });
      }
    } catch {
      // silently ignored — local cleanup runs regardless
    } finally {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
      await SecureStore.deleteItemAsync(FIREBASE_USER_KEY);
      await AsyncStorage.removeItem("user_active_mode");
      setUser(null);
      setIsNewUser(false);
      setIsGuest(false);
    }
  }, []);

  const enterGuestMode = useCallback(() => setIsGuest(true), []);
  const exitGuestMode = useCallback(() => setIsGuest(false), []);
  const clearIsNewUser = useCallback(() => setIsNewUser(false), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isNewUser,
        isGuest,
        clearIsNewUser,
        login,
        loginWithPhone,
        loginWithSession,
        logout,
        deleteAccount,
        enterGuestMode,
        exitGuestMode,
        refreshUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
