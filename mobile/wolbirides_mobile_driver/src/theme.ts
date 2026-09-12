export const colors = {
  navyInk: "#16233F",
  gold: "#B8860B",
  goldSoft: "#E8C766",
  paper: "#F6F5F1",
  paperRaised: "#FFFFFF",
  ink: "#1B1F27",
  inkMuted: "#5B6472",
  line: "#E1DFD7",
  success: "#2F7D5D",
  successBg: "#E7F2EC",
  danger: "#B23A2F",
  dangerBg: "#FBEBE9",
  warning: "#A66A1E",
  warningBg: "#FBF0DF",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const typography = {
  h1: { fontSize: 26, fontWeight: "700" as const, color: colors.ink },
  h2: { fontSize: 17, fontWeight: "700" as const, color: colors.ink },
  body: { fontSize: 15, color: colors.ink },
  muted: { fontSize: 13.5, color: colors.inkMuted },
};
