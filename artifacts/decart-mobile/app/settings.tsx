import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

const DEFAULT_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl, setServerUrl] = useState(
    DEFAULT_DOMAIN ? `https://${DEFAULT_DOMAIN}` : ""
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("@server_url").then((val) => {
      if (val) setServerUrl(val);
      else if (DEFAULT_DOMAIN) setServerUrl(`https://${DEFAULT_DOMAIN}`);
    });
  }, []);

  const save = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await AsyncStorage.setItem("@server_url", serverUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Configuración</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Server URL */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>URL DEL SERVIDOR</Text>
          <Text style={styles.sectionDesc}>
            URL base donde corre el servidor API. En producción usa la URL de tu dominio Replit o servidor propio.
          </Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://tu-dominio.replit.app"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.example}>
            Ejemplo: https://mi-proyecto.replit.app
          </Text>
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color="#60a5fa" />
          <Text style={styles.infoText}>
            El ID de sala lo genera el panel PC (web). Abre la app web en tu PC y copia el ID de 3 caracteres que aparece.
          </Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveBtn, saved && styles.saveBtnDone]}
          onPress={save}
          activeOpacity={0.8}
        >
          <Ionicons
            name={saved ? "checkmark-circle" : "save-outline"}
            size={20}
            color="#ffffff"
          />
          <Text style={styles.saveBtnText}>
            {saved ? "¡Guardado!" : "Guardar configuración"}
          </Text>
        </TouchableOpacity>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instrTitle}>¿Cómo usar?</Text>
          <View style={styles.instrStep}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
            <Text style={styles.stepText}>Abre el panel PC (web) en tu computadora</Text>
          </View>
          <View style={styles.instrStep}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
            <Text style={styles.stepText}>Toca "Iniciar PC" y copia el ID de sala (3 letras)</Text>
          </View>
          <View style={styles.instrStep}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
            <Text style={styles.stepText}>Vuelve aquí, ingresa el ID y toca "Conectar y transmitir"</Text>
          </View>
          <View style={styles.instrStep}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>4</Text></View>
            <Text style={styles.stepText}>El filtro Decart AI se aplica en tiempo real en el PC</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    backgroundColor: "#0a0f1a",
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 20 },
  section: { gap: 8 },
  sectionTitle: {
    color: "#6b7280",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  sectionDesc: {
    color: "#9ca3af",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#111827",
    color: "#ffffff",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  example: {
    color: "#4b5563",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
  },
  infoText: {
    color: "#93c5fd",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16a34a",
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveBtnDone: { backgroundColor: "#15803d" },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  instructions: {
    backgroundColor: "#0a0f1a",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  instrTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  instrStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  stepText: {
    color: "#9ca3af",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
});
