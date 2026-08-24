"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="audit-message-page">
      <div className="audit-message-card">
        <span className="audit-message-card__icon audit-message-card__icon--error">
          <AlertTriangle aria-hidden="true" />
        </span>
        <p className="audit-section-kicker">WORKSPACE ERROR</p>
        <h1>監査画面を表示できませんでした</h1>
        <p>一時的な画面エラーが発生しました。入力内容を確認して、もう一度お試しください。</p>
        <button className="audit-button audit-button--primary" type="button" onClick={reset}>
          <RefreshCw size={16} aria-hidden="true" /> もう一度表示
        </button>
      </div>
    </main>
  );
}
