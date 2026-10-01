import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

export type MainTabParamList = {
  Ride: undefined;
  History: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined | { screen: string };
  Notifications: undefined;
  Assistant: { tripId?: string; label?: string; message?: string } | undefined;
  TripStatus: { tripId: string };
  // WR-13: "Ride again" from History pre-fills the route.
  BookRide: { initialKind?: "ride" | "delivery"; rebook?: { pickup: { lat: number; lng: number; label: string }; destination: { lat: number; lng: number; label: string } } } | undefined;
  RateDriver: undefined;
  Support: undefined;
};

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
