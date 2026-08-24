# QA / Release Verification

この文書は「WebサイトURL一括チェック・リンク監査ツール」の自動Test、Production API検証、手動Browser QA、Screenshot取得を1か所で管理するRelease記録です。

> `DEVELOPMENT_RULES.md` はワークスペース内を検索しましたが存在しませんでした。そのため、このReleaseではRepository内の `AGENTS.md` とProject固有設定を適用しています。

## Release Status

確認時刻はJSTです。未実施項目はPass扱いにせず、明示的に「保留」または「未実施」と記録します。

| 項目 | 最終結果 | 実行日時 | 実行環境 / 補足 |
| --- | --- | --- | --- |
| `npm run lint` | **PASS** | 2026-08-24 JST | ESLint error 0 |
| `npm run typecheck` | **PASS** | 2026-08-24 JST | `next typegen && tsc --noEmit` error 0 |
| `npm run test` | **PASS** | 2026-08-24 JST | **Test Files: 8 / Tests: 126 / Passed: 126 / Failed: 0** |
| `npm run build` | **PASS** | 2026-08-24 JST | Next.js Production build成功 |
| `npm run verify` | **PASS** | 2026-08-24 23:30頃 | lint → typecheck → 126 Test → Production buildを単一commandで完走 |
| Vercel Production Deploy | **PASS** | 2026-08-24 23:22頃 | [Production](https://web-url-audit-tool.vercel.app) / `dpl_3G5NnbMZhC2BXDDgMC3C2YekR5Pi` |
| Production API verifier | **PASS** | 2026-08-24 23:22頃 | **Passed: 8 / 8, Failed: 0**（4,111 ms） |
| Production Browser QA | **PASS（確認範囲）** | 2026-08-24 23:22–23:25頃 | Production実機、1280 × 720 / 768 × 1024 / 390 × 844 |
| GitHub公開・Secret Scan | **保留（公開前）** | 2026-08-24 JST | Repository公開、Commit SHA、最終Secret Scanは未確認 |
| Screenshot 5枚 | **PASS** | 2026-08-24 23:25頃 | Production Demo / Crawlの実結果から5 / 5取得 |

### Final summary

```text
Automated checks: lint / typecheck / Vitest / build PASS
npm run verify (single command): passed
Test Files: 8
Tests: 126
Passed: 126
Failed: 0

Production URL: https://web-url-audit-tool.vercel.app
Production deployment ID: dpl_3G5NnbMZhC2BXDDgMC3C2YekR5Pi
Production page HTTP: 200
Production API verification: 8/8 passed
GitHub URL: pending publication (planned: https://github.com/shunsoco-stack/web-url-audit-tool)
Screenshot files: 5/5 present
```

## Automated Verification

### Commands

```bash
npm ci
npm run verify
```

`npm run verify` は次の順で実行されます。

```text
ESLint
→ Next route type generation
→ TypeScript no-emit check
→ Vitest
→ Next.js Production build
```

### Test scope

#### Input / CSV

- Protocol補完
- blank除去、重複除去、最初の出現順
- Space / Tab / CRLF / LFのPaste分割
- URL上限
- quoted comma、escaped quote、cell内改行
- Header名によるURL列検出
- Headerがない場合のURL形式列Fallback
- 安全なDemo URL 7件の生成

#### Metadata / Link

- Title、Description、Canonical、H1、H1件数
- HTML entity decode、空白normalize
- Canonicalの相対URL解決
- HTTP(S)以外のCanonical除外
- 内部 / 外部Link分類
- 重複Linkとfragmentの除去
- `rel="nofollow"` の除外
- Link数上限
- Metadata / Anchor Text長の上限
- Duplicate Title用normalize

#### Result rules

- Dashboard category集計
- Missing Metadata判定
- Duplicate Title ID
- Error-only recheck対象
- 新規Broken / 修復済み / 新規Redirect比較
- URL fragmentを除いたRun比較

#### Export

- UTF-8 BOM
- 全16列の順序
- Status、Link数、Issue、Redirect Chain
- comma、quote、newlineのlossless escape
- 攻撃者入力由来の全対象Fieldに対するSpreadsheet Formula Injection対策

#### SSRF policy

- Public IPv4 / IPv6の許可
- Loopback、private、link-local、reserved等のIPv4拒否
- Loopback、ULA、link-local、IPv4-mapped private等のIPv6拒否
- ftp / file scheme拒否
- credentials、unsafe port拒否
- localhost、内部用Host suffix、single-label host拒否
- 空、不正、長すぎるURLの拒否
- DNS全Answerがpublicの場合だけ許可
- Public / Private混在DNS answerをFail-closedで拒否
- DNS lookup失敗・空answerを拒否
- 検証済みpublic IP literalでは不要なDNS lookupを行わないこと

#### robots.txt

- 複数User-Agent group
- case-insensitive directive
- malformed lineの無視
- Bot固有Group優先
- 最長一致Rule
- 同長RuleでAllow優先
- wildcard、末尾anchor、query string
- 適用Ruleがない場合の許可

#### `/api/check`

- Unsupported Content-Typeを415
- Malformed JSON / invalid payloadを400
- Headerを信用せず16 KiB超Bodyを413
- source / depth / robots inputのsanitize・clamp
- `Cache-Control: no-store`

## Production API Verification

### Command

```bash
npm run verify:production -- https://web-url-audit-tool.vercel.app
```

このScriptはUI表示用の固定Resultを検証するのではなく、Productionの `/api/check` へPOSTし、Production自身の実HTTP fixtureをBackendから検査します。

| # | Case | Target | Expected | 最終結果 |
| ---: | --- | --- | --- | --- |
| 1 | 200 + Metadata | `/api/demo/site/home` | `200`、`ok`、Title / Description / Canonical / H1、positive Response Time | **PASS** |
| 2 | Redirect Chain | `/api/demo/redirect/start` | `301 → 302 → 200`、Redirect Count 2、正しいFinal URL | **PASS** |
| 3 | 404 | `/api/demo/status/404` | `404`、Broken `true`、`BROKEN_404` | **PASS** |
| 4 | 410 | `/api/demo/status/410` | `410`、Broken `true`、`GONE_410` | **PASS** |
| 5 | 500 | `/api/demo/status/500` | `500`、Server Error、`SERVER_ERROR` | **PASS** |
| 6 | Redirect Loop | `/api/demo/redirect/loop-a` | `302 → 302`、Loop `true`、`REDIRECT_LOOP` | **PASS** |
| 7 | Invalid URL | `not a valid URL` | Status `null`、`INVALID_URL` | **PASS** |
| 8 | Private IP Block | `http://127.0.0.1/` | Status `null`、Blocked、`BLOCKED_TARGET` | **PASS** |

```text
Production verification: 8 passed, 0 failed
Elapsed: 4111 ms

PASS 200 + Metadata
PASS Redirect Chain (301 → 302 → 200)
PASS 404
PASS 410
PASS 500
PASS Redirect Loop
PASS Invalid URL
PASS Private IP Block
```

Production rootもHTTP 200を返し、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()` を確認しました。

## Manual Browser QA

### Recommended environments

| Environment | Viewport | 結果 |
| --- | ---: | --- |
| Desktop Browser | 1280 × 720 | **PASS** — 横overflowなし |
| Tablet responsive | 768 × 1024 | **PASS** — 横overflowなし |
| Mobile responsive | 390 × 844 | **PASS** — 横overflowなし |
| Keyboard-only navigation | Desktop | **未実施** — semantic / unit実装確認のみで、実機通し操作は未確認 |
| Reduced motion | OS / DevTools設定 | **未実施** — CSS / JS実装済みだがProduction実機切替は未確認 |

Production Browserのconsoleは、Demo、Crawl、Filter、Detail、Export操作後もwarning / error 0件でした。

### Input flow

- [ ] URL手入力で1件監査できる。
- [ ] Protocolを省略したDomainへ `https://` が補完される。
- [ ] 複数URL Pasteで改行・空白・Tabを分割し、重複を除外する。
- [ ] CSVを選択またはDropし、URL列と件数を表示する。
- [ ] 空入力、URLを含まないCSV、2 MB超CSVで明確なErrorを表示する。
- [x] 安全なDemoボタンがProduction同一Originの7 URLを実際に検査する（7 / 7完了）。

### Progress / Crawl

- [x] 実行中に `checked / total URLs checked` が更新される。
- [x] 実行中URL、Concurrency 3、Slow thresholdが表示される。
- [ ] 停止操作後、完了済みResultが保持される。
- [x] Crawl Depth 0 / 1 / 2 / 3を選択できる。
- [x] 最大URL数を5〜100で設定できる。
- [x] robots.txt尊重が既定で有効である。
- [x] 同一Originの内部Link CrawlがProduction fixtureで6 / 6完了する。
- [ ] 外部Linkは発見数へ反映されるがCrawlされない。
- [x] Production fixtureのCrawlがDepth / URL上限内で6 / 6完了する。

### Dashboard / Results

- [x] Total / OK / Redirect / Broken / Server Error / Slow / Metadataを表示する。
- [x] HTTP値に加えて正常 / Redirect / Client Error / Server Error等のLabelがある。
- [x] Broken専用Viewで404 / 410だけが表示される。
- [x] Input URL、Final URL、Title、Link Scope、Redirect、Response、Issueを表示する。
- [ ] Blocked / Invalid URLがclickable external linkにならない。
- [ ] Status、Issue、内部 / 外部LinkでFilterできる。
- [ ] URL / Final URL / Title / Description / H1 / Issueを検索できる。
- [ ] Filter結果0件のEmpty stateからFilterを解除できる。

### Detail / Redirect / Metadata

- [x] 詳細DrawerでInput URLとFinal URLを区別して表示する。
- [x] `301 → 302 → 200` の各Step、Location、Response Timeを確認できる。
- [ ] Redirectなしでは「Redirectはありません」と表示する。
- [x] Title、Description、Canonical、H1、H1件数を表示する。
- [ ] Missing MetadataとDuplicate TitleのIssueを表示する。
- [ ] 内部 / 外部Linkの件数と先頭Linkを表示する。
- [ ] Escape、Close button、BackdropでDrawerを閉じられる。
- [ ] Drawer内でTab focusが循環し、Close後に起点へfocusが戻る。

### Recheck / Compare

- [ ] Errorのみ再チェックが404、410、4xx、5xx、Blocked、Failedを対象にする。
- [ ] 詳細Drawerから単一URLを再チェックできる。
- [ ] 再チェック後のResultで元Rowが置き換わる。
- [ ] 前回Snapshotとの新規Broken、修復済み、新規Redirect件数を表示する。
- [ ] Reload後も同一Browserの最新Snapshotを次回比較に利用できる。
- [ ] localStorage unavailable / fullでも通常監査が継続する。

### Export

- [x] CSVをDownloadできる。
- [ ] CSVがExcel等で日本語文字化けせず開ける。
- [x] CSVを解析し、6 rows・16列・Final URLを確認した。
- [x] XLSXをDownloadできる。
- [x] XLSXを解析し、`Audit Results` と `Issues` sheet、全6結果を確認した。
- [ ] Formula triggerで始まる文字列が数式として実行されない。

### Responsive / Accessibility

- [ ] 320px以上で主要操作がViewport外へ固定されない。
- [x] 1280 / 768 / 390 pxの3 viewportでDocument全体に意図しない横overflowがない。
- [x] DesktopのResult Tableを横Scrollで閲覧できる。
- [ ] Focus ringがKeyboard操作で見える。
- [x] Status / Severityが色だけでなく文字Labelを持つ。
- [ ] coarse pointerでSearch clear、Row detail、Drawer close、Range thumbが44px以上である。
- [ ] `prefers-reduced-motion` で大きなSlide / Spinを抑える。
- [ ] `prefers-reduced-transparency` でGlass surfaceが不透明になる。
- [ ] `prefers-contrast` でBorderとText contrastが強まる。

## Security Manual QA

権限のある検証対象だけを使ってください。Private Networkへ実到達させる試験ではなく、ApplicationがRequest前にBlock結果を返すことを確認します。

| Input | Expected | Production実測 |
| --- | --- | --- |
| `http://localhost/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `http://127.0.0.1/` | `BLOCKED_TARGET` | **PASS** |
| `http://[::1]/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `http://169.254.169.254/latest/meta-data/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `http://metadata.google.internal/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `http://192.168.1.1/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `https://example.com:8443/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `https://user:pass@example.com/` | `BLOCKED_TARGET` | 未実施（Vitestでpolicy確認） |
| `ftp://example.com/file` | `INVALID_URL` | 未実施（Vitestでpolicy確認） |
| `not a valid URL` | `INVALID_URL` | **PASS** |

- [ ] 上記InputがResponse TimeなしのBlocked / Failed Rowとして表示される。
- [ ] Input URLはDetailに表示されるが、新しいTabで開くLinkにならない。
- [ ] `/api/check` のResponseに `Cache-Control: no-store` がある。
- [x] App responseに `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` がある。

Vercel Firewall / WAF設定のProduction検証は未実施です。上記はApplicationのSSRF policyとresponse headerの検証記録であり、Platform firewallが有効であるという主張ではありません。

- [ ] 429時にUIが監査失敗として明示し、架空のHTTP Resultを作らない。

## Screenshot Checklist

5枚とも [Production](https://web-url-audit-tool.vercel.app) の実HTTP Demo結果から取得します。架空ResultをDevToolsで挿入した画像は使用しません。

| # | File | 必須内容 | 結果 |
| ---: | --- | --- | --- |
| 1 | [01-audit-dashboard.png](screenshots/01-audit-dashboard.png) | Total / OK / Redirect / Broken / Server Error / Slow / Metadata | **PASS** |
| 2 | [02-url-result-table.png](screenshots/02-url-result-table.png) | Status、Input / Final URL、Title、Scope、Redirect、Response、Issue | **PASS** |
| 3 | [03-broken-links.png](screenshots/03-broken-links.png) | Broken専用View、404、410、Error再チェック | **PASS** |
| 4 | [04-redirect-metadata-detail.png](screenshots/04-redirect-metadata-detail.png) | 301 → 302 → 200、Final URL、Metadata、Issue | **PASS** |
| 5 | [05-export-crawl-progress.png](screenshots/05-export-crawl-progress.png) | Crawl設定、実進捗、Concurrency、CSV / XLSX | **PASS** |

確認項目:

- [x] 5 fileがRepositoryに存在する。
- [x] Production URLと同じBuildの画面である。
- [x] Browser extension、個人情報、Token、DevTools、Local pathが写っていない。
- [x] 主要Textと数値が読める解像度である。
- [x] 画像の切り抜きでStatus LabelやIssue理由が欠落していない。
- [ ] READMEと掲載PromptのPath、Caption、Altが一致する。

## GitHub / Secret Scan

**状態: 保留。** このQA記録更新時点ではGitHub Repositoryはまだ公開前で、Commit SHAと最終Secret Scan結果は未確認です。下記Checklistは公開担当が実測後に更新します。

```bash
git status --short
git diff --check
git grep -nEi "(api[_-]?key|secret|token|password|private[_-]?key)"
```

- [ ] `.env` / `.env.local` が追跡されていない。
- [ ] `.vercel/` が追跡されていない。
- [ ] PEM、Key、P12 / PFX、credential JSON、service account JSONがない。
- [ ] ScreenshotにSecretや個人情報がない。
- [ ] 検索語に一致した通常コードを人が確認し、誤検知とSecretを区別した。
- [ ] 利用可能ならGitleaks等の専用scanner結果を記録した。
- [ ] GitHub URLが公開状態でREADMEを表示できる。

## Release Gate

以下がすべて満たされた場合だけ「完成・公開確認済み」と記載します。

- [x] `npm run verify` が単一commandとしてPass。
- [x] Final Test Files / Tests / Passed / Failed件数をRelease Statusへ記録。
- [x] Vercel Production pageが正常表示。
- [x] `npm run verify:production` が8 / 8 Pass。
- [x] Demoが固定ResultではなくProduction fixtureへ実Requestしていることを確認。
- [x] Manual Browser QAの主要WorkflowがPass（Keyboard-only / Reduced motionは対象外として未実施）。
- [x] CSV / XLSXを実際にDownloadし、CSV 6 rows / 16列、XLSX 2 sheets / 6結果を解析確認。
- [x] Production verifierでPrivate IP blockがPassし、拡張SSRF policyはVitestでPass。
- [x] 5枚のProduction Screenshotが存在。
- [ ] GitHub Repositoryが公開され、Secret ScanがPass。
- [ ] README、QA、掲載PromptのURL・実装範囲・制約が一致。

現時点のRelease Gate残件は、GitHub公開・最終Secret Scan、公開URL反映後の文書整合確認です。「完成・公開確認済み」の最終判定はこれらの完了後に行います。

## Known QA Boundaries

- 外部Siteの可用性、robots.txt、TLS、Rate Limit、Geo restrictionにより、同じURLでも時刻・Regionごとに結果が変わります。
- Unit TestはNetworkへ実Requestする`http-auditor`全体をmockなしで網羅するものではありません。Production verifierが専用fixtureで主要統合経路を補います。
- Production verifierは専用fixtureの8 caseであり、Internet上の全HTTP server実装、TLS構成、Redirect形式を保証しません。
- UIの完全なCross-browser E2E suite、Visual regression、Load test、Penetration test、Accessibility認証は含みません。
- API Rate bucketはinstance-localであり、分散Rate LimitのLoad test対象ではありません。
- Vercel Firewall / WAFの設定確認および攻撃Trafficを用いたProduction検証は含みません。
