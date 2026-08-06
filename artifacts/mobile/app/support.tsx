import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { File } from "expo-file-system";
import { MessageCircle, Phone, ChevronDown, Paperclip, X, CheckCircle } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

// ── Config ────────────────────────────────────────────────────────────────────
const SUPPORT_WHATSAPP = "242064000000"; // remplacer par le vrai numéro support
const SUPPORT_PHONE = "+242064000000";   // remplacer par le vrai numéro support
const AUTH_TOKEN_KEY = "auth_session_token";

function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";
}

// ── Types ─────────────────────────────────────────────────────────────────────
const PROBLEM_TYPES = [
  "Bug d'affichage",
  "Problème de paiement KPay",
  "Dysfonctionnement réservation",
  "Autre",
] as const;

type ProblemType = (typeof PROBLEM_TYPES)[number];

// ── TypePickerModal ───────────────────────────────────────────────────────────
function TypePickerModal({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: ProblemType | "";
  onSelect: (t: ProblemType) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Type de problème
          </Text>
          {PROBLEM_TYPES.map((type) => (
            <Pressable
              key={type}
              onPress={() => { onSelect(type); onClose(); }}
              style={[
                styles.modalOption,
                { borderBottomColor: colors.border },
                selected === type && { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[
                  styles.modalOptionText,
                  { color: selected === type ? colors.primary : colors.foreground },
                ]}
              >
                {type}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={styles.modalCancel}>
            <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>Annuler</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// ── SuccessModal ──────────────────────────────────────────────────────────────
function SuccessModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.successSheet, { backgroundColor: colors.card }]}>
          <CheckCircle size={52} color={colors.primary} />
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Rapport envoyé !</Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
            Merci ! Notre équipe technique a bien reçu votre signalement et y donnera suite dans les meilleurs délais.
          </Text>
          <Pressable
            onPress={onClose}
            style={[styles.successButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.successButtonText}>Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SupportScreen() {
  const colors = useColors();

  // Form state
  const [problemType, setProblemType] = useState<ProblemType | "">("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);

  // UI state
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);

  // ── Contact handlers ────────────────────────────────────────────────────────
  const handleWhatsApp = () => {
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent("Bonjour, j'ai besoin d'aide avec WapiGarage.")}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Erreur", "Impossible d'ouvrir WhatsApp. Vérifiez que l'application est installée.")
    );
  };

  const handleCall = () => {
    Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() =>
      Alert.alert("Erreur", "Impossible de lancer l'appel.")
    );
  };

  // ── Screenshot picker ───────────────────────────────────────────────────────
  const handlePickScreenshot = async () => {
    if (isPickingImage) return;
    setIsPickingImage(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission requise", "WapiGarage a besoin d'accéder à vos photos.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        setScreenshotUri(result.assets[0].uri);
      }
    } finally {
      setIsPickingImage(false);
    }
  };

  // ── Upload screenshot ───────────────────────────────────────────────────────
  const uploadScreenshot = async (uri: string): Promise<string | null> => {
    try {
      const apiBase = getApiBaseUrl();
      if (!apiBase) return null;

      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (!token) return null;

      const arrayBuffer = await new File(uri).arrayBuffer();
      const response = await fetch(`${apiBase}/api/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          Authorization: `Bearer ${token}`,
        },
        body: arrayBuffer,
      });

      if (!response.ok) return null;
      const { url } = (await response.json()) as { url: string };
      return url;
    } catch {
      return null;
    }
  };

  // ── Form validation ─────────────────────────────────────────────────────────
  const isFormValid =
    problemType !== "" &&
    subject.trim().length > 0 &&
    description.trim().length > 0;

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!isFormValid || isSending) return;

    setIsSending(true);
    try {
      const apiBase = getApiBaseUrl();
      const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (!apiBase || !token) {
        Alert.alert("Erreur", "Session expirée. Reconnectez-vous et réessayez.");
        return;
      }

      // Upload screenshot first if provided
      let screenshotUrl: string | null = null;
      if (screenshotUri) {
        screenshotUrl = await uploadScreenshot(screenshotUri);
      }

      const response = await fetch(`${apiBase}/api/support/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: problemType,
          subject: subject.trim(),
          description: description.trim(),
          screenshotUrl,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Erreur inconnue");
      }

      // Reset form and show success
      setProblemType("");
      setSubject("");
      setDescription("");
      setScreenshotUri(null);
      setShowSuccess(true);
    } catch (e) {
      Alert.alert("Erreur", `Impossible d'envoyer le rapport : ${(e as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <KeyboardAwareScrollViewCompat
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.container}
      >
        {/* ── Section Contact Direct ───────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Contact direct</Text>

        <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable
            onPress={handleWhatsApp}
            style={[styles.contactButton, { backgroundColor: "#25D366" }]}
          >
            <MessageCircle size={20} color="#FFFFFF" />
            <Text style={styles.contactButtonText}>Discuter sur WhatsApp Support</Text>
          </Pressable>

          <View style={[styles.contactDivider, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={handleCall}
            style={[styles.contactButton, { backgroundColor: colors.primary }]}
          >
            <Phone size={20} color="#FFFFFF" />
            <Text style={styles.contactButtonText}>Nous appeler</Text>
          </Pressable>
        </View>

        {/* ── Section Formulaire ───────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 28 }]}>
          Signaler un problème
        </Text>

        {/* Type de problème */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Type de problème <Text style={{ color: colors.destructive }}>*</Text>
          </Text>
          <Pressable
            onPress={() => setShowTypePicker(true)}
            style={[
              styles.selectRow,
              {
                backgroundColor: colors.secondary,
                borderColor: problemType ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.selectText,
                { color: problemType ? colors.foreground : colors.mutedForeground },
              ]}
            >
              {problemType || "Sélectionner…"}
            </Text>
            <ChevronDown size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Sujet */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Sujet <Text style={{ color: colors.destructive }}>*</Text>
          </Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Ex : Bouton de réservation non réactif"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground }]}
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Description détaillée <Text style={{ color: colors.destructive }}>*</Text>
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Décrivez le problème, les étapes pour le reproduire, et ce que vous attendiez comme comportement…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: colors.secondary, color: colors.foreground },
            ]}
          />
        </View>

        {/* Capture d'écran */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Capture d'écran (optionnel)
          </Text>

          {screenshotUri ? (
            <View style={styles.screenshotPreviewWrapper}>
              <Image source={{ uri: screenshotUri }} style={styles.screenshotPreview} resizeMode="cover" />
              <Pressable
                onPress={() => setScreenshotUri(null)}
                style={[styles.removeScreenshot, { backgroundColor: colors.destructive }]}
              >
                <X size={14} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handlePickScreenshot}
              disabled={isPickingImage}
              style={[
                styles.screenshotPicker,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
            >
              {isPickingImage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Paperclip size={18} color={colors.mutedForeground} />
                  <Text style={[styles.screenshotPickerText, { color: colors.mutedForeground }]}>
                    Joindre une capture d'écran
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {/* Submit */}
        <Pressable
          onPress={handleSubmit}
          disabled={!isFormValid || isSending}
          style={[
            styles.submitButton,
            {
              backgroundColor: isFormValid ? colors.primary : colors.secondary,
              opacity: isSending ? 0.7 : 1,
            },
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.submitButtonText,
                { color: isFormValid ? "#FFFFFF" : colors.mutedForeground },
              ]}
            >
              Envoyer le rapport
            </Text>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>

      <TypePickerModal
        visible={showTypePicker}
        selected={problemType}
        onSelect={setProblemType}
        onClose={() => setShowTypePicker(false)}
      />

      <SuccessModal
        visible={showSuccess}
        onClose={() => setShowSuccess(false)}
      />
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },

  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 14 },

  // Contact card
  contactCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  contactButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  contactButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  contactDivider: { height: StyleSheet.hairlineWidth },

  // Form fields
  field: { marginBottom: 16, gap: 6 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  textArea: {
    minHeight: 130,
    paddingTop: 12,
  },

  // Type select
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  selectText: { fontFamily: "Inter_400Regular", fontSize: 14 },

  // Screenshot
  screenshotPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
  },
  screenshotPickerText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  screenshotPreviewWrapper: { position: "relative", alignSelf: "flex-start" },
  screenshotPreview: { width: 120, height: 90, borderRadius: 10 },
  removeScreenshot: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  // Submit
  submitButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  // Type picker modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  modalOption: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  modalCancel: { paddingVertical: 16, alignItems: "center" },
  modalCancelText: { fontFamily: "Inter_500Medium", fontSize: 15 },

  // Success modal
  successSheet: {
    margin: 30,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 14,
  },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  successBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  successButton: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 32,
  },
  successButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#FFFFFF" },
});
