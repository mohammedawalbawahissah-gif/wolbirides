import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** A single Material Community icon, coloured by the tab bar (active vs inactive). */
export function TabIcon({ name, color, size }: { name: IconName; color: string; size: number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

/**
 * A page with a quill writing on it. The quill is drawn twice, first slightly larger in
 * the tab bar's background colour, so it reads as sitting on top of the page.
 */
export function PaperQuillIcon({ color, size, background = "#FFFFFF" }: { color: string; size: number; background?: string }) {
  const quill = Math.round(size * 0.72);
  const offset = { position: "absolute" as const, left: size * 0.42, top: size * 0.34 };
  return (
    <View style={{ width: size * 1.14, height: size * 1.06 }}>
      <MaterialCommunityIcons name="file-document-outline" color={color} size={size} />
      <MaterialCommunityIcons name="feather" color={background} size={quill + 3}
        style={{ ...offset, left: offset.left - 1.5, top: offset.top - 1.5 }} />
      <MaterialCommunityIcons name="feather" color={color} size={quill} style={offset} />
    </View>
  );
}
