import type { ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radii, spacing } from "../theme";

type ButtonVariant = "primary" | "gold" | "success" | "danger" | "dangerGhost" | "ghost";

const VARIANT_STYLES: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
  primary: { bg: colors.navyInk, text: "#FFFFFF" },
  gold: { bg: colors.gold, text: colors.navyInk },
  success: { bg: colors.success, text: "#FFFFFF" },
  danger: { bg: colors.danger, text: "#FFFFFF" },
  dangerGhost: { bg: colors.dangerBg, text: colors.danger },
  ghost: { bg: "transparent", text: colors.inkMuted, border: colors.line },
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = VARIANT_STYLES[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: v.border ? 1 : 0 },
        (disabled || loading) && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.text} /> : <Text style={[styles.buttonText, { color: v.text }]}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function TextField(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.inkMuted} {...props} style={[styles.input, props.style]} />;
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "success" | "danger" | "warning" | "neutral" }) {
  const toneStyles = {
    success: { bg: colors.successBg, text: colors.success },
    danger: { bg: colors.dangerBg, text: colors.danger },
    warning: { bg: colors.warningBg, text: colors.warning },
    neutral: { bg: "#EDEBE3", text: colors.inkMuted },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: toneStyles.bg }]}>
      <Text style={[styles.badgeText, { color: toneStyles.text }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{message}</Text>
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.sm,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.inkMuted,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: spacing.md,
    backgroundColor: colors.paperRaised,
    color: colors.ink,
  },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  emptyState: { padding: spacing.xl, alignItems: "center" },
  emptyStateText: { fontSize: 14, color: colors.inkMuted, textAlign: "center" },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: { color: colors.danger, fontSize: 13.5 },
});
