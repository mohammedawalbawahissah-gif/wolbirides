/** Per-app settings shared by the auth and API layers. */
export const APP_ROLE = "driver" as const;

export const STORAGE_KEYS = {
  access: "wolbirides_driver_access",
  refresh: "wolbirides_driver_refresh",
  user: "wolbirides_driver_user",
};

export const COPY = {
  signInTitle: "Welcome back, rider.",
  signInSubtitle: "Go online, accept rides, and get paid.",
  signUpTitle: "Earn with WolbiRides.",
  signUpSubtitle: "Sign up, then submit your licence and vehicle for verification.",
};
