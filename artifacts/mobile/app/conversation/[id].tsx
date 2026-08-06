import React, { useEffect, useRef, useState } from "react";
import { getImageUrl } from "@/lib/imageUrl";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { FileText, ImageIcon, Plus, Send, X } from "lucide-react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MessageType,
  useListConversations,
  useListMessages,
  useMarkConversationRead,
  useSendMessage,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { pickAndUploadImage } from "@/lib/uploadImage";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function isImageUrl(content: string): boolean {
  return (
    content.startsWith("https://") &&
    (content.includes("/api/storage/") ||
      /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(content))
  );
}

// ── Attach menu ──────────────────────────────────────────────────────────────

type AttachItem = {
  icon: React.ReactNode;
  label: string;
  color: string;
  onPress: () => void;
};

function AttachMenu({
  visible,
  onClose,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  items: AttachItem[];
}) {
  const translateY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 300, duration: 140, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[menuStyles.backdrop, { opacity }]}>
          <TouchableWithoutFeedback>
            <Animated.View style={[menuStyles.sheet, { transform: [{ translateY }] }]}>
              <View style={menuStyles.handle} />
              <View style={menuStyles.grid}>
                {items.map((item) => (
                  <Pressable
                    key={item.label}
                    style={menuStyles.item}
                    onPress={() => {
                      onClose();
                      setTimeout(item.onPress, 200);
                    }}
                  >
                    <View style={[menuStyles.iconCircle, { backgroundColor: item.color }]}>
                      {item.icon}
                    </View>
                    <Text style={menuStyles.itemLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ConversationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const conversationId = Number(id);
  const isPro = mode === "pro";
  const { user } = useAuth();

  const [text, setText] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<FlatList>(null);

  const conversations = useListConversations();
  const conversation = (conversations.data ?? []).find((c) => c.id === conversationId);

  const messages = useListMessages(conversationId, { query: { refetchInterval: 4000 } as never });
  const sendMessage = useSendMessage();
  const markRead = useMarkConversationRead();

  useEffect(() => {
    markRead.mutate({ conversationId }, { onSuccess: () => conversations.refetch() });
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    if (!text.trim()) return;
    const content = text.trim();
    setText("");
    sendMessage.mutate(
      { conversationId, data: { type: MessageType.text, content } },
      { onSuccess: () => messages.refetch() },
    );
  };

  const handlePickPhoto = async () => {
    setUploadingPhoto(true);
    try {
      const url = await pickAndUploadImage({ allowsEditing: false });
      if (!url) return;
      sendMessage.mutate(
        { conversationId, data: { type: MessageType.text, content: url } },
        { onSuccess: () => messages.refetch() },
      );
    } catch {
      Alert.alert("Erreur", "Impossible d'envoyer la photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const attachItems: AttachItem[] = [
    ...(isPro
      ? [
          {
            icon: <FileText size={26} color="#FFFFFF" />,
            label: "Créer une facture",
            color: "#1D7159",
            onPress: () => router.push({ pathname: "/(garage)/invoice" }),
          } satisfies AttachItem,
        ]
      : []),
    {
      icon: uploadingPhoto ? (
        <ActivityIndicator size={22} color="#FFFFFF" />
      ) : (
        <ImageIcon size={26} color="#FFFFFF" />
      ),
      label: "Envoyer une photo",
      color: "#2563EB",
      onPress: handlePickPhoto,
    },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={() =>
                conversation?.garageId
                  ? router.push({ pathname: "/garage/[id]", params: { id: conversation.garageId } })
                  : undefined
              }
              hitSlop={10}
              style={{ alignItems: "center" }}
            >
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 17, color: colors.foreground }}>
                {conversation?.garageName ?? "Conversation"}
              </Text>
              {conversation?.garageId ? (
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: colors.primary }}>
                  Voir le profil
                </Text>
              ) : null}
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        {messages.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={messages.data ?? []}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => {
              const mine = item.senderId === user?.id;
              const isImage = isImageUrl(item.content);
              return (
                <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                  <View
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: isImage ? "transparent" : mine ? colors.primary : colors.secondary,
                        borderBottomRightRadius: mine ? 4 : 16,
                        borderBottomLeftRadius: mine ? 16 : 4,
                        padding: isImage ? 0 : undefined,
                      },
                    ]}
                  >
                    {isImage ? (
                      <Pressable onPress={() => setFullscreenImage(item.content)}>
                        <Image
                          source={{ uri: getImageUrl(item.content) }}
                          style={styles.chatImage}
                          resizeMode="cover"
                        />
                        <Text
                          style={[
                            styles.bubbleTime,
                            { color: colors.mutedForeground, paddingHorizontal: 6, paddingBottom: 4 },
                          ]}
                        >
                          {formatTime(item.createdAt)}
                        </Text>
                      </Pressable>
                    ) : (
                      <>
                        <Text style={{ color: mine ? "#FFFFFF" : colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
                          {item.content}
                        </Text>
                        <Text
                          style={[
                            styles.bubbleTime,
                            { color: mine ? "rgba(255,255,255,0.7)" : colors.mutedForeground },
                          ]}
                        >
                          {formatTime(item.createdAt)}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              );
            }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputRow, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
          {/* + attach button */}
          <Pressable
            onPress={() => setAttachOpen(true)}
            style={[styles.plusButton, { backgroundColor: colors.secondary }]}
          >
            <Plus size={20} color={colors.primary} strokeWidth={2.5} />
          </Pressable>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Écrivez un message…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground }]}
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sendMessage.isPending}
            style={[styles.sendButton, { backgroundColor: colors.primary, opacity: text.trim() ? 1 : 0.5 }]}
          >
            <Send size={17} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Attach menu */}
        <AttachMenu
          visible={attachOpen}
          onClose={() => setAttachOpen(false)}
          items={attachItems}
        />

        {/* Fullscreen image */}
        <Modal visible={!!fullscreenImage} transparent animationType="fade" statusBarTranslucent>
          <TouchableWithoutFeedback onPress={() => setFullscreenImage(null)}>
            <View style={styles.fullscreenOverlay}>
              {fullscreenImage ? (
                <Image source={{ uri: getImageUrl(fullscreenImage) }} style={styles.fullscreenImage} resizeMode="contain" />
              ) : null}
              <Pressable onPress={() => setFullscreenImage(null)} style={styles.fullscreenClose}>
                <X size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </KeyboardAvoidingView>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "78%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
    overflow: "hidden",
  },
  chatImage: {
    width: 220,
    height: 160,
    borderRadius: 12,
  },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "flex-end" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plusButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "80%",
  },
  fullscreenClose: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});

const menuStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1A1A1A",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 24,
  },
  grid: {
    flexDirection: "row",
    gap: 24,
    justifyContent: "center",
  },
  item: {
    alignItems: "center",
    gap: 10,
    minWidth: 80,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: {
    color: "#FFFFFF",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textAlign: "center",
  },
});
