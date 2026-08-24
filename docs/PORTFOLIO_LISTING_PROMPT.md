# ポートフォリオ掲載用 完全版プロンプト

以下をそのまま既存ポートフォリオサイトの編集・UI実装担当へ渡してください。

---

あなたは、Web業務効率化ツールのポートフォリオ編集・UI実装担当です。以下の実装済み事実、指定URL、指定画像だけを使い、「WebサイトURL一括チェック・リンク監査ツール」の一覧カードと詳細ページを追加してください。

読者は採用担当者、開発責任者、Web制作会社、SEO担当者、サイト運用担当者、社内Web担当者を想定します。日本語を中心に、一読で「URLを開けるか確認するだけではなく、入力・Crawl・HTTP・Redirect・Metadata・Issue分類・Filter・再チェック・比較・ExportまでつながるWeb監査Workflow」だと分かる構成にしてください。

## 1. 固定メタデータ

- 作品名：WebサイトURL一括チェック・リンク監査ツール
- 英語補助名：SiteScope — URL Audit Workspace
- Slug：`web-url-audit-tool`
- カテゴリ：業務効率化ツール
- サブカテゴリ：Web監査・リンクチェック
- 対応：Web / Desktop / Tablet / Smartphone
- 専用アイコン：Globe + Link + Check
- App icon Path：`web-url-audit-tool/src/app/icon.svg`
- 実アプリURL：[https://web-url-audit-tool.vercel.app](https://web-url-audit-tool.vercel.app)
- Vercel Deployment ID：`dpl_3G5NnbMZhC2BXDDgMC3C2YekR5Pi`
- GitHub URL：[https://github.com/shunsoco-stack/web-url-audit-tool](https://github.com/shunsoco-stack/web-url-audit-tool)
- README URL：[https://github.com/shunsoco-stack/web-url-audit-tool/blob/main/README.md](https://github.com/shunsoco-stack/web-url-audit-tool/blob/main/README.md)
- Repository内README Path：`web-url-audit-tool/README.md`
- QA Path：`web-url-audit-tool/docs/QA.md`
- Production verification command：`npm run verify:production -- https://web-url-audit-tool.vercel.app`
- UI表示言語：日本語中心、HTTP / SEO用語は英語Labelを併記
- 判定方式：通常のRule-based code。AIは不使用

実アプリ、GitHub、READMEへのLinkは、掲載時に到達確認してください。未公開・404の場合に別URLを推測して置き換えず、公開担当へ確認してください。

## 2. この作品の要約

本作品は、URL一覧またはサイトの起点URLから、HTTP Status、Final URL、Redirect Count / Chain、Response Time、Title、Description、Canonical、H1、内部・外部Link、基本SEO Issueを一括確認するWebサイト監査ツールです。

Browser CORSを避けるため、検査はNext.jsのNode.js Route Handler経由で行います。任意URLへRequestするBackendには、Protocol・Port・Host・IPv4 / IPv6・DNS answer・Redirect先を検証するSSRF policy、Timeout、本文取得上限、Redirect上限、簡易Rate Limitを実装しています。

単なるLink openerではありません。結果をDashboardで集計し、Broken / Redirect / Slow / Missing Metadata / Internal / ExternalをFilterし、Errorだけを再チェックし、前回との差分を比較し、CSV / XLSXへ書き出します。

## 3. 課題と解決

### 課題

- サイト公開・移行後の確認では、URLごとにBrowserを開いてStatusやRedirect先を見る作業が発生する。
- 301 / 302が複数段続くと、最終到達先と途中のChainを見落としやすい。
- 404 / 410、5xx、遅いPage、Metadata欠落が別々の確認作業になりやすい。
- 起点URLから内部Linkを洗い出し、同じ基準でCheckするには手作業が多い。
- Browserから任意Domainへ直接fetchするとCORSに阻まれる。
- Backend経由のURL fetchは、SSRFと対象Siteへの過負荷を考慮しないと危険である。
- Check結果があっても、Errorだけの再確認、前回との差分、報告用Exportまでつながらないと実務が完了しない。

### 解決

- Manual / Paste / CSV / Crawlの4入力を1つのWorkspaceへ統合。
- BackendでHTTP(S)を検査し、Final URL、最大8 Redirect、Loop、Hop別Response Timeを取得。
- HTMLからMetadataとAnchor Linkを抽出し、Rule-based Issueを作成。
- 404 / 410をBroken専用Viewに分離し、Errorだけを再チェック可能にする。
- 同一Origin BFS CrawlをDepth 0〜3、最大100 URL、同時3 Requestへ制限。
- SSRF policyとrobots.txt policyを各URLへ適用。
- 最新SnapshotをBrowser localStorageへ保存し、新規Broken、修復済み、新規Redirectを比較。
- CSV / XLSXで監査結果を持ち出せるようにする。

## 4. 完成Workflow

次の順序と意味を崩さず掲載してください。

```text
URLs
↓
Crawl
↓
HTTP Check
↓
Metadata
↓
Issue Classification
↓
Filter / Search
↓
Recheck / Compare
↓
CSV / XLSX Export
```

各Stepがどの実務に役立つかを説明してください。

- URLs：手入力、複数Paste、CSVから対象をまとめる。
- Crawl：起点URLの同一Origin内部Linkを上限制御付きで収集する。
- HTTP Check：Status、Final URL、Redirect、Response TimeをBackendで実測する。
- Metadata：Title、Description、Canonical、H1とLinkをstatic HTMLから抽出する。
- Issue Classification：Broken、Server Error、Slow、Metadata欠落、Duplicate Title等を通常コードで分類する。
- Filter / Search：大量Resultから対応対象を絞る。
- Recheck / Compare：Errorの再測定と前回差分で修正確認を行う。
- Export：CSV / XLSXをQA報告や制作チームの共有へ使う。

## 5. 実装済み機能

### Input

- URL手入力
- 改行、空白、Tab区切りの複数URL Paste
- CSV file選択 / Drag & Drop
- URL列Header自動検出と、URL形式に見える列へのFallback
- Protocol補完、blank除去、重複除去
- 1回の監査で最大100 URL

### HTTP Check

- HTTP Status
- Status Label
- Final URL
- Redirect Count
- Redirect Chain
- Redirect Loop
- Redirect上限超過
- Hop別および合計Response Time
- Content-Type
- Check日時

Response TimeはRequest開始からResponse Header受信までの値であり、Browser rendering時間やCore Web Vitalsではありません。

### Status / Issue

- 2xx：正常
- Redirect経由または3xx：Redirect
- 4xx：Client Error
- 5xx：Server Error
- 404：`BROKEN_404`、Broken Link
- 410：`GONE_410`、Broken Link
- Redirect Loop：`REDIRECT_LOOP`
- Redirect上限超過：`REDIRECT_LIMIT`
- Private target等：`BLOCKED_TARGET`
- robots拒否：`ROBOTS_BLOCKED`
- 不正URL：`INVALID_URL`
- 接続 / TLS / Timeout等：`REQUEST_FAILED`

色だけでなくHTTP値、Label、Issue名を併記します。

### Metadata / SEO Quality

- Title
- Meta Description
- Canonical
- 最初のH1
- H1件数
- Anchor Text
- 内部 / 外部Link
- Missing Title
- Missing Description
- Missing Canonical
- Missing H1
- Duplicate Title
- user設定Thresholdを超えたSlow Response

AIによる生成・分類・予測はありません。

### Crawl

- 同一Originの内部LinkをBFSで探索
- Depth 0〜3
- 最大5〜100 URL
- Client concurrency 3
- robots.txt尊重を既定で有効化
- URL fragmentと重複を除外
- `rel="nofollow"` を探索対象外にする
- 外部Linkは表示するがqueueに追加しない
- 停止後も完了済みResultを保持

### Dashboard / Search / Filter

- Total
- OK
- Redirect
- Broken
- Server Error
- Slow
- Missing Metadata
- Broken専用View
- Status Filter
- Broken / Redirect / Slow / Missing Title / Missing Metadata Filter
- Internal / External Filter
- URL、Final URL、Title、Description、H1、Issue検索

### Detail / Recheck / Compare

- Redirect ChainとFinal URLの詳細Drawer
- Metadataと発見Linkの詳細
- Error URLだけを一括再チェック
- 単一URLを詳細から再チェック
- localStorageの直前Snapshotと比較
- 新規404 / 410、修復済み、新規Redirect

### Export

- UTF-8 BOM付きCSV
- XLSXの `Audit Results` / `Issues` 2 sheet
- Input / Final URL、Status、Redirect Chain、Response Time、Metadata、Link数、Issue、日時
- CSV quote / escape
- 先頭 `=` / `+` / `-` / `@` に対するSpreadsheet Formula Injection対策

## 6. Demoは架空Resultではなく実HTTP

この点を作品の信頼性として明確に説明してください。

Demo Modeは、完成済みに見せるための固定Result Objectやmock JSONをDashboardへ直接入れていません。Productionと同じOriginの専用fixture Routeへ、通常と同じ `/api/check` 経由でBackendから実際にHTTP Requestを送り、Status、Redirect、Metadata、Response Timeを測定します。

UI Demoの7 Target:

| Target | 確認できること |
| --- | --- |
| `/api/demo/site/home` | 200、完全Metadata、H1、内部・外部Link |
| `/api/demo/site/about` | 200、Duplicate Title、Description欠落 |
| `/api/demo/site/missing-metadata` | Title / Description / Canonical / H1欠落 |
| `/api/demo/redirect/start` | 301 → 302 → 200 |
| `/api/demo/status/404` | 実HTTP 404 |
| `/api/demo/status/410` | 実HTTP 410 |
| `/api/demo/status/500` | 実HTTP 500 |

Production verifierは追加でRedirect Loop、Invalid URL、Private IP Blockも確認します。

Demo内の架空企業名「株式会社ミナト」は専用fixtureのHTML内容です。実在企業、導入顧客、制作実績、稼働実績として紹介しないでください。

## 7. Security / Safetyの技術的な核

### SSRF policy

- HTTP / HTTPSだけを許可
- URL長2,048文字上限
- credentials入りURLを拒否
- Port 80 / 443だけを許可
- localhost、single-label host、`.local`、`.internal`、`.home`、`.lan`、`.corp`等を拒否
- Private、loopback、link-local、reserved、documentation、multicast等のIPv4 / IPv6 rangeを拒否
- Cloud metadata向けHostとlink-local endpointを拒否
- DNSの全Answerがpublicの場合だけ許可
- 検証済みAddressへ接続し、Host HeaderとTLS SNIは元Hostnameを使用
- Redirect各Hopでpolicyを再実行

### Load / resource controls

| Control | 実装値 |
| --- | ---: |
| Client concurrency | 3 |
| Backend active checks | 最大6 |
| Same-origin active checks | 最大3 |
| Crawl max URLs | 100 |
| Crawl max Depth | 3 |
| DNS resolution timeout | 5秒 |
| Outbound Timeout per Hop | 10秒 |
| Audit deadline per URL | 24秒 |
| Vercel Function max duration | 30秒 |
| Redirect limit | 8 |
| HTML Body limit | 1,500,000 byte |
| Response Header limit | 32 KiB |
| API JSON Body limit | 16 KiB |
| API in-memory rate bucket | 60 Request / 60秒 / Client Key |
| robots.txt Body limit | 128 KiB |
| robots.txt cache | 最大128 Origin / TTL 10分 |

### robots.txt

- Crawl時に既定で有効
- Bot固有Group優先
- 最長一致、同長はAllow優先
- wildcardと末尾anchor対応
- 404はAllow
- 401 / 403 / 5xx、取得失敗はFail-closedでDeny
- Redirect先を含むRequest対象ごとにpolicyを確認
- Bodyは128 KiBまで取得し、cacheは最大128 Origin、TTL 10分

### 説明上の注意

「SSRF対策を実装」と説明できますが、「SSRFを完全防止」「脆弱性診断済み」「安全性を保証」「WAF相当」とは書かないでください。API Rate LimitとBackend同時Check counterはFunction instanceのmemory上にあるbest-effort制御で、複数Instanceで共有される分散型・永続型の制御ではありません。robots.txtは利用許可や法令判断の代替ではありません。

## 8. Architecture / Technology

```text
React Client Workspace
├─ Manual / Paste / CSV
├─ BFS Crawl queue
├─ concurrency 3 progress
├─ Dashboard / Filter / Drawer
├─ localStorage latest snapshot
└─ CSV / XLSX export
        │
        ▼ POST /api/check
Next.js Node.js Route Handler
├─ payload validation / no-store / best-effort rate bucket
├─ SSRF policy / DNS validation / address pinning
├─ robots.txt policy
├─ HTTP(S) / Redirect / Loop / Timeout
└─ static HTML Metadata / Link extraction
```

Tech Stack:

- Next.js 16.3 / App Router
- React 19.2
- TypeScript 5.9
- Node.js 24
- Node native HTTP / HTTPS / DNS
- Vercel Functions
- SheetJS XLSX
- Lucide React
- Vitest 4 / Testing Library / jsdom
- ESLint 9

Database、外部AI API、認証Provider、Queue、Headless Browserは使用していません。

## 9. Test / Verification

READMEとQAへLinkし、検証内容を過大に言わず掲載してください。

- Unit / module Test：Input、CSV、Metadata、Link、Result集計、Compare、Export、SSRF IPv4 / IPv6、DNS policy、robots parser、API input validation
- Production integration verifier：8 case
  - 200 + Metadata
  - 301 → 302 → 200
  - 404
  - 410
  - 500
  - Redirect Loop
  - Invalid URL
  - Private IP Block
- Local verification：`npm run verify`
- Production verification：`npm run verify:production -- https://web-url-audit-tool.vercel.app`
- Unit / module result：8 Test file、126 / 126 Pass
- Production integration result：8 / 8 Pass
- Verified Deployment：`dpl_3G5NnbMZhC2BXDDgMC3C2YekR5Pi`

掲載ページでは上記の実測値を使用し、詳細な実行記録は `web-url-audit-tool/docs/QA.md` を参照してください。将来の更新時は、再検証せずに件数やPassを引き継がないでください。

## 10. Responsive / Accessibility / Design

- Desktop-firstの情報密度
- Tablet / Smartphoneで入力・Dashboard・Filterを再配置
- Result Tableは必要に応じ横Scroll
- Apple DesignのSafety / Predictability、Agency、Simplicityを重視
- System font、落ち着いたDark Navy / Blue / Cyan、Translucent Material
- 抑制したMotionと即時のPress Feedback
- Statusは色だけでなく数値・Label・Issue名
- Visible keyboard focus
- Semantic form、table、dialog
- DrawerのEscape、focus trap、focus return
- Blocked URLをexternal linkにしない
- coarse pointerの主要操作領域44px
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`

WCAGの特定Levelへの準拠や認証取得を主張しないでください。

## 11. 使用する画像と順序

画像は下記5点をこの順序で使用してください。すべてVercel Productionの安全な実HTTP Demoから取得したものです。存在しない画像を生成したり、架空Resultを合成したりしないでください。

画像の自然寸法は取得後の実Fileを使用し、数値を推測して記載しないでください。UIのURL、Status、Metadata、Issueが読めるよう、詳細ページでは原則 `object-fit: contain` を使ってください。

### 1. Audit Dashboard — メイン画像 / 一覧Card thumbnail

- Repository Path：`web-url-audit-tool/docs/screenshots/01-audit-dashboard.png`
- このPromptからの相対Link：[01-audit-dashboard.png](screenshots/01-audit-dashboard.png)
- Caption：URL品質をStatus・Broken・速度・Metadataで俯瞰するAudit Dashboard
- Alt：Total、OK、Redirect、Broken、Server Error、Slow、Metadataを表示するWebサイト監査Dashboard
- 用途：詳細Heroのメイン画像、一覧Card thumbnail

### 2. URL Result Table

- Repository Path：`web-url-audit-tool/docs/screenshots/02-url-result-table.png`
- このPromptからの相対Link：[02-url-result-table.png](screenshots/02-url-result-table.png)
- Caption：InputからFinal URL、Issueまでを横断確認する監査結果
- Alt：HTTP Status、Input URL、Final URL、Title、内部外部Link、Redirect、Response Time、Issueを一覧表示するURL監査結果Table
- 用途：HTTP Check / Filter機能セクション

### 3. Broken Links

- Repository Path：`web-url-audit-tool/docs/screenshots/03-broken-links.png`
- このPromptからの相対Link：[03-broken-links.png](screenshots/03-broken-links.png)
- Caption：404と410を対応対象として独立表示するBroken Links View
- Alt：404と410をBroken Links専用Viewで独立表示しError対象だけを再チェックできる画面
- 用途：Issue Classification / Recheckセクション

### 4. Redirect / Metadata Detail

- Repository Path：`web-url-audit-tool/docs/screenshots/04-redirect-metadata-detail.png`
- このPromptからの相対Link：[04-redirect-metadata-detail.png](screenshots/04-redirect-metadata-detail.png)
- Caption：Redirectの途中経路とSEO Metadataを同じURL Detailで確認
- Alt：301から302を経て200へ到達するRedirect ChainとTitle、Description、Canonical、H1を表示する監査詳細Drawer
- 用途：Redirect Chain / Metadataセクション

### 5. Export / Crawl Progress

- Repository Path：`web-url-audit-tool/docs/screenshots/05-export-crawl-progress.png`
- このPromptからの相対Link：[05-export-crawl-progress.png](screenshots/05-export-crawl-progress.png)
- Caption：上限制御された内部Link Crawlを実進捗からReport出力までつなぐ
- Alt：実URL進捗、Concurrency 3、Depth、robots設定とCSV・XLSX出力操作を示すWeb監査Workspace
- 用途：Crawl / Safety / Exportセクション

## 12. 掲載Copy

### 一覧Card

タイトル：WebサイトURL一括チェック・リンク監査ツール

カテゴリ表示：業務効率化ツール / Web監査・リンクチェック

短文：URL一覧と内部Linkを安全に巡回し、HTTP・Redirect・Metadata・Issue分類から再チェック・出力までつなぐWeb監査ツール。

タグ候補：`Next.js` `TypeScript` `URL Audit` `Link Checker` `SEO` `Crawler` `SSRF Protection` `Vercel Functions` `CSV` `XLSX`

Thumbnail：`web-url-audit-tool/docs/screenshots/01-audit-dashboard.png`

### 詳細Page Hero

Eyebrow：WEB QUALITY CONTROL

見出し：URL確認を、公開品質の判断までつなぐ。

リード：URL一覧または起点URLから、HTTP Status、Redirect Chain、Response Time、Metadata、内部・外部Linkを一括検査。Broken Linkの切り分け、Error再チェック、前回比較、CSV / XLSX出力まで、Web制作とサイト移行後の監査Workflowを1つにまとめました。

Primary CTA：`実アプリでDemo監査を試す`

Primary CTA URL：`https://web-url-audit-tool.vercel.app`

Secondary CTA：`GitHubで実装を見る`

Secondary CTA URL：`https://github.com/shunsoco-stack/web-url-audit-tool`

Tertiary text link：`READMEを読む`

README URL：`https://github.com/shunsoco-stack/web-url-audit-tool/blob/main/README.md`

### 課題Section

見出し：開けるかだけでは、公開品質は分からない。

本文：200か404かに加え、Redirectの途中経路、遅い応答、TitleやCanonicalの欠落、内部Linkの取りこぼしまで確認して初めて、公開・移行後の品質を判断できます。URLごとの手作業を、再現可能な監査Resultへ変える必要がありました。

### 解決Section

見出し：入力から再確認・Reportまで、ひと続きに。

本文：Manual、Paste、CSV、内部Link Crawlから対象を集め、BackendでHTTPとRedirectを実測。MetadataとIssueを分類し、Dashboard、Filter、Broken専用View、再チェック、前回比較、CSV / XLSXへ同じResultをつなぎます。

### Security Section

見出し：任意URLを扱うから、安全設計を機能にする。

本文：HTTP(S)・80 / 443だけを許可し、localhost、Private / link-local / reserved IP、metadata endpoint、内部向けHost、DNSのmixed answerを拒否。Redirect先も各Hopで検証し、Timeout、取得量、Redirect、Concurrency、Crawl範囲を明示的に制限しています。

### Demo Section

見出し：Demoも、実際のHTTP Responseから作る。

本文：Demo Datasetは固定された架空Resultではありません。同じProduction Originの専用fixtureへ通常の監査APIからRequestし、200、301 → 302、404、410、500、Metadata欠落を実測します。

Demo注記：Fixture内の会社名とPage内容は架空です。Status、Redirect、Metadata、Response TimeはDemo実行時の実HTTP Responseから取得します。

### Export Section

見出し：見つけて終わらず、修正確認と共有へ。

本文：Error URLだけを再チェックし、前回との新規Broken・修復済み・新規Redirectを比較。最終ResultはCSV / XLSXへ出力し、制作チームの修正一覧やQA報告へつなげられます。

## 13. 詳細Pageの推奨構成

1. カテゴリ、作品名、Hero Copy、専用Icon、CTA、Audit Dashboard画像
2. 課題：「開けるかだけでは、公開品質は分からない」
3. Workflow：URLs → Crawl → HTTP → Metadata → Issue → Filter → Recheck → Export
4. Audit DashboardとStatus / Broken分類
5. URL Result TableとFilter / Search
6. Broken LinksとError-only Recheck
7. Redirect / Metadata Detail
8. 内部Link Crawl、robots、Concurrency、Progress
9. SSRF / Timeout / 上限制御のArchitecture
10. Compare RunsとCSV / XLSX Export
11. 実HTTP Demo Dataset
12. Tech Stack、Test、Production verification
13. Responsive / Accessibility
14. Known Limitations、実アプリ / GitHub / README CTA

画像は装飾として並べず、「どの確認・判断に使う画面か」が分かるCaptionを付けてください。Securityは末尾の小さな注記だけにせず、任意URLを扱う本作品の主要な技術設計として独立Sectionにしてください。

## 14. Known Limitationsとして掲載する内容

- 監査権限や対象Siteの利用規約を自動判定しない。権限のある対象に限定する。
- JavaScriptを実行しないため、Client rendering後だけに現れるLink / Metadataは取得しない。
- Anchor Linkだけを探索し、Sitemap、Asset、Form action、Headless Browserは対象外。
- 認証付きPage、Cookie session、custom Header、Private Network、80 / 443以外のPortは非対応。
- HTML本文は先頭1.5 MBまで。圧縮応答を解析しない場合がある。
- Response TimeはResponse Header到達までで、Core Web Vitalsではない。
- robots.txt対応は主要Ruleで、全Crawler拡張の完全実装ではない。
- Rate Limitはinstance-localのbest-effort。
- Compareは同一Browserの最新localStorage Snapshotだけ。Server履歴・共有なし。
- 外部Linkは検出するがCrawl queueへ追加しない。
- 脆弱性診断、Penetration Test、WCAG認証を完了したとは主張しない。

## 15. 禁止事項

- 「URLを開くか確認するだけのツール」と表現しない。
- AIがStatus、SEO品質、Issueを判定していると書かない。
- Demo Resultがmock / fixed JSONだと書かない。逆に、Fixtureの会社や内容を実在・導入実績と書かない。
- 実在顧客、利用者数、改善率、工数削減率、処理速度、ROIを捏造しない。
- SSRFを完全防止、脆弱性診断済み、WAF搭載、Security保証済みと書かない。
- Rate Limitを分散型・永続型と書かない。
- robots.txt対応をCrawl許可・法的許可の保証と書かない。
- Response TimeをPageSpeed、LCP、Core Web Vitals、Browser rendering時間と表現しない。
- JavaScript rendering、Sitemap Crawl、Image / CSS / Script監査、認証Page監査が実装済みと書かない。
- Account、Cloud Database、チーム共有、複数Run履歴、定期実行、通知が実装済みと書かない。
- 外部Linkを自動Crawl・全件Checkすると書かない。
- 100 URL、Depth 3、Redirect 8、Concurrency 3、Timeout等の上限を消さない。
- 実測していない最終Test件数、Production Pass、Screenshot寸法を推測しない。
- 存在しないScreenshot、Chart、画面、Metricを生成しない。
- 画像のStatus、URL、Metadata、Issue値を書き換えない。
- 実アプリ、GitHub、README URLを別URLへ推測変更しない。
- 特定WCAG Level準拠、全Browser対応、全Site対応と断定しない。

## 16. 受入基準

- [ ] 作品名が「WebサイトURL一括チェック・リンク監査ツール」である。
- [ ] カテゴリが「業務効率化ツール」、サブカテゴリが「Web監査・リンクチェック」である。
- [ ] Globe + Link + Checkの専用Iconを使用している。
- [ ] 一覧Cardと詳細Pageの両方を追加している。
- [ ] 実アプリ、GitHub、READMEの3 Linkが正しい。
- [ ] 5 Screenshotを指定順・指定Pathで使用している。
- [ ] 各画像に指定Captionと具体的なAltがある。
- [ ] 一覧Card thumbnailは01 Audit Dashboardである。
- [ ] URLs → Crawl → HTTP → Metadata → Issue → Filter → Recheck → ExportのWorkflowがHero近くで分かる。
- [ ] Manual、Paste、CSV、Crawlの4入力を説明している。
- [ ] HTTP Status、Final URL、Redirect Count / Chain、Response Timeを説明している。
- [ ] 404 / 410をBrokenとして独立表示することが分かる。
- [ ] Title、Description、Canonical、H1、内部 / 外部Linkを説明している。
- [ ] Missing MetadataとDuplicate TitleがRule-basedである。
- [ ] Depth 0〜3、最大100 URL、Concurrency 3、robots既定有効を明記している。
- [ ] SSRF policyを主要な技術設計として具体的に説明している。
- [ ] Redirect各Hopの再検証、10秒Hop Timeout、24秒Deadline、8 Redirect、1.5 MB本文上限が正しい。
- [ ] Demoが架空ResultではなくProduction同一Originの実HTTP fixtureを通常API経由で測定することを明記している。
- [ ] Error-only Recheck、前回比較、CSV / XLSXを説明している。
- [ ] Test / Production verificationはQAの実測結果だけを使用している。
- [ ] ResponsiveとAccessibilityを保証しすぎず具体的に説明している。
- [ ] Known Limitationsと禁止事項に反する表現がない。

最終成果物は、一覧Cardと詳細Pageで事実・用語・URL・画像を統一し、閲覧者が「Web公開・移行後の品質確認を、入力から修正確認・Reportまで安全に効率化する実装」と理解できる状態にしてください。

---
