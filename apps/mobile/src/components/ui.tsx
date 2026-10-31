import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii } from '@im/tokens';

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function Copy({ children }: { children: ReactNode }) { return <Text style={styles.copy}>{children}</Text>; }
export function Card({ children }: { children: ReactNode }) { return <View style={styles.card}>{children}</View>; }
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, { opacity: disabled || pressed ? 0.55 : 1 }]}><Text style={[styles.buttonText, secondary && { color: colors.brand }]}>{title}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize="none" placeholderTextColor={colors.subtle} style={styles.input} {...props} /></View>;
}
export function Notice({ message }: { message: string | null }) { return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.copy}>{message}</Text> : null; }
export function Loading() { return <Screen title="Covva"><ActivityIndicator accessibilityLabel="Loading your account" color={colors.brand} /></Screen>; }
export function ActionButton({ title, action, secondary = false }: { title: string; action: () => Promise<unknown>; secondary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); }
  }
  return <><Button title={busy ? 'Please Wait…' : title} disabled={busy} secondary={secondary} onPress={() => { void run(); }} /><Notice message={error} /></>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  page: { padding: 24, gap: 20, flexGrow: 1, maxWidth: 600, width: '100%', alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: '600', color: colors.ink, marginTop: 16 },
  copy: { fontSize: 16, lineHeight: 24, color: colors.muted },
  label: { fontSize: 16, fontWeight: '500', color: colors.ink },
  card: { padding: 20, gap: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radii.xl },
  input: { minHeight: 54, padding: 16, fontSize: 16, color: colors.ink, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  button: { minHeight: 54, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.brand },
  secondary: { minHeight: 50, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.white },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '500', textAlign: 'center' },
});
