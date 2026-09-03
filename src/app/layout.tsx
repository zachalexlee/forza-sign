import type { Metadata } from "next";
import { Inter, Rajdhani } from "next/font/google";
import "./globals.css";

// Brand type (design system 03): Rajdhani for product UI display, Inter for
// body. Saira Condensed is marketing-only and Orbitron stat-only — neither
// belongs in the product bundle.
const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const rajdhani = Rajdhani({
  variable: "--font-display-face",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Forza Sign",
    template: "%s · Forza Sign",
  },
  description: "Worksheets and e-signatures for Forza Payments",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${rajdhani.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
