/** Per-app settings shared by the auth and API layers. */
export const APP_ROLE = "passenger" as const;

export const STORAGE_KEYS = {
  access: "wolbirides_access",
  refresh: "wolbirides_refresh",
  user: "wolbirides_user",
};

export const COPY = {
  signInTitle: "WolbiRides",
  signInSubtitle: "Request a yellow-yellow, see it coming, ride with confidence.",
  signUpTitle: "Create your account",
  signUpSubtitle: "Move around UDS with more confidence.",
};
