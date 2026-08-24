import { ArrowLeft, Link2Off } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="audit-message-page">
      <div className="audit-message-card">
        <span className="audit-message-card__icon"><Link2Off aria-hidden="true" /></span>
        <p className="audit-section-kicker">404 · NOT FOUND</p>
        <h1>このURLは見つかりません</h1>
        <p>指定されたページは移動または削除された可能性があります。監査ワークスペースへ戻ってください。</p>
        <Link className="audit-button audit-button--primary" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> 監査画面へ戻る
        </Link>
      </div>
    </main>
  );
}
