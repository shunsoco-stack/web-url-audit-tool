export default function Loading() {
  return (
    <main className="audit-loading" aria-label="監査ツールを読み込み中" aria-busy="true">
      <div className="audit-loading__bar">
        <span className="audit-loading__brand" />
        <span className="audit-loading__pill" />
      </div>
      <div className="audit-loading__hero">
        <span />
        <strong />
        <strong />
        <p />
      </div>
      <div className="audit-loading__console">
        <span className="audit-loading__title" />
        <div className="audit-loading__tabs">
          <i /><i /><i /><i />
        </div>
        <div className="audit-loading__field" />
        <div className="audit-loading__actions"><i /><i /></div>
      </div>
      <span className="sr-only">読み込み中です</span>
    </main>
  );
}
