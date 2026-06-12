/**
 * Insert missing translations for jaJp, koKr, ruRu into the translations file.
 * Run: node scripts/insert-translations.cjs
 */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve("src/i18n/translations.ts");
let content = fs.readFileSync(FILE, "utf-8");

// ── Parse: Get section boundaries ──
function getSection(name) {
  const marker = `const ${name}: TranslationMap = {`;
  const start = content.indexOf(marker);
  const bodyStart = start + marker.length;
  let depth = 1, end = bodyStart;
  while (end < content.length && depth > 0) {
    if (content[end] === "{") depth++;
    else if (content[end] === "}") depth--;
    end++;
  }
  const block = content.substring(bodyStart, end - 1);
  return { start: bodyStart, end: end - 1, block };
}

function getKeys(section) {
  const keys = {};
  const re = /"([a-z_][a-zA-Z.]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(section.block)) !== null) {
    if (!m[1].startsWith("...")) keys[m[1]] = m[2];
  }
  return keys;
}

const zh = getSection("zhCn");
const zhKeys = getKeys(zh);

const ja = getSection("jaJp");
const jaKeys = getKeys(ja);

const ko = getSection("koKr");
const koKeys = getKeys(ko);

const ru = getSection("ruRu");
const ruKeys = getKeys(ru);

const allKeys = Object.keys(zhKeys);

function missing(kv) {
  return allKeys.filter(k => !(k in kv));
}

const jaMiss = missing(jaKeys);
const koMiss = missing(koKeys);
const ruMiss = missing(ruKeys);

console.log("jaJp missing:", jaMiss.length);
console.log("koKr missing:", koMiss.length);
console.log("ruRu missing:", ruMiss.length);

// ── Translation maps ──

// jaJp translations
const jaTrans = {};
jaMiss.forEach(k => {
  if (k === "common.loading") jaTrans[k] = "読み込み中...";
  else if (k === "common.save") jaTrans[k] = "保存";
  else if (k === "common.cancel") jaTrans[k] = "キャンセル";
  else if (k === "common.copied") jaTrans[k] = "コピーしました";
  else if (k === "common.delete") jaTrans[k] = "削除";
  else if (k === "common.filterMin") jaTrans[k] = "最小";
  else if (k === "common.filterMax") jaTrans[k] = "最大";
  else if (k === "dashboard.scanProgress") jaTrans[k] = "{current} / {total}";
  else if (k === "dashboard.instancePlaceholder") jaTrans[k] = "E:/PCL2/.minecraft/versions/Aaalice Craft";
  else if (k === "dashboard.stats.resourcePackCovered") jaTrans[k] = "リソースパックでカバー";
  else if (k === "dashboard.stats.resourcePackCoveredHint") jaTrans[k] = "マッチしたソースキー";
  else if (k === "dashboard.stats.actualPending") jaTrans[k] = "翻訳キュー合計";
  else if (k === "dashboard.stats.actualPendingHint") jaTrans[k] = "翻訳が必要なエントリ（既存除く）";
  else if (k === "dashboard.column.pending") jaTrans[k] = "未翻訳";
  else if (k === "dashboard.rangeFrom") jaTrans[k] = "最小";
  else if (k === "dashboard.rangeTo") jaTrans[k] = "最大";
  else if (k === "dashboard.resourceFilesEntries") jaTrans[k] = "{files} ファイル / {entries} 項目";
  else if (k === "dashboard.filterAllFormats") jaTrans[k] = "すべての形式";
  else if (k === "dashboard.filterAllStatus") jaTrans[k] = "すべての状態";
  else if (k === "dashboard.gotIt") jaTrans[k] = "確認";
  else if (k.startsWith("dictionary.")) {
    if (k === "dictionary.title") jaTrans[k] = "辞書管理";
    else if (k === "dictionary.subtitle") jaTrans[k] = "合計 {total} 件の辞書エントリ、{mods} 個のMod";
    else if (k === "dictionary.subtitleEmpty") jaTrans[k] = "辞書がまだ読み込まれていません";
    else if (k === "dictionary.searchPlaceholder") jaTrans[k] = "原文、翻訳、またはキーを検索...";
    else if (k === "dictionary.allTypes") jaTrans[k] = "すべてのタイプ";
    else if (k === "dictionary.typeManual") jaTrans[k] = "手動";
    else if (k === "dictionary.typeResourcepack") jaTrans[k] = "リソースパック";
    else if (k === "dictionary.typeCfpa") jaTrans[k] = "CFPA";
    else if (k === "dictionary.typeLlm") jaTrans[k] = "LLM";
    else if (k === "dictionary.search") jaTrans[k] = "検索";
    else if (k === "dictionary.export") jaTrans[k] = "エクスポート";
    else if (k === "dictionary.import") jaTrans[k] = "インポート";
    else if (k === "dictionary.empty") jaTrans[k] = "辞書が空です。先にModをスキャンして翻訳してください";
    else if (k === "dictionary.col.source") jaTrans[k] = "原文";
    else if (k === "dictionary.col.target") jaTrans[k] = "訳文";
    else if (k === "dictionary.col.mod") jaTrans[k] = "Mod";
    else if (k === "dictionary.col.key") jaTrans[k] = "キー";
    else if (k === "dictionary.col.type") jaTrans[k] = "タイプ";
    else if (k === "dictionary.col.actions") jaTrans[k] = "操作";
    else if (k === "dictionary.clickToEdit") jaTrans[k] = "クリックして編集";
    else if (k === "dictionary.saved") jaTrans[k] = "保存しました";
    else if (k === "dictionary.deleted") jaTrans[k] = "削除しました";
    else if (k === "dictionary.moreResults") jaTrans[k] = "先頭500件を表示。あと {count} 件あります";
  }
  else if (k.startsWith("editPanel.")) {
    if (k === "editPanel.ariaClose") jaTrans[k] = "閉じる";
    else if (k === "editPanel.ariaLabel") jaTrans[k] = "翻訳編集パネル";
    else if (k === "editPanel.ariaTargetEdit") jaTrans[k] = "訳文編集";
    else if (k === "editPanel.close") jaTrans[k] = "閉じる";
    else if (k === "editPanel.copied") jaTrans[k] = "コピーしました";
    else if (k === "editPanel.copySource") jaTrans[k] = "原文をコピー";
    else if (k === "editPanel.entryNotFound") jaTrans[k] = "エントリが見つかりません（フィルターで除外された可能性があります）";
    else if (k === "editPanel.llmFailed") jaTrans[k] = "LLM翻訳に失敗しました";
    else if (k === "editPanel.llmTranslate") jaTrans[k] = "LLM翻訳";
    else if (k === "editPanel.llmTranslateTooltip") jaTrans[k] = "LLM翻訳";
    else if (k === "editPanel.nextTooltip") jaTrans[k] = "次へ (→)";
    else if (k === "editPanel.prevTooltip") jaTrans[k] = "前へ (←)";
    else if (k === "editPanel.retranslate") jaTrans[k] = "再翻訳";
    else if (k === "editPanel.retry") jaTrans[k] = "リトライ";
    else if (k === "editPanel.save") jaTrans[k] = "保存";
    else if (k === "editPanel.translating") jaTrans[k] = "翻訳中...";
    else if (k === "editPanel.accept") jaTrans[k] = "採用";
    else if (k === "editPanel.shortcutPrev") jaTrans[k] = "前へ";
    else if (k === "editPanel.shortcutNext") jaTrans[k] = "次へ";
    else if (k === "editPanel.shortcutClose") jaTrans[k] = "閉じる";
  }
  else if (k.startsWith("jobs.")) {
    if (k === "jobs.title") jaTrans[k] = "翻訳タスク";
    else if (k === "jobs.subtitle") jaTrans[k] = "翻訳プロセスを管理し、進捗と結果を確認";
    else if (k === "jobs.start") jaTrans[k] = "翻訳を開始";
    else if (k === "jobs.running") jaTrans[k] = "翻訳中...";
    else if (k === "jobs.stage.matching") jaTrans[k] = "辞書照合";
    else if (k === "jobs.stage.translating") jaTrans[k] = "翻訳中";
    else if (k === "jobs.stage.packaging") jaTrans[k] = "パッケージ中";
    else if (k === "jobs.completed.message") jaTrans[k] = "翻訳完了: {count} 件";
    else if (k === "jobs.canceled") jaTrans[k] = "翻訳キャンセル";
    else if (k === "jobs.canceledStatus") jaTrans[k] = "キャンセル済み";
    else if (k === "jobs.failed.message") jaTrans[k] = "翻訳失敗: {error}";
    else if (k === "jobs.logPanel.title") jaTrans[k] = "翻訳ログ";
    else if (k === "jobs.logPanel.filterPlaceholder") jaTrans[k] = "Mod名またはキーでフィルター...";
    else if (k === "jobs.logPanel.clear") jaTrans[k] = "ログをクリア";
    else if (k === "jobs.logPanel.copyEntry") jaTrans[k] = "コピー";
    else if (k === "jobs.logPanel.noEntries") jaTrans[k] = "翻訳ログがありません";
    else if (k === "jobs.logPanel.entriesCount") jaTrans[k] = "{count} 件";
    else if (k === "jobs.logPanel.colKey") jaTrans[k] = "キー";
    else if (k === "jobs.logPanel.colSource") jaTrans[k] = "原文";
    else if (k === "jobs.logPanel.colTarget") jaTrans[k] = "訳文";
    else if (k === "jobs.logPanel.colMod") jaTrans[k] = "Mod";
    else if (k === "jobs.logPanel.colType") jaTrans[k] = "タイプ";
    else if (k === "jobs.stop") jaTrans[k] = "停止";
    else if (k === "jobs.noScan") jaTrans[k] = "先にMod言語ファイルをスキャンしてください";
    else if (k === "jobs.noPending") jaTrans[k] = "すべてのエントリが翻訳済みか辞書にヒットしました";
    else if (k === "jobs.summary") jaTrans[k] = "タスク概要";
    else if (k === "jobs.totalEntries") jaTrans[k] = "翻訳待ちエントリ";
    else if (k === "jobs.sourceLang") jaTrans[k] = "ソース言語";
    else if (k === "jobs.targetLang") jaTrans[k] = "ターゲット言語";
    else if (k === "jobs.modCount") jaTrans[k] = "Mod数";
    else if (k === "jobs.translating") jaTrans[k] = "翻訳処理中";
    else if (k === "jobs.retryFailed") jaTrans[k] = "失敗をリトライ";
    else if (k === "jobs.retrying") jaTrans[k] = "リトライ中...";
    else if (k === "jobs.newTranslation") jaTrans[k] = "新しい翻訳を開始";
    else if (k === "jobs.restart") jaTrans[k] = "再翻訳";
    else if (k === "jobs.progressFallback") jaTrans[k] = "- / -";
    else if (k === "jobs.logPanel.colStatus") jaTrans[k] = "ステータス";
    else if (k === "jobs.entryStatus.pending") jaTrans[k] = "未翻訳";
    else if (k === "jobs.entryStatus.dictionaryHit") jaTrans[k] = "辞書ヒット";
    else if (k === "jobs.entryStatus.skip") jaTrans[k] = "スキップ";
    else if (k === "jobs.entryStatus.translating") jaTrans[k] = "翻訳中";
    else if (k === "jobs.entryStatus.completed") jaTrans[k] = "完了";
    else if (k === "jobs.entryStatus.failed") jaTrans[k] = "失敗";
    else if (k === "jobs.sourceType.existing") jaTrans[k] = "既存翻訳";
    else if (k === "jobs.sourceType.dictionary") jaTrans[k] = "辞書マッチ";
    else if (k === "jobs.sourceType.llm") jaTrans[k] = "LLM翻訳";
    else if (k === "jobs.sourceType.skipped") jaTrans[k] = "スキップ済み";
    else if (k === "jobs.sourceType.failed") jaTrans[k] = "翻訳失敗";
    else if (k === "jobs.sourceType.reviewed") jaTrans[k] = "レビュー済み";
  }
  else if (k.startsWith("tooltip.")) {
    if (k === "tooltip.dryRun") jaTrans[k] = "翻訳内容をプレビュー";
    else if (k === "tooltip.validate") jaTrans[k] = "パッケージを確認して生成";
  }
  else if (k.startsWith("summary.")) {
    if (k === "summary.scanCompleted") jaTrans[k] = "スキャン完了";
    else if (k === "summary.translateCompleted") jaTrans[k] = "翻訳完了";
    else if (k === "summary.elapsed") jaTrans[k] = "経過時間";
    else if (k === "summary.existing") jaTrans[k] = "既存 {count}";
  }
  else if (k.startsWith("validate.")) {
    if (k === "validate.summary") jaTrans[k] = "{count} 件翻訳 · {date} · {total} 項目";
    else if (k === "validate.noJob") jaTrans[k] = "翻訳ジョブが見つかりません。先に翻訳を完了してください。";
    else if (k === "validate.jobPending") jaTrans[k] = "翻訳ジョブが実行中です。完了をお待ちください。";
    else if (k === "validate.doubleClickEdit") jaTrans[k] = "ダブルクリックで編集";
    else if (k === "validate.title") jaTrans[k] = "レビュー";
    else if (k === "validate.description") jaTrans[k] = "LLM翻訳結果を1件ずつ確認し、レビュー完了後にパッケージに進めます";
    else if (k === "validate.entries") jaTrans[k] = "{count} 件";
    else if (k === "validate.loading") jaTrans[k] = "読み込み中...";
    else if (k === "validate.markDone") jaTrans[k] = "レビュー完了";
    else if (k === "validate.noMatch") jaTrans[k] = "一致するエントリがありません";
    else if (k === "validate.noResults") jaTrans[k] = "翻訳結果がありません";
    else if (k === "validate.reviewed") jaTrans[k] = "レビュー済み";
    else if (k === "validate.searchPlaceholder") jaTrans[k] = "Mod名、ModId、キー、原文、訳文を検索...";
    else if (k === "validate.col.modName") jaTrans[k] = "Mod名";
    else if (k === "validate.col.modId") jaTrans[k] = "Mod ID";
    else if (k === "validate.col.sourceText") jaTrans[k] = "原文";
    else if (k === "validate.col.targetText") jaTrans[k] = "訳文";
    else if (k === "validate.col.sourceType") jaTrans[k] = "タイプ";
  }
  else if (k.startsWith("settings.")) {
    if (k === "settings.temperature") jaTrans[k] = "Temperature";
    else if (k === "settings.batchSize") jaTrans[k] = "Batch size";
    else if (k === "settings.batchSizeHint") jaTrans[k] = "1バッチあたりの最大エントリ数（デフォルト80）。大きいバッチはトークン効率が良いが応答時間が長くなります。";
    else if (k === "settings.concurrencyHint") jaTrans[k] = "同時APIリクエスト数（デフォルト10）。429応答時に自動的にバックオフします。";
    else if (k === "settings.timeoutSecsHint") jaTrans[k] = "1リクエストあたりのタイムアウト秒数（デフォルト180）。大量バッチでは増やしてください。";
    else if (k === "settings.retryCountHint") jaTrans[k] = "失敗時のリトライ回数（デフォルト5）。レート制限による失敗は特別処理されます。";
    else if (k === "settings.rateLimitRpmHint") jaTrans[k] = "1分あたりの最大リクエスト数（デフォルト3000）。0 = 無制限。";
    else if (k === "settings.preferDictionary") jaTrans[k] = "ユーザー辞書を優先";
    else if (k === "settings.resetMainLog") jaTrans[k] = "起動時に main.log をリセット";
    else if (k === "settings.enableDebug") jaTrans[k] = "デバッグログを有効化";
    else if (k === "settings.enableHttp") jaTrans[k] = "HTTPリクエストログを有効化";
    else if (k === "settings.defaultInstance") jaTrans[k] = "デフォルトインスタンスパス";
    else if (k === "settings.translationPacks") jaTrans[k] = "翻訳リソースパック";
    else if (k === "settings.resourcePackName") jaTrans[k] = "リソースパックファイル名";
    else if (k === "settings.resourcePackHint") jaTrans[k] = "スキャナーは resourcepacks/ 内をこの名前で検索します";
    else if (k === "settings.addPack") jaTrans[k] = "リソースパックを追加";
    else if (k === "settings.removePack") jaTrans[k] = "削除";
    else if (k === "settings.packPlaceholder") jaTrans[k] = "例: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip";
    else if (k === "settings.packDefaultI18n") jaTrans[k] = "デフォルトで CFPAOrg (i18n) と VM 翻訳パックを含みます";
    else if (k === "settings.outputPackName") jaTrans[k] = "出力リソースパック名";
    else if (k === "settings.placeholderHint") jaTrans[k] = "{{mc_version}} プレースホルダーでインスタンスバージョンに自動置換";
    else if (k === "settings.futureAdvanced") jaTrans[k] = "辞書、パッケージング、実験機能の設定は後続フェーズで接続します。";
    else if (k === "settings.providerOpenai") jaTrans[k] = "OpenAI 互換";
    else if (k === "settings.sourceHint") jaTrans[k] = "ソース言語は auto を指定可能。スキャナーは en_us を優先します。";
    else if (k === "settings.targetHint") jaTrans[k] = "ターゲット言語は Minecraft locale code にする必要があります。auto は使えません。";
    else if (k === "settings.invalidSourceLanguage") jaTrans[k] = "ソース言語は auto または有効な Minecraft locale code にしてください。";
    else if (k === "settings.invalidTargetLanguage") jaTrans[k] = "ターゲット言語は有効な Minecraft locale code にしてください。auto は使えません。";
    else if (k === "settings.maxTokens") jaTrans[k] = "Max tokens";
    else if (k === "settings.maxTokensHint") jaTrans[k] = "応答トークン数を制限。0 = 無制限（APIデフォルト）。翻訳では0または大きい値（32768など）を推奨。";
    else if (k === "settings.maxTokensPlaceholder") jaTrans[k] = "0 = 無制限";
    else if (k === "settings.modelPlaceholder") jaTrans[k] = "カスタムモデル名を入力...";
    else if (k === "settings.noModels") jaTrans[k] = "モデルが取得されていません";
    else if (k === "settings.selectModel") jaTrans[k] = "モデルを選択...";
    else if (k === "settings.customModel") jaTrans[k] = "カスタムモデルを入力";
    else if (k === "settings.pickFromList") jaTrans[k] = "リストから選択";
    else if (k === "settings.modelsFetched") jaTrans[k] = "{url} から {count} 個のモデルを取得しました";
    else if (k === "settings.card.apiParams") jaTrans[k] = "API パラメーター";
    else if (k === "settings.card.concurrency") jaTrans[k] = "並列設定";
    else if (k === "settings.card.timeouts") jaTrans[k] = "タイムアウトとリトライ";
    else if (k === "settings.card.dictionary") jaTrans[k] = "辞書";
    else if (k === "settings.provider") jaTrans[k] = "プロバイダー";
    else if (k === "settings.baseUrl") jaTrans[k] = "ベースURL";
    else if (k === "settings.tab.performance") jaTrans[k] = "パフォーマンス";
    else if (k === "settings.tab.reuse") jaTrans[k] = "再利用";
    else if (k === "settings.tab.logs") jaTrans[k] = "ログ";
    else if (k === "settings.tab.advanced") jaTrans[k] = "詳細設定";
    else if (k === "settings.tab.appearance") jaTrans[k] = "外観";
    else if (k === "settings.tab.language") jaTrans[k] = "言語と翻訳";
    else if (k === "settings.tab.api") jaTrans[k] = "API設定";
    else if (k === "settings.loadingFonts") jaTrans[k] = "読み込み中…";
    else if (k === "settings.apiKey") jaTrans[k] = "APIキー";
    else if (k === "settings.appLanguage") jaTrans[k] = "アプリ言語";
    else if (k === "settings.uiFont") jaTrans[k] = "UIフォント";
    else if (k === "settings.uiFontOption.system") jaTrans[k] = "システムデフォルト";
    else if (k === "settings.uiFontPresets") jaTrans[k] = "プリセット";
    else if (k === "settings.uiFontSystem") jaTrans[k] = "システムフォント({count})";
    else if (k === "settings.uiTheme") jaTrans[k] = "テーマ";
    else if (k === "settings.uiDarkMode") jaTrans[k] = "ダークモード";
    else if (k === "settings.uiDarkModeOn") jaTrans[k] = "ダークモードに切り替え";
    else if (k === "settings.uiDarkModeOff") jaTrans[k] = "ライトモードに切り替え";
    else if (k === "settings.uiThemeOption.default") jaTrans[k] = "クラシック";
    else if (k === "settings.uiThemeOption.ocean") jaTrans[k] = "オーシャンブルー";
    else if (k === "settings.uiThemeOption.aurora") jaTrans[k] = "オーロラパープル";
    else if (k === "settings.uiThemeOption.gold") jaTrans[k] = "アンバーゴールド";
    else if (k === "settings.systemPrompt") jaTrans[k] = "システムプロンプト";
    else if (k === "settings.systemPromptHint") jaTrans[k] = "AI翻訳アシスタントのロールと動作をカスタマイズ。デフォルトで完全なMinecraft翻訳エキスパート設定が提供されます。";
    else if (k === "settings.autosaveHint") jaTrans[k] = "自動保存 — 変更は自動的に保存されます";
  }
  else if (k.startsWith("logs.")) {
    if (k === "logs.title") jaTrans[k] = "ログ";
    else if (k === "logs.subtitle") jaTrans[k] = "フェーズ1ではmain、job、errorログを書き込みます。完全なフィルターは後続フェーズで接続します。";
    else if (k === "logs.recentJob") jaTrans[k] = "最近のジョブ";
    else if (k === "logs.jobId") jaTrans[k] = "ジョブID：{id}";
    else if (k === "logs.instance") jaTrans[k] = "インスタンス：{path}";
    else if (k === "logs.warning") jaTrans[k] = "warning：{count}";
    else if (k === "logs.empty") jaTrans[k] = "まだスキャンジョブが実行されていません。";
    else if (k === "logs.pause") jaTrans[k] = "一時停止";
    else if (k === "logs.resume") jaTrans[k] = "再開";
    else if (k === "logs.copyAll") jaTrans[k] = "すべてコピー";
    else if (k === "logs.clear") jaTrans[k] = "クリア";
    else if (k === "logs.allLevel") jaTrans[k] = "すべて";
    else if (k === "logs.paused") jaTrans[k] = "ログ一時停止中";
    else if (k === "logs.lines") jaTrans[k] = "{count} 行";
    else if (k === "logs.linesWithTotal") jaTrans[k] = "/ {count} 全体";
    else if (k === "logs.scrollToBottom") jaTrans[k] = "最下部へ";
  }
  else if (k.startsWith("packages.")) {
    if (k === "packages.title") jaTrans[k] = "リソースパックパッケージング";
    else if (k === "packages.subtitle") jaTrans[k] = "翻訳リソースパックを生成してインスタンスにデプロイ";
    else if (k === "packages.generate") jaTrans[k] = "リソースパックを生成";
    else if (k === "packages.noScan") jaTrans[k] = "先にModをスキャンして翻訳してください";
    else if (k === "packages.allMods") jaTrans[k] = "すべてのMod ({count})";
    else if (k === "packages.entries_label") jaTrans[k] = "{count} 項目";
    else if (k === "packages.entryCount") jaTrans[k] = "{count} 翻訳";
    else if (k === "packages.failed_label") jaTrans[k] = "失敗";
    else if (k === "packages.files_label") jaTrans[k] = "{count} ファイル";
    else if (k === "packages.modCount") jaTrans[k] = "{count} 個のMod";
    else if (k === "packages.noLangFiles") jaTrans[k] = "言語ファイルなし";
    else if (k === "packages.noTranslation") jaTrans[k] = "翻訳結果がありません。先に翻訳を完了してください。";
    else if (k === "packages.packDone") jaTrans[k] = "パッケージ完了";
    else if (k === "packages.packing") jaTrans[k] = "パッケージ中...";
    else if (k === "packages.packingPercent") jaTrans[k] = "パッケージ中 ({percent}%)";
    else if (k === "packages.ready") jaTrans[k] = "準備完了";
    else if (k === "packages.regenerate") jaTrans[k] = "再生成";
    else if (k === "packages.regenerateTooltip") jaTrans[k] = "リソースパックを再生成";
    else if (k === "packages.outputDir") jaTrans[k] = "出力先";
    else if (k === "packages.outputDirBrowse") jaTrans[k] = "参照...";
    else if (k === "packages.readyToPack") jaTrans[k] = "翻訳完了。「生成」をクリックしてパックを作成";
    else if (k === "packages.reviewRequired") jaTrans[k] = "現在の翻訳ジョブはまだレビューされていません。先に「レビュー」ページでレビューを完了してください。";
  }
  else if (k.startsWith("packing.")) {
    if (k === "packing.translationPack") jaTrans[k] = "翻訳リソースパック";
    else if (k === "packing.packed") jaTrans[k] = "パック完了 ✓";
  }
  else if (k.startsWith("splash.")) {
    if (k === "splash.phase.completed") jaTrans[k] = "";
    else if (k === "splash.offline") jaTrans[k] = "オフラインモード";
    else if (k === "splash.firstLaunch") jaTrans[k] = "初回起動、初期化中…";
    else if (k === "splash.skip") jaTrans[k] = "スキップして続行";
  }
});

// koKr translations
const koTrans = {};
koMiss.forEach(k => {
  if (k === "common.loading") koTrans[k] = "로딩 중...";
  else if (k === "common.save") koTrans[k] = "저장";
  else if (k === "common.cancel") koTrans[k] = "취소";
  else if (k === "common.copied") koTrans[k] = "복사됨";
  else if (k === "common.delete") koTrans[k] = "삭제";
  else if (k === "common.filterMin") koTrans[k] = "최소";
  else if (k === "common.filterMax") koTrans[k] = "최대";
  else if (k === "dashboard.scanProgress") koTrans[k] = "{current} / {total}";
  else if (k === "dashboard.instancePlaceholder") koTrans[k] = "E:/PCL2/.minecraft/versions/Aaalice Craft";
  else if (k === "dashboard.stats.resourcePackCovered") koTrans[k] = "리소스팩으로 커버";
  else if (k === "dashboard.stats.resourcePackCoveredHint") koTrans[k] = "일치한 소스 키";
  else if (k === "dashboard.stats.actualPending") koTrans[k] = "번역 대기열 합계";
  else if (k === "dashboard.stats.actualPendingHint") koTrans[k] = "번역이 필요한 항목 (기존 번역 제외)";
  else if (k === "dashboard.column.pending") koTrans[k] = "번역 대기";
  else if (k === "dashboard.rangeFrom") koTrans[k] = "최소";
  else if (k === "dashboard.rangeTo") koTrans[k] = "최대";
  else if (k === "dashboard.resourceFilesEntries") koTrans[k] = "{files}개 파일 / {entries}개 항목";
  else if (k === "dashboard.filterAllFormats") koTrans[k] = "모든 형식";
  else if (k === "dashboard.filterAllStatus") koTrans[k] = "모든 상태";
  else if (k === "dashboard.gotIt") koTrans[k] = "확인";
  else if (k.startsWith("dictionary.")) {
    if (k === "dictionary.title") koTrans[k] = "사전 관리";
    else if (k === "dictionary.subtitle") koTrans[k] = "총 {total}개 사전 항목, {mods}개 모드";
    else if (k === "dictionary.subtitleEmpty") koTrans[k] = "사전이 아직 로드되지 않음";
    else if (k === "dictionary.searchPlaceholder") koTrans[k] = "원문, 번역문 또는 키 검색...";
    else if (k === "dictionary.allTypes") koTrans[k] = "모든 유형";
    else if (k === "dictionary.typeManual") koTrans[k] = "수동";
    else if (k === "dictionary.typeResourcepack") koTrans[k] = "리소스팩";
    else if (k === "dictionary.typeCfpa") koTrans[k] = "CFPA";
    else if (k === "dictionary.typeLlm") koTrans[k] = "LLM";
    else if (k === "dictionary.search") koTrans[k] = "검색";
    else if (k === "dictionary.export") koTrans[k] = "내보내기";
    else if (k === "dictionary.import") koTrans[k] = "가져오기";
    else if (k === "dictionary.empty") koTrans[k] = "사전이 비어 있습니다. 먼저 모드를 스캔하고 번역해주세요";
    else if (k === "dictionary.col.source") koTrans[k] = "원문";
    else if (k === "dictionary.col.target") koTrans[k] = "번역문";
    else if (k === "dictionary.col.mod") koTrans[k] = "모드";
    else if (k === "dictionary.col.key") koTrans[k] = "키";
    else if (k === "dictionary.col.type") koTrans[k] = "유형";
    else if (k === "dictionary.col.actions") koTrans[k] = "작업";
    else if (k === "dictionary.clickToEdit") koTrans[k] = "클릭하여 편집";
    else if (k === "dictionary.saved") koTrans[k] = "저장됨";
    else if (k === "dictionary.deleted") koTrans[k] = "삭제됨";
    else if (k === "dictionary.moreResults") koTrans[k] = "처음 500개 표시. {count}개 더 있음";
  }
  else if (k.startsWith("editPanel.")) {
    if (k === "editPanel.ariaClose") koTrans[k] = "닫기";
    else if (k === "editPanel.ariaLabel") koTrans[k] = "번역 편집 패널";
    else if (k === "editPanel.ariaTargetEdit") koTrans[k] = "번역문 편집";
    else if (k === "editPanel.close") koTrans[k] = "닫기";
    else if (k === "editPanel.copied") koTrans[k] = "복사됨";
    else if (k === "editPanel.copySource") koTrans[k] = "원문 복사";
    else if (k === "editPanel.entryNotFound") koTrans[k] = "항목을 찾을 수 없음 (필터에서 제외됨)";
    else if (k === "editPanel.llmFailed") koTrans[k] = "LLM 번역 실패";
    else if (k === "editPanel.llmTranslate") koTrans[k] = "LLM 번역";
    else if (k === "editPanel.llmTranslateTooltip") koTrans[k] = "LLM 번역";
    else if (k === "editPanel.nextTooltip") koTrans[k] = "다음 (->)";
    else if (k === "editPanel.prevTooltip") koTrans[k] = "이전 (<-)";
    else if (k === "editPanel.retranslate") koTrans[k] = "다시 번역";
    else if (k === "editPanel.retry") koTrans[k] = "재시도";
    else if (k === "editPanel.save") koTrans[k] = "저장";
    else if (k === "editPanel.translating") koTrans[k] = "번역 중...";
    else if (k === "editPanel.accept") koTrans[k] = "적용";
    else if (k === "editPanel.shortcutPrev") koTrans[k] = "이전";
    else if (k === "editPanel.shortcutNext") koTrans[k] = "다음";
    else if (k === "editPanel.shortcutClose") koTrans[k] = "닫기";
  }
  else if (k.startsWith("jobs.")) {
    if (k === "jobs.title") koTrans[k] = "번역 작업";
    else if (k === "jobs.subtitle") koTrans[k] = "번역 프로세스를 관리하고 진행 상황 확인";
    else if (k === "jobs.start") koTrans[k] = "번역 시작";
    else if (k === "jobs.running") koTrans[k] = "번역 중...";
    else if (k === "jobs.stop") koTrans[k] = "중지";
    else if (k === "jobs.stage.matching") koTrans[k] = "사전 매칭";
    else if (k === "jobs.stage.translating") koTrans[k] = "번역 중";
    else if (k === "jobs.stage.packaging") koTrans[k] = "패키징 중";
    else if (k === "jobs.completed.message") koTrans[k] = "번역 완료: {count}개";
    else if (k === "jobs.canceled") koTrans[k] = "번역 취소됨";
    else if (k === "jobs.canceledStatus") koTrans[k] = "취소됨";
    else if (k === "jobs.failed.message") koTrans[k] = "번역 실패: {error}";
    else if (k === "jobs.logPanel.title") koTrans[k] = "번역 로그";
    else if (k === "jobs.logPanel.filterPlaceholder") koTrans[k] = "모드명 또는 키로 필터...";
    else if (k === "jobs.logPanel.clear") koTrans[k] = "로그 지우기";
    else if (k === "jobs.logPanel.copyEntry") koTrans[k] = "복사";
    else if (k === "jobs.logPanel.noEntries") koTrans[k] = "번역 로그가 없습니다";
    else if (k === "jobs.logPanel.entriesCount") koTrans[k] = "{count}개";
    else if (k === "jobs.logPanel.colKey") koTrans[k] = "키";
    else if (k === "jobs.logPanel.colSource") koTrans[k] = "원문";
    else if (k === "jobs.logPanel.colTarget") koTrans[k] = "번역문";
    else if (k === "jobs.logPanel.colMod") koTrans[k] = "모드";
    else if (k === "jobs.logPanel.colType") koTrans[k] = "유형";
    else if (k === "jobs.noScan") koTrans[k] = "먼저 모드 언어 파일을 스캔해주세요";
    else if (k === "jobs.noPending") koTrans[k] = "모든 항목이 번역되었거나 사전에 있습니다";
    else if (k === "jobs.summary") koTrans[k] = "작업 요약";
    else if (k === "jobs.totalEntries") koTrans[k] = "번역 대기 항목";
    else if (k === "jobs.sourceLang") koTrans[k] = "소스 언어";
    else if (k === "jobs.targetLang") koTrans[k] = "대상 언어";
    else if (k === "jobs.modCount") koTrans[k] = "모드 수";
    else if (k === "jobs.translating") koTrans[k] = "번역 처리 중";
    else if (k === "jobs.retryFailed") koTrans[k] = "실패 재시도";
    else if (k === "jobs.retrying") koTrans[k] = "재시도 중...";
    else if (k === "jobs.newTranslation") koTrans[k] = "새 번역 시작";
    else if (k === "jobs.restart") koTrans[k] = "다시 번역";
    else if (k === "jobs.progressFallback") koTrans[k] = "- / -";
    else if (k === "jobs.logPanel.colStatus") koTrans[k] = "상태";
    else if (k === "jobs.entryStatus.pending") koTrans[k] = "번역 대기";
    else if (k === "jobs.entryStatus.dictionaryHit") koTrans[k] = "사전 일치";
    else if (k === "jobs.entryStatus.skip") koTrans[k] = "건너뜀";
    else if (k === "jobs.entryStatus.translating") koTrans[k] = "번역 중";
    else if (k === "jobs.entryStatus.completed") koTrans[k] = "완료";
    else if (k === "jobs.entryStatus.failed") koTrans[k] = "실패";
    else if (k === "jobs.sourceType.existing") koTrans[k] = "기존 번역";
    else if (k === "jobs.sourceType.dictionary") koTrans[k] = "사전 일치";
    else if (k === "jobs.sourceType.llm") koTrans[k] = "LLM 번역";
    else if (k === "jobs.sourceType.skipped") koTrans[k] = "건너뜀";
    else if (k === "jobs.sourceType.failed") koTrans[k] = "번역 실패";
    else if (k === "jobs.sourceType.reviewed") koTrans[k] = "검토됨";
  }
  else if (k.startsWith("tooltip.")) {
    if (k === "tooltip.dryRun") koTrans[k] = "번역 내용 미리보기";
    else if (k === "tooltip.validate") koTrans[k] = "패키징 확인 및 생성";
  }
  else if (k.startsWith("summary.")) {
    if (k === "summary.scanCompleted") koTrans[k] = "스캔 완료";
    else if (k === "summary.translateCompleted") koTrans[k] = "번역 완료";
    else if (k === "summary.elapsed") koTrans[k] = "경과 시간";
    else if (k === "summary.existing") koTrans[k] = "기존 {count}";
  }
  else if (k.startsWith("validate.")) {
    if (k === "validate.summary") koTrans[k] = "{count}개 번역 · {date} · {total}개 항목";
    else if (k === "validate.noJob") koTrans[k] = "번역 작업을 찾을 수 없습니다. 먼저 번역을 완료해주세요.";
    else if (k === "validate.jobPending") koTrans[k] = "번역 작업이 실행 중입니다. 완료될 때까지 기다려주세요.";
    else if (k === "validate.doubleClickEdit") koTrans[k] = "더블클릭하여 편집";
    else if (k === "validate.title") koTrans[k] = "검토";
    else if (k === "validate.description") koTrans[k] = "LLM 번역 결과를 하나씩 검토하고 완료 후 패키징으로 진행";
    else if (k === "validate.entries") koTrans[k] = "{count}개";
    else if (k === "validate.loading") koTrans[k] = "로딩 중...";
    else if (k === "validate.markDone") koTrans[k] = "검토 완료";
    else if (k === "validate.noMatch") koTrans[k] = "일치하는 항목 없음";
    else if (k === "validate.noResults") koTrans[k] = "번역 결과 없음";
    else if (k === "validate.reviewed") koTrans[k] = "검토됨";
    else if (k === "validate.searchPlaceholder") koTrans[k] = "모드명, ModId, 키, 원문 또는 번역문 검색...";
    else if (k === "validate.col.modName") koTrans[k] = "모드명";
    else if (k === "validate.col.modId") koTrans[k] = "Mod ID";
    else if (k === "validate.col.sourceText") koTrans[k] = "원문";
    else if (k === "validate.col.targetText") koTrans[k] = "번역문";
    else if (k === "validate.col.sourceType") koTrans[k] = "유형";
  }
  else if (k.startsWith("settings.")) {
    if (k === "settings.temperature") koTrans[k] = "Temperature";
    else if (k === "settings.batchSize") koTrans[k] = "Batch size";
    else if (k === "settings.batchSizeHint") koTrans[k] = "배치당 최대 항목 수(기본 80). 큰 배치는 토큰 효율이 좋지만 응답 시간이 길어집니다.";
    else if (k === "settings.concurrencyHint") koTrans[k] = "동시 API 요청 수(기본 10). 429 응답 시 자동 백오프됩니다.";
    else if (k === "settings.timeoutSecsHint") koTrans[k] = "요청당 타임아웃(초) (기본 180). 대량 배치 시 증가하세요.";
    else if (k === "settings.retryCountHint") koTrans[k] = "실패 시 재시도 횟수(기본 5). 속도 제한 실패는 특별 처리됩니다.";
    else if (k === "settings.rateLimitRpmHint") koTrans[k] = "분당 최대 요청 수(기본 3000). 0 = 무제한.";
    else if (k === "settings.preferDictionary") koTrans[k] = "사용자 사전 우선";
    else if (k === "settings.resetMainLog") koTrans[k] = "시작 시 main.log 초기화";
    else if (k === "settings.enableDebug") koTrans[k] = "디버그 로그 활성화";
    else if (k === "settings.enableHttp") koTrans[k] = "HTTP 요청 로그 활성화";
    else if (k === "settings.defaultInstance") koTrans[k] = "기본 인스턴스 경로";
    else if (k === "settings.translationPacks") koTrans[k] = "번역 리소스 팩";
    else if (k === "settings.resourcePackName") koTrans[k] = "리소스 팩 파일명";
    else if (k === "settings.resourcePackHint") koTrans[k] = "스캐너가 resourcepacks/ 에서 이 이름으로 검색합니다";
    else if (k === "settings.addPack") koTrans[k] = "팩 추가";
    else if (k === "settings.removePack") koTrans[k] = "삭제";
    else if (k === "settings.packPlaceholder") koTrans[k] = "예: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip";
    else if (k === "settings.packDefaultI18n") koTrans[k] = "기본적으로 CFPAOrg (i18n) 및 VM 번역 팩 포함";
    else if (k === "settings.outputPackName") koTrans[k] = "출력 리소스 팩 이름";
    else if (k === "settings.placeholderHint") koTrans[k] = "{{mc_version}} 플레이스홀더로 인스턴스 버전 자동 대체";
    else if (k === "settings.futureAdvanced") koTrans[k] = "사전, 패키징, 실험 기능 설정은 이후 단계에서 연결됩니다.";
    else if (k === "settings.providerOpenai") koTrans[k] = "OpenAI 호환";
    else if (k === "settings.sourceHint") koTrans[k] = "소스 언어는 auto를 사용할 수 있으며 스캐너는 en_us를 우선합니다.";
    else if (k === "settings.targetHint") koTrans[k] = "대상 언어는 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.";
    else if (k === "settings.invalidSourceLanguage") koTrans[k] = "소스 언어는 auto 또는 올바른 Minecraft locale code여야 합니다.";
    else if (k === "settings.invalidTargetLanguage") koTrans[k] = "대상 언어는 올바른 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.";
    else if (k === "settings.maxTokens") koTrans[k] = "Max tokens";
    else if (k === "settings.maxTokensHint") koTrans[k] = "응답 토큰 수 제한. 0 = 무제한(API 기본값). 번역 시 0 또는 큰 값(예: 32768) 권장.";
    else if (k === "settings.maxTokensPlaceholder") koTrans[k] = "0 = 무제한";
    else if (k === "settings.modelPlaceholder") koTrans[k] = "사용자 모델명 입력...";
    else if (k === "settings.noModels") koTrans[k] = "모델을 불러오지 않음";
    else if (k === "settings.selectModel") koTrans[k] = "모델 선택...";
    else if (k === "settings.customModel") koTrans[k] = "사용자 모델 입력";
    else if (k === "settings.pickFromList") koTrans[k] = "목록에서 선택";
    else if (k === "settings.modelsFetched") koTrans[k] = "{url}에서 {count}개 모델을 가져왔습니다";
    else if (k === "settings.card.apiParams") koTrans[k] = "API 매개변수";
    else if (k === "settings.card.concurrency") koTrans[k] = "동시 설정";
    else if (k === "settings.card.timeouts") koTrans[k] = "시간 초과 및 재시도";
    else if (k === "settings.card.dictionary") koTrans[k] = "사전";
    else if (k === "settings.provider") koTrans[k] = "공급자";
    else if (k === "settings.baseUrl") koTrans[k] = "기본 URL";
    else if (k === "settings.tab.performance") koTrans[k] = "성능";
    else if (k === "settings.tab.reuse") koTrans[k] = "재사용";
    else if (k === "settings.tab.logs") koTrans[k] = "로그";
    else if (k === "settings.tab.advanced") koTrans[k] = "고급 설정";
    else if (k === "settings.tab.appearance") koTrans[k] = "외관";
    else if (k === "settings.tab.language") koTrans[k] = "언어 및 번역";
    else if (k === "settings.tab.api") koTrans[k] = "API 설정";
    else if (k === "settings.loadingFonts") koTrans[k] = "로딩 중…";
    else if (k === "settings.apiKey") koTrans[k] = "API 키";
    else if (k === "settings.appLanguage") koTrans[k] = "앱 언어";
    else if (k === "settings.uiFont") koTrans[k] = "UI 글꼴";
    else if (k === "settings.uiFontOption.system") koTrans[k] = "시스템 기본";
    else if (k === "settings.uiFontPresets") koTrans[k] = "프리셋";
    else if (k === "settings.uiFontSystem") koTrans[k] = "시스템 글꼴 ({count}개)";
    else if (k === "settings.uiTheme") koTrans[k] = "테마";
    else if (k === "settings.uiDarkMode") koTrans[k] = "다크 모드";
    else if (k === "settings.uiDarkModeOn") koTrans[k] = "다크 모드로 전환";
    else if (k === "settings.uiDarkModeOff") koTrans[k] = "라이트 모드로 전환";
    else if (k === "settings.uiThemeOption.default") koTrans[k] = "클래식";
    else if (k === "settings.uiThemeOption.ocean") koTrans[k] = "오션 블루";
    else if (k === "settings.uiThemeOption.aurora") koTrans[k] = "오로라 퍼플";
    else if (k === "settings.uiThemeOption.gold") koTrans[k] = "앰버 골드";
    else if (k === "settings.systemPrompt") koTrans[k] = "시스템 프롬프트";
    else if (k === "settings.systemPromptHint") koTrans[k] = "AI 번역 도우미의 역할과 동작을 커스터마이즈합니다. 기본값으로 완전한 Minecraft 번역 전문가 설정이 제공됩니다.";
    else if (k === "settings.autosaveHint") koTrans[k] = "자동 저장 — 변경 사항이 자동으로 저장됩니다";
  }
  else if (k.startsWith("logs.")) {
    if (k === "logs.title") koTrans[k] = "로그";
    else if (k === "logs.subtitle") koTrans[k] = "1단계에서는 main, job, error 로그를 기록합니다. 전체 필터는 이후 단계에서 연결됩니다.";
    else if (k === "logs.recentJob") koTrans[k] = "최근 작업";
    else if (k === "logs.jobId") koTrans[k] = "작업 ID: {id}";
    else if (k === "logs.instance") koTrans[k] = "인스턴스: {path}";
    else if (k === "logs.warning") koTrans[k] = "warning: {count}";
    else if (k === "logs.empty") koTrans[k] = "아직 스캔 작업이 실행되지 않았습니다.";
    else if (k === "logs.pause") koTrans[k] = "일시정지";
    else if (k === "logs.resume") koTrans[k] = "재개";
    else if (k === "logs.copyAll") koTrans[k] = "모두 복사";
    else if (k === "logs.clear") koTrans[k] = "지우기";
    else if (k === "logs.allLevel") koTrans[k] = "모두";
    else if (k === "logs.paused") koTrans[k] = "로그 일시정지됨";
    else if (k === "logs.lines") koTrans[k] = "{count}줄";
    else if (k === "logs.linesWithTotal") koTrans[k] = "/ 총 {count}";
    else if (k === "logs.scrollToBottom") koTrans[k] = "맨 아래로";
  }
  else if (k.startsWith("packages.")) {
    if (k === "packages.title") koTrans[k] = "리소스팩 패키징";
    else if (k === "packages.subtitle") koTrans[k] = "번역 리소스팩을 생성하여 인스턴스에 배포";
    else if (k === "packages.generate") koTrans[k] = "리소스팩 생성";
    else if (k === "packages.noScan") koTrans[k] = "먼저 모드를 스캔하고 번역해주세요";
    else if (k === "packages.allMods") koTrans[k] = "모든 모드 ({count})";
    else if (k === "packages.entries_label") koTrans[k] = "{count}개 항목";
    else if (k === "packages.entryCount") koTrans[k] = "{count}개 번역";
    else if (k === "packages.failed_label") koTrans[k] = "실패";
    else if (k === "packages.files_label") koTrans[k] = "{count}개 파일";
    else if (k === "packages.modCount") koTrans[k] = "{count}개 모드";
    else if (k === "packages.noLangFiles") koTrans[k] = "언어 파일 없음";
    else if (k === "packages.noTranslation") koTrans[k] = "번역 결과가 없습니다. 먼저 번역을 완료해주세요.";
    else if (k === "packages.packDone") koTrans[k] = "패키징 완료";
    else if (k === "packages.packing") koTrans[k] = "패키징 중...";
    else if (k === "packages.packingPercent") koTrans[k] = "패키징 중 ({percent}%)";
    else if (k === "packages.ready") koTrans[k] = "준비됨";
    else if (k === "packages.regenerate") koTrans[k] = "재생성";
    else if (k === "packages.regenerateTooltip") koTrans[k] = "리소스 팩 재생성";
    else if (k === "packages.outputDir") koTrans[k] = "출력 폴더";
    else if (k === "packages.outputDirBrowse") koTrans[k] = "찾아보기...";
    else if (k === "packages.readyToPack") koTrans[k] = "번역 완료. '생성'을 클릭하여 팩 만들기";
    else if (k === "packages.reviewRequired") koTrans[k] = "현재 번역 작업이 아직 검토되지 않았습니다. '검토' 페이지에서 검토를 완료해주세요.";
  }
  else if (k.startsWith("packing.")) {
    if (k === "packing.translationPack") koTrans[k] = "번역 리소스팩";
    else if (k === "packing.packed") koTrans[k] = "패킹 완료 ✓";
  }
  else if (k.startsWith("splash.")) {
    if (k === "splash.phase.completed") koTrans[k] = "";
    else if (k === "splash.offline") koTrans[k] = "오프라인 모드";
    else if (k === "splash.firstLaunch") koTrans[k] = "첫 실행, 초기화 중…";
    else if (k === "splash.skip") koTrans[k] = "건너뛰고 계속";
  }
});

// ru translations
const ruTrans = {};
ruMiss.forEach(k => {
  if (k === "common.filterMin") ruTrans[k] = "Мин";
  else if (k === "common.filterMax") ruTrans[k] = "Макс";
  else if (k === "dictionary.empty") ruTrans[k] = "Словарь пуст. Сначала отсканируйте и переведите моды";
  else if (k === "editPanel.llmTranslateTooltip") ruTrans[k] = "LLM Перевод";
  else if (k === "jobs.retryFailed") ruTrans[k] = "Повторить ошибки";
  else if (k === "jobs.retrying") ruTrans[k] = "Повтор...";
  else if (k === "jobs.restart") ruTrans[k] = "Перевести заново";
  else if (k === "jobs.logPanel.colStatus") ruTrans[k] = "Статус";
  else if (k === "jobs.entryStatus.pending") ruTrans[k] = "Ожидает";
  else if (k === "jobs.entryStatus.dictionaryHit") ruTrans[k] = "Словарь";
  else if (k === "jobs.entryStatus.skip") ruTrans[k] = "Пропущено";
  else if (k === "jobs.entryStatus.translating") ruTrans[k] = "Перевод...";
  else if (k === "jobs.entryStatus.completed") ruTrans[k] = "Готово";
  else if (k === "jobs.entryStatus.failed") ruTrans[k] = "Ошибка";
  else if (k === "jobs.sourceType.existing") ruTrans[k] = "Существующий";
  else if (k === "jobs.sourceType.dictionary") ruTrans[k] = "Словарь";
  else if (k === "jobs.sourceType.llm") ruTrans[k] = "LLM";
  else if (k === "jobs.sourceType.skipped") ruTrans[k] = "Пропущено";
  else if (k === "jobs.sourceType.failed") ruTrans[k] = "Ошибка";
  else if (k === "jobs.sourceType.reviewed") ruTrans[k] = "Проверено";
  else if (k === "logs.pause") ruTrans[k] = "Пауза";
  else if (k === "logs.resume") ruTrans[k] = "Продолжить";
  else if (k === "logs.copyAll") ruTrans[k] = "Копировать всё";
  else if (k === "logs.clear") ruTrans[k] = "Очистить";
  else if (k === "logs.allLevel") ruTrans[k] = "Все";
  else if (k === "logs.paused") ruTrans[k] = "Лог приостановлен";
  else if (k === "logs.lines") ruTrans[k] = "{count} строк";
  else if (k === "logs.linesWithTotal") ruTrans[k] = "/ {count} всего";
  else if (k === "logs.scrollToBottom") ruTrans[k] = "Вниз";
  else if (k === "packages.title") ruTrans[k] = "Упаковка перевода";
  else if (k === "packages.subtitle") ruTrans[k] = "Генерация ресурс-пака с переводами";
  else if (k === "packages.entries_label") ruTrans[k] = "{count} записей";
  else if (k === "packages.entryCount") ruTrans[k] = "{count} переводов";
  else if (k === "packages.failed_label") ruTrans[k] = "Ошибка";
  else if (k === "packages.files_label") ruTrans[k] = "{count} файлов";
  else if (k === "packages.modCount") ruTrans[k] = "{count} модов";
  else if (k === "packages.noLangFiles") ruTrans[k] = "Нет языковых файлов";
  else if (k === "packages.noTranslation") ruTrans[k] = "Результаты перевода отсутствуют. Сначала выполните перевод.";
  else if (k === "packages.packingPercent") ruTrans[k] = "Упаковка ({percent}%)";
  else if (k === "packages.regenerate") ruTrans[k] = "Перегенерировать";
  else if (k === "packages.regenerateTooltip") ruTrans[k] = "Перегенерировать ресурс-пак";
  else if (k === "packages.outputDirBrowse") ruTrans[k] = "Обзор...";
  else if (k === "validate.col.modName") ruTrans[k] = "Имя мода";
  else if (k === "validate.col.modId") ruTrans[k] = "ID мода";
  else if (k === "validate.col.sourceText") ruTrans[k] = "Исходный";
  else if (k === "validate.col.targetText") ruTrans[k] = "Перевод";
  else if (k === "validate.col.sourceType") ruTrans[k] = "Тип";
  else if (k === "validate.summary") ruTrans[k] = "{count} переведено · {date} · {total} записей";
  else if (k === "validate.noJob") ruTrans[k] = "Задача перевода не найдена. Сначала выполните перевод.";
  else if (k === "validate.jobPending") ruTrans[k] = "Задача перевода ещё выполняется. Дождитесь завершения.";
  else if (k === "validate.title") ruTrans[k] = "Проверка переводов";
  else if (k === "validate.description") ruTrans[k] = "Проверьте результаты LLM перевода по одному, затем переходите к упаковке";
  else if (k === "validate.entries") ruTrans[k] = "{count} записей";
  else if (k === "settings.systemPrompt") ruTrans[k] = "Системный промпт";
  else if (k === "settings.systemPromptHint") ruTrans[k] = "Настройте роль и поведение AI переводчика. По умолчанию предоставлена полная настройка эксперта по переводу Minecraft.";
  else if (k === "settings.concurrencyHint") ruTrans[k] = "Параллельных запросов API (по умолчанию 10). Автоматически адаптируется к ограничениям — 429 вызывает автоматическую паузу.";
  else if (k === "settings.timeoutSecsHint") ruTrans[k] = "Таймаут запроса в секундах (по умолчанию 180). Увеличьте для больших пачек.";
  else if (k === "settings.retryCountHint") ruTrans[k] = "Количество повторов при ошибке (по умолчанию 5). Ошибки лимита запросов обрабатываются отдельно.";
  else if (k === "settings.rateLimitRpmHint") ruTrans[k] = "Максимум запросов в минуту (по умолчанию 3000). 0 = без лимита.";
  else if (k === "settings.batchSizeHint") ruTrans[k] = "Максимум записей в пачке (по умолчанию 80). Большие пачки эффективнее по токенам, но дольше выполняются.";
  else if (k === "splash.phase.completed") ruTrans[k] = "";
});

// Check coverage
console.log("jaJp translations generated:", Object.keys(jaTrans).length, "/", jaMiss.length);
console.log("koKr translations generated:", Object.keys(koTrans).length, "/", koMiss.length);
console.log("ruRu translations generated:", Object.keys(ruTrans).length, "/", ruMiss.length);

// Check for uncovered keys
jaMiss.forEach(k => { if (!(k in jaTrans)) console.log("UNCOVERED ja:", k); });
koMiss.forEach(k => { if (!(k in koTrans)) console.log("UNCOVERED ko:", k); });
ruMiss.forEach(k => { if (!(k in ruTrans)) console.log("UNCOVERED ru:", k); });

if (Object.keys(jaTrans).length !== jaMiss.length ||
    Object.keys(koTrans).length !== koMiss.length ||
    Object.keys(ruTrans).length !== ruMiss.length) {
  console.log("\nSome keys are uncovered! Fix before inserting.");
  process.exit(1);
}

// Insert translations
function insertBeforeClosing(section, translations) {
  const sorted = Object.keys(translations).sort();
  const code = "\n" + sorted.map(k => `  "${k}": "${translations[k]}",`).join("\n") + "\n";
  const insertPos = section.end - 1; // before the closing "}" (the end marker is after "}")
  return content.slice(0, insertPos) + code + content.slice(insertPos);
}

// Insert bottom-to-top so earlier insertions don't shift later section positions
content = insertBeforeClosing(ru, ruTrans);
content = insertBeforeClosing(ko, koTrans);
content = insertBeforeClosing(ja, jaTrans);

fs.writeFileSync(FILE, content, "utf-8");
console.log("\nFile written successfully!");
console.log("jaJp: inserted", Object.keys(jaTrans).length, "entries");
console.log("koKr: inserted", Object.keys(koTrans).length, "entries");
console.log("ruRu: inserted", Object.keys(ruTrans).length, "entries");
