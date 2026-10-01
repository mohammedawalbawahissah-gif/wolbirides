import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FloatingActions from "../components/FloatingActions";
import { PaperQuillIcon, TabIcon } from "../components/TabIcons";
import HistoryScreen from "../screens/HistoryScreen";
import HomeScreen from "../screens/HomeScreen";
import ProfileScreen from "../screens/ProfileScreen";
import { colors } from "../theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navyInk,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { borderTopColor: colors.line },
        // Tabs have no header, so keep every tab screen clear of the phone's status bar.
        sceneStyle: { paddingTop: insets.top, backgroundColor: colors.paper },
        tabBarIcon: ({ color, size }) =>
          route.name === "Ride" ? <TabIcon name="rickshaw" color={color} size={size} />
          : route.name === "History" ? <PaperQuillIcon color={color} size={size} />
          : <TabIcon name="account-circle" color={color} size={size} />,
      })}
    >
      <Tab.Screen name="Ride" component={HomeScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
    <FloatingActions />
    </View>
  );
}
