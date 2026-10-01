import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, TextInput, TouchableOpacity, View, type TextInputProps } from "react-native";
import { colors, radii, spacing } from "../theme";

/** A password TextInput with a "show/hide" eye toggle, matching the web PasswordField. */
export default function PasswordField(props: Omit<TextInputProps, "secureTextEntry">) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.wrap}>
      <TextInput placeholderTextColor={colors.inkMuted} secureTextEntry={!visible} {...props}
        style={[styles.input, props.style]} />
      <TouchableOpacity style={styles.toggle} onPress={() => setVisible((v) => !v)}
        accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"}>
        <MaterialCommunityIcons name={visible ? "eye-off" : "eye"} size={20} color={colors.inkMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center", marginBottom: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.sm, paddingVertical: 12,
    paddingLeft: 14, paddingRight: 44, fontSize: 15, backgroundColor: colors.paperRaised, marginBottom: 0,
  },
  toggle: { position: "absolute", right: 4, height: 40, width: 40, alignItems: "center", justifyContent: "center" },
});
