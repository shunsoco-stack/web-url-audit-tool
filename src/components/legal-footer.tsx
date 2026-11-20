import Link from "next/link";

export function LegalFooter() {
  return (
    <footer
      className="ninja-legal-footer"
      style={{ textAlign: "center", padding: "16px 12px 32px", fontSize: 12, lineHeight: 1.7, opacity: 0.78 }}
    >
      <Link href="/privacy">プライバシーポリシー</Link>
    </footer>
  );
}
