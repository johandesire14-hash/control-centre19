import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProxyImage as Image } from "@/components/ProxyImage";
import type { LucideIcon } from "lucide-react-native";
import { ChevronLeft, Lock, Phone, Shield, Star, Zap } from "lucide-react-native";
import { GoogleIcon } from "@/components/GoogleIcon";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  CongoPhoneInput,
  validateCongoPhone,
} from "@/components/CongoPhoneInput";

// Firebase SDK modular
import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
  type ConfirmationResult,
  type ApplicationVerifier,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseConfig";
import { createSupabaseWithToken } from "@/lib/supabase";

const icon = require("@/assets/images/icon.png");

type Step = "idle" | "phone" | "otp" | "verifying";

export default function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading, login, loginWithPhone, enterGuestMode } = useAuth();
  const returningUserStarted = useRef(false);
  /** Ref vers le RecaptchaVerifier web — recyclé entre les tentatives. */
  const webVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const { message } = useLocalSearchParams<{ message?: string }>();

  // ── Navigation guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    if (returningUserStarted.current) return;
    returningUserStarted.current = true;

    (async () => {
      try {
        const token = await SecureStore.getItemAsync("auth_session_token");
        const apiBase = process.env.EXPO_PUBLIC_DOMAIN
          ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
          : "";
        const res = await fetch(`${apiBase}/api/profile`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json();
        if (data?.hasGarage) {
          await AsyncStorage.setItem("user_active_mode", "PRO");
          router.replace("/(garage)");
        } else {
          await AsyncStorage.removeItem("user_active_mode");
          router.replace("/(tabs)");
        }
      } catch {
        await AsyncStorage.removeItem("user_active_mode");
        router.replace("/(tabs)");
      }
    })();
  }, [isLoading, isAuthenticated]);

  // ── Phone OTP state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("idle");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  /**
   * Retourne le bon ApplicationVerifier selon la plateforme :
   *  - Web  → RecaptchaVerifier invisible (SDK Firebase standard)
   *  - Native → verifier factice (fonctionne grâce à
   *    appVerificationDisabledForTesting = true activé dans firebaseConfig)
   */
  const getVerifier = useCallback((): ApplicationVerifier => {
    if (Platform.OS === "web") {
      // Nettoyer l'ancien verifier pour éviter les doublons reCAPTCHA
      if (webVerifierRef.current) {
        webVerifierRef.current.clear();
        webVerifierRef.current = null;
      }
      // Créer un conteneur DOM invisible si nécessaire
      let container = document.getElementById("firebase-recaptcha");
      if (!container) {
        container = document.createElement("div");
        container.id = "firebase-recaptcha";
        document.body.appendChild(container);
      }
      webVerifierRef.current = new RecaptchaVerifier(firebaseAuth, container, {
        size: "invisible",
      });
      return webVerifierRef.current;
    }
    // Native (Expo Go en dev) : verifier factice — appVerificationDisabledForTesting
    // laisse Firebase envoyer de vrais SMS sans passer par reCAPTCHA/WebView.
    // Firebase appelle aussi _reset() en interne après l'envoi → on l'expose.
    return {
      type: "recaptcha",
      verify: () => Promise.resolve("dev-bypass"),
      _reset: () => {},
    } as unknown as ApplicationVerifier;
  }, []);

  // ── Envoyer le code OTP via Firebase ─────────────────────────────────────
  const handleSendOtp = useCallback(async () => {
    const validation = validateCongoPhone(phoneLocal);
    if (!validation.valid) {
      setOtpError(validation.error ?? "Numéro invalide.");
      return;
    }
    setOtpError(null);
    setOtpLoading(true);
    try {
      const verifier = getVerifier();
      const result = await signInWithPhoneNumber(firebaseAuth, validation.international!, verifier);
      setConfirmation(result);
      setStep("otp");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de l'envoi du code.";
      setOtpError(msg);
    } finally {
      setOtpLoading(false);
    }
  }, [phoneLocal, getVerifier]);

  // ── Vérifier le code OTP via Firebase ────────────────────────────────────
  const handleVerifyOtp = useCallback(async () => {
    if (otpCode.length !== 6) {
      setOtpError("Veuillez entrer les 6 chiffres du code.");
      return;
    }
    setOtpError(null);
    setStep("verifying");
    try {
      const userCred = await confirmation!.confirm(otpCode);
      const fbUser = userCred.user;
      if (!fbUser) throw new Error("Utilisateur Firebase non disponible après vérification.");

      // Synchronisation Supabase (upsert profil) — non-bloquant
      try {
        const idToken = await fbUser.getIdToken();
        const client = createSupabaseWithToken(idToken);
        await client
          .from("profiles")
          .upsert({ id: fbUser.uid, phone: fbUser.phoneNumber }, { onConflict: "id" });
      } catch (supaErr) {
        console.warn("Supabase upsert warning:", supaErr);
      }

      await loginWithPhone({ uid: fbUser.uid, phoneNumber: fbUser.phoneNumber ?? null });
      await AsyncStorage.removeItem("user_active_mode");
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Code incorrect. Réessayez.";
      setOtpError(msg);
      setStep("otp");
    }
  }, [otpCode, confirmation, loginWithPhone]);

  const handleBack = () => {
    setOtpError(null);
    setOtpCode("");
    setStep(step === "otp" ? "phone" : "idle");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Bouton Ignorer */}
        <Pressable
          onPress={() => { enterGuestMode(); router.replace("/(tabs)"); }}
          style={[styles.skipButton, { top: insets.top + 12 }]}
          hitSlop={12}
        >
          <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Ignorer</Text>
        </Pressable>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.container,
            { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo & branding */}
          <View style={styles.logoWrap}>
            <View style={styles.logoCircle}>
              <Image source={icon} style={styles.logoImage} contentFit="contain" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>WapiGarage</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Le réseau auto de Brazzaville
            </Text>
            {message ? (
              <View style={[styles.messageBanner, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                <Lock size={14} color={colors.primary} />
                <Text style={[styles.messageText, { color: colors.foreground }]}>{message}</Text>
              </View>
            ) : null}
          </View>

          {/* Feature pills — affichées uniquement sur l'écran d'accueil */}
          {step === "idle" && (
            <View style={styles.featurePills}>
              {([
                { icon: Shield, label: "Garages vérifiés" },
                { icon: Star, label: "Avis certifiés" },
                { icon: Zap, label: "Urgences 24h" },
              ] as { icon: LucideIcon; label: string }[]).map((f) => (
                <View key={f.label} style={[styles.featurePill, { backgroundColor: colors.card }]}>
                  {(() => { const FIcon = f.icon; return <FIcon size={14} color={colors.primary} />; })()}
                  <Text style={[styles.featurePillText, { color: colors.foreground }]}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Zone d'action selon l'étape ────────────────────────────── */}

          {step === "idle" && (
            <View style={styles.actionsWrap}>
              {/* Google */}
              <Pressable
                onPress={async () => { await login(); }}
                disabled={isLoading}
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <GoogleIcon size={18} />
                    <Text style={styles.primaryButtonText}>Continuer avec Google</Text>
                  </>
                )}
              </Pressable>

              {/* Séparateur */}
              <View style={styles.separatorRow}>
                <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.separatorText, { color: colors.mutedForeground }]}>ou</Text>
                <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
              </View>

              {/* Téléphone */}
              <Pressable
                onPress={() => { setStep("phone"); setOtpError(null); }}
                style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Phone size={18} color={colors.foreground} />
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  Continuer avec téléphone
                </Text>
              </Pressable>
            </View>
          )}

          {step === "phone" && (
            <View style={styles.formWrap}>
              <Pressable onPress={handleBack} style={styles.backRow} hitSlop={8}>
                <ChevronLeft size={18} color={colors.mutedForeground} />
                <Text style={[styles.backText, { color: colors.mutedForeground }]}>Retour</Text>
              </Pressable>

              <Text style={[styles.formTitle, { color: colors.foreground }]}>
                Votre numéro Congo
              </Text>
              <Text style={[styles.formSub, { color: colors.mutedForeground }]}>
                Vous recevrez un code SMS à 6 chiffres.
              </Text>

              <CongoPhoneInput
                value={phoneLocal}
                onChangeText={setPhoneLocal}
                label="Numéro de téléphone"
                required
                containerStyle={{ marginTop: 16 }}
              />

              {otpError && (
                <Text style={[styles.errorText, { color: "#E4002B" }]}>{otpError}</Text>
              )}

              <Pressable
                onPress={handleSendOtp}
                disabled={otpLoading}
                style={[styles.primaryButton, { backgroundColor: colors.primary, marginTop: 20 }]}
              >
                {otpLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Envoyer le code</Text>
                )}
              </Pressable>
            </View>
          )}

          {(step === "otp" || step === "verifying") && (
            <View style={styles.formWrap}>
              <Pressable onPress={handleBack} style={styles.backRow} hitSlop={8} disabled={step === "verifying"}>
                <ChevronLeft size={18} color={colors.mutedForeground} />
                <Text style={[styles.backText, { color: colors.mutedForeground }]}>Retour</Text>
              </Pressable>

              <Text style={[styles.formTitle, { color: colors.foreground }]}>
                Code de vérification
              </Text>
              <Text style={[styles.formSub, { color: colors.mutedForeground }]}>
                Entrez le code à 6 chiffres envoyé au{"\n"}
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                  +242{phoneLocal}
                </Text>
              </Text>

              <TextInput
                value={otpCode}
                onChangeText={(v) => setOtpCode(v.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="• • • • • •"
                placeholderTextColor={colors.mutedForeground}
                editable={step !== "verifying"}
                autoFocus
                style={[
                  styles.otpInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.secondary,
                    borderColor: otpCode.length === 6 ? colors.primary : colors.border,
                  },
                ]}
              />

              {otpError && (
                <Text style={[styles.errorText, { color: "#E4002B" }]}>{otpError}</Text>
              )}

              <Pressable
                onPress={handleVerifyOtp}
                disabled={step === "verifying" || otpCode.length !== 6}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    marginTop: 20,
                    opacity: step === "verifying" || otpCode.length !== 6 ? 0.6 : 1,
                  },
                ]}
              >
                {step === "verifying" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Vérifier le code</Text>
                )}
              </Pressable>
            </View>
          )}

          {step === "idle" && (
            <Text style={[styles.legalText, { color: colors.mutedForeground }]}>
              En continuant, vous acceptez nos{" "}
              <Text
                style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
                onPress={() => router.push("/about")}
              >
                CGU et notre politique de confidentialité
              </Text>
              .
            </Text>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  skipButton: {
    position: "absolute",
    right: 20,
    zIndex: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  skipText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    gap: 32,
  },
  logoWrap: { alignItems: "center", gap: 10 },
  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 28,
    backgroundColor: "#0D1A14",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    overflow: "hidden",
    shadowColor: "#1D7159",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  logoImage: { width: "85%", height: "85%" },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, textAlign: "center" },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center" },
  messageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  messageText: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1, textAlign: "center" },
  featurePills: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  featurePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  featurePillText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  actionsWrap: { gap: 12 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    paddingVertical: 17,
    shadowColor: "#1D7159",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  primaryButtonText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 16 },
  separatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  separatorLine: { flex: 1, height: 1 },
  separatorText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    paddingVertical: 16,
    borderWidth: 1,
  },
  secondaryButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  legalText: { fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center", lineHeight: 18 },
  // ── Form (phone + OTP) ──────────────────────────────────────────────────────
  formWrap: { gap: 0 },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 20,
    alignSelf: "flex-start",
  },
  backText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  formTitle: { fontFamily: "Inter_700Bold", fontSize: 22, marginBottom: 8 },
  formSub: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  otpInput: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 20,
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: 10,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
  },
});
