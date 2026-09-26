import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "./appConfig";

/**
 * Sign-in tokens live in the phone's secure storage (Android Keystore / iOS Keychain),
 * not AsyncStorage, which is plain files readable on a rooted phone or in some backups.
 * The profile JSON (not a secret) stays in AsyncStorage.
 *
 * Tokens saved by older builds are moved over on first read, so nobody is signed out
 * by this update.
 */
let migrated = false;

async function migrateFromAsyncStorage() {
  if (migrated) return;
  migrated = true;
  for (const key of [STORAGE_KEYS.access, STORAGE_KEYS.refresh]) {
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      if (!(await SecureStore.getItemAsync(key))) await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
    }
  }
}

export async function getAccessToken() {
  await migrateFromAsyncStorage();
  return SecureStore.getItemAsync(STORAGE_KEYS.access);
}

export async function getRefreshToken() {
  await migrateFromAsyncStorage();
  return SecureStore.getItemAsync(STORAGE_KEYS.refresh);
}

/** Saves tokens. With refresh-token rotation the server returns a new refresh token each time. */
export async function saveTokens(access: string, refresh?: string) {
  await SecureStore.setItemAsync(STORAGE_KEYS.access, access);
  if (refresh) await SecureStore.setItemAsync(STORAGE_KEYS.refresh, refresh);
}

export async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.access),
    SecureStore.deleteItemAsync(STORAGE_KEYS.refresh),
    AsyncStorage.removeItem(STORAGE_KEYS.access),
    AsyncStorage.removeItem(STORAGE_KEYS.refresh),
  ]);
}
