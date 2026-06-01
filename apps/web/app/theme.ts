// MonkeDAO brand palette (from resource/monkeDAOcolors.txt).
export const brand = {
  darkGreen: "#184623",
  green: "#4A8F5D",
  lightGreen: "#86C994",
  yellow: "#FFC919",
  ivory: "#F3EFCD",
  white: "#FFFFFF",
  darkBlue: "#0033A1",
  blue: "#2F8DCC",
  lightBlue: "#90C6EA",
} as const;

// Semantic roles used across the UI.
export const ui = {
  bg: brand.darkGreen,
  panel: "#1f5630", // a step lighter than darkGreen for cards
  panelBorder: "#2c6b40",
  text: brand.ivory,
  ivory: brand.ivory,
  textDim: "rgba(243,239,205,0.72)",
  accent: brand.yellow,
  accentText: brand.darkGreen,
  good: brand.lightGreen,
  danger: "#b4452f",
  selected: brand.yellow,
} as const;
