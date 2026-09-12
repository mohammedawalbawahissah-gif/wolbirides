import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import DriverGate from "../components/DriverGate";
import DriveScreen from "../screens/HomeScreen";
import EarningsScreen from "../screens/EarningsScreen";
import ProfileScreen from "../screens/ProfileScreen";
import TripsScreen from "../screens/TripsScreen";
import { colors } from "../theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, string> = {
  Drive: "◈",
  Trips: "☰",
  Earnings: "◆",
  Profile: "◐",
};

function TabsInner() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navyInk,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { borderTopColor: colors.line },
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{ICONS[route.name]}</Text>,
      })}
    >
      <Tab.Screen name="Drive" component={DriveScreen} />
      <Tab.Screen name="Trips" component={TripsScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

/**
 * DriverGate wraps the tab navigator (not the other way around) so that an
 * unverified/unapplied driver sees the Apply/Pending screen full-bleed,
 * without a tab bar for tabs they can't use yet.
 */
export default function MainTabNavigator() {
  return (
    <DriverGate>
      <TabsInner />
    </DriverGate>
  );
}
