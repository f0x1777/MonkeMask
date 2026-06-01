import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata = {
  title: "MonkeMask — MonkeDAO",
  description:
    "Cover faces in a photo with monkes — privacy for MonkeDAO event photos.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
