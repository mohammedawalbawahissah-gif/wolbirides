import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api/client";
import { APP_ROLE } from "./appConfig";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

const TOKEN_KEY = `${APP_ROLE}_push_token`;

/**
 * WR-16: register this phone for push so trip, payout and safety alerts reach
 * someone who isn't looking at the app. Needs a development/production build
 * (not Expo Go) and an EAS projectId (set by `eas init`). Silently skips otherwise.
 */
export async function registerForPush() {
  try {
    if (!Device.isDevice) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "WolbiRides", importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const status = current.status === "granted" ? current.status : (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post("/devices", { token, platform: Platform.OS, app: APP_ROLE });
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Push is a convenience; in-app notifications still work without it.
  }
}

export async function unregisterPush() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await api.delete("/devices", { data: { token } }).catch(() => {});
  await AsyncStorage.removeItem(TOKEN_KEY);
}
