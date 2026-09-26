import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { registerForPush } from "../push";
import { startSOSQueueFlusher } from "../sosQueue";
import * as Notifications from "expo-notifications";
import AssistantScreen from "../screens/AssistantScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import { openLink } from "./links";
import { colors } from "../theme";
import AuthNavigator from "./AuthNavigator";
import MainTabNavigator from "./MainTabNavigator";
import TripStatusScreen from "../screens/TripStatusScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, loading } = useAuth();

  // Once signed in: register for push (WR-16) and resend any SOS left unsent from before (WR-18).
  useEffect(() => {
    if (!user) return;
    registerForPush();
    startSOSQueueFlusher();
    // Tapping a push opens the same screen its link opens in the app and on web.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = (response.notification.request.content.data as { link?: string } | undefined)?.link;
      if (link) setTimeout(() => openLink(link), 300);
    });
    return () => sub.remove();
  }, [user?.id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator size="large" color={colors.navyInk} />
      </View>
    );
  }

  if (!user) {
    return <AuthNavigator />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabNavigator} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Assistant" component={AssistantScreen} options={{ presentation: "modal" }} />
      <Stack.Screen
        name="TripStatus"
        component={TripStatusScreen}
        options={{ presentation: "modal" }}
      />
    </Stack.Navigator>
  );
}
