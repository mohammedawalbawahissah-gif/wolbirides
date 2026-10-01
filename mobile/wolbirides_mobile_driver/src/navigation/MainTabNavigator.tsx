import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FloatingActions from "../components/FloatingActions";
import { TabIcon } from "../components/TabIcons";
import DriverGate from "../components/DriverGate";
import { useDispatchState } from "../components/DispatchLayer";
import DriveScreen from "../screens/HomeScreen";
import EarningsScreen from "../screens/EarningsScreen";
import ProfileScreen from "../screens/ProfileScreen";
import RequestsScreen from "../screens/RequestsScreen";
import TripsScreen from "../screens/TripsScreen";
import { colors } from "../theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS = {
  Drive: "rickshaw",
  Requests: "bell-ring-outline",
  Trips: "swap-horizontal",
  Earnings: "cash",
  Profile: "account-circle",
} as const satisfies Record<keyof MainTabParamList, string>;

function TabsInner() {
  const insets = useSafeAreaInsets();
  const { offer } = useDispatchState();
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
        tabBarIcon: ({ color, size }) => <TabIcon name={ICONS[route.name]} color={color} size={size} />,
      })}
    >
      <Tab.Screen name="Drive" component={DriveScreen} options={{ tabBarLabel: "Home" }} />
      <Tab.Screen name="Requests" component={RequestsScreen} options={{ tabBarBadge: offer ? "" : undefined }} />
      <Tab.Screen name="Trips" component={TripsScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
    <FloatingActions />
    </View>
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
