import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dock",
  description: "Dock - Google Drive and Discord Bridge Service",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "sans-serif", background: "#0e1015", color: "#f3f4f6" }}>
        {children}
      </body>
    </html>
  );
}
