import type { ReactNode } from "react";

export const metadata = {
  title: "MonkeMask",
  description: "Cover faces in a photo with monkes — privacy for MonkeDAO event photos.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0f1a38",
          color: "#e8eefc",
        }}
      >
        {children}
      </body>
    </html>
  );
}
