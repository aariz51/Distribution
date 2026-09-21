import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Distribution — one product profile, every cut",
  description:
    "Describe your product once. Distribution turns it into a launch film, short clips, thumbnails, per-platform copy and a publishing schedule.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
