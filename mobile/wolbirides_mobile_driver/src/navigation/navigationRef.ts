import { createNavigationContainerRef } from "@react-navigation/native";

// Lets code outside screens (push-notification taps) navigate.
export const navigationRef = createNavigationContainerRef<any>();
