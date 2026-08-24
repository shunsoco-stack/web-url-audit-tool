import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const appName = "WebサイトURL一括チェック・リンク監査ツール";

export const metadata: Metadata = {
  title: `${appName} | SiteScope`,
  description:
    "URL一覧と内部リンクを安全に巡回し、HTTP Status・Redirect・Metadata・SEO課題を一括確認できるWeb監査ツール。",
  applicationName: appName,
  category: "業務効率化ツール",
  keywords: [
    "URLチェック",
    "リンク切れチェック",
    "Webサイト監査",
    "SEO監査",
    "Redirect確認",
  ],
  authors: [{ name: "SiteScope" }],
  creator: "SiteScope",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07111f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
