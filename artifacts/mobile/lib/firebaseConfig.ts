/**
 * Firebase configuration — SDK Web modular (firebase/auth)
 *
 * Utilise l'API modulaire Firebase v10+ au lieu de l'API compat.
 *
 * En développement (__DEV__), appVerificationDisabledForTesting = true permet
 * d'envoyer de vrais SMS Firebase sans reCAPTCHA ni WebView, ce qui rend le
 * flux compatible avec Expo Go.
 *
 * En production native, vous devrez utiliser un development build Expo avec
 * react-native-firebase (les APNs/SafetyNet natifs remplacent reCAPTCHA).
 */
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: `${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? ""}.firebaseapp.com`,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: `${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? ""}.appspot.com`,
};

// Singleton — safe to call during hot reloads.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;

export const firebaseAuth = getAuth(app);
export const firebaseApp = app;

// En développement : désactive la vérification reCAPTCHA côté Firebase.
// Cela permet d'envoyer de vrais SMS Firebase sans WebView (Expo Go compatible).
// Ne jamais activer en production.
if (__DEV__) {
  firebaseAuth.settings.appVerificationDisabledForTesting = true;
}
