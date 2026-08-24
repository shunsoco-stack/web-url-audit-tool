import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WebサイトURL一括チェック・リンク監査ツール",
    short_name: "SiteScope",
    description:
      "HTTP・Redirect・Metadata・内部リンクを一括検査するWebサイト監査ツール",
    start_url: "/",
    display: "standalone",
    background_color: "#050a12",
    theme_color: "#07111f",
    lang: "ja",
    orientation: "any",
    categories: ["business", "productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
