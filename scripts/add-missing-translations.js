/**
 * Add missing translation entries for ja_jp, ko_kr, and ru_ru.
 * Run: node scripts/add-missing-translations.js
 */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve("src/i18n/translations.ts");
let content = fs.readFileSync(FILE, "utf-8");

function extractKVs(name) {
  const re = new RegExp(
    'const ' + name + ': TranslationMap = \\{([\\s\\S]*?)\\};'
  );
  const m = content.match(re);
  if (!m) return {};
  const pairs = {};
  const regex = /"([a-z_][a-zA-Z.]+)"\s*:\s*"([^"]*)"/g;
  let match;
  while ((match = regex.exec(m[1])) !== null) {
    if (!match[1].startsWith("...")) pairs[match[1]] = match[2];
  }
  return pairs;
}

const zhCn = extractKVs("zhCn");
const jaJp = extractKVs("jaJp");
const koKr = extractKVs("koKr");
const ruRu = extractKVs("ruRu");

function findMissing(kvs) {
  return Object.keys(zhCn).filter((k) => !(k in kvs));
}

const jaMiss = findMissing(jaJp);
const koMiss = findMissing(koKr);
const ruMiss = findMissing(ruRu);

console.log("jaJp missing:", jaMiss.length);
console.log("koKr missing:", koMiss.length);
console.log("ruRu missing:", ruMiss.length);

// Get zhCn values for reference
const zhValues = extractKVs("zhCn");

// Japanese translations for missing keys - follow existing jaJp patterns
const jaTranslations = {};
jaMiss.forEach((k) => {
  const zh = zhValues[k] || "";
  if (k === "common.loading") jaTranslations[k] = "読み込み中...";
  else if (k === "common.save") jaTranslations[k] = "保存";
  else if (k === "common.cancel") jaTranslations[k] = "キャンセル";
  else if (k === "common.copied") jaTranslations[k] = "コピーしました";
  else if (k === "common.delete") jaTranslations[k] = "削除";
  else if (k === "common.filterMin") jaTranslations[k] = "最小";
  else if (k === "common.filterMax") jaTranslations[k] = "最大";
  else if (k === "dashboard.scanProgress") jaTranslations[k] = "{current} / {total}";
  else if (k === "dashboard.instancePlaceholder") jaTranslations[k] = "E:/PCL2/.minecraft/versions/Aaalice Craft";
  else if (k === "dashboard.stats.resourcePackCovered") jaTranslations[k] = "リソースパックでカバー";
  else if (k === "dashboard.stats.resourcePackCoveredHint") jaTranslations[k] = "マッチしたソースキー";
  else if (k === "dashboard.stats.actualPending") jaTranslations[k] = "翻訳キュー合計";
  else if (k === "dashboard.stats.actualPendingHint") jaTranslations[k] = "翻訳が必要なエントリ（既存除く）";
  else if (k === "dashboard.column.pending") jaTranslations[k] = "未翻訳";
  else if (k === "dashboard.rangeFrom") jaTranslations[k] = "最小";
  else if (k === "dashboard.rangeTo") jaTranslations[k] = "最大";
  else if (k === "dashboard.resourceFilesEntries") jaTranslations[k] = "{files} ファイル / {entries} 項目";
  else if (k === "dashboard.filterAllFormats") jaTranslations[k] = "すべての形式";
  else if (k === "dashboard.filterAllStatus") jaTranslations[k] = "すべての状態";
  else if (k === "dashboard.gotIt") jaTranslations[k] = "確認";
  else if (k.startsWith("dictionary.")) {
    if (k === "dictionary.title") jaTranslations[k] = "辞書管理";
    else if (k === "dictionary.subtitle") jaTranslations[k] = "合計 {total} 件の辞書エントリ、{mods} 個のMod";
    else if (k === "dictionary.subtitleEmpty") jaTranslations[k] = "辞書がまだ読み込まれていません";
    else if (k === "dictionary.searchPlaceholder") jaTranslations[k] = "原文、翻訳、またはキーを検索...";
    else if (k === "dictionary.allTypes") jaTranslations[k] = "すべてのタイプ";
    else if (k === "dictionary.typeManual") jaTranslations[k] = "手動";
    else if (k === "dictionary.typeResourcepack") jaTranslations[k] = "リソースパック";
    else if (k === "dictionary.typeCfpa") jaTranslations[k] = "CFPA";
    else if (k === "dictionary.typeLlm") jaTranslations[k] = "LLM";
    else if (k === "dictionary.search") jaTranslations[k] = "検索";
    else if (k === "dictionary.export") jaTranslations[k] = "エクスポート";
    else if (k === "dictionary.import") jaTranslations[k] = "インポート";
    else if (k === "dictionary.empty") jaTranslations[k] = "辞書が空です。先にModをスキャンして翻訳してください";
    else if (k === "dictionary.col.source") jaTranslations[k] = "原文";
    else if (k === "dictionary.col.target") jaTranslations[k] = "訳文";
    else if (k === "dictionary.col.mod") jaTranslations[k] = "Mod";
    else if (k === "dictionary.col.key") jaTranslations[k] = "キー";
    else if (k === "dictionary.col.type") jaTranslations[k] = "タイプ";
    else if (k === "dictionary.col.actions") jaTranslations[k] = "操作";
    else if (k === "dictionary.clickToEdit") jaTranslations[k] = "クリックして編集";
    else if (k === "dictionary.saved") jaTranslations[k] = "保存しました";
    else if (k === "dictionary.deleted") jaTranslations[k] = "削除しました";
    else if (k === "dictionary.moreResults") jaTranslations[k] = "先頭500件を表示。あと {count} 件あります";
  }
  else if (k.startsWith("editPanel.")) {
    if (k === "editPanel.ariaClose") jaTranslations[k] = "閉じる";
    else if (k === "editPanel.ariaLabel") jaTranslations[k] = "翻訳編集パネル";
    else if (k === "editPanel.ariaTargetEdit") jaTranslations[k] = "訳文編集";
    else if (k === "editPanel.close") jaTranslations[k] = "閉じる";
    else if (k === "editPanel.copied") jaTranslations[k] = "コピーしました";
    else if (k === "editPanel.copySource") jaTranslations[k] = "原文をコピー";
    else if (k === "editPanel.entryNotFound") jaTranslations[k] = "エントリが見つかりません（フィルターで除外された可能性があります）";
    else if (k === "editPanel.llmFailed") jaTranslations[k] = "LLM翻訳に失敗しました";
    else if (k === "editPanel.llmTranslate") jaTranslations[k] = "LLM翻訳";
    else if (k === "editPanel.llmTranslateTooltip") jaTranslations[k] = "LLM翻訳";
    else if (k === "editPanel.nextTooltip") jaTranslations[k] = "次へ (→)";
    else if (k === "editPanel.prevTooltip") jaTranslations[k] = "前へ (←)";
    else if (k === "editPanel.retranslate") jaTranslations[k] = "再翻訳";
    else if (k === "editPanel.retry") jaTranslations[k] = "リトライ";
    else if (k === "editPanel.save") jaTranslations[k] = "保存";
    else if (k === "editPanel.translating") jaTranslations[k] = "翻訳中...";
    else if (k === "editPanel.accept") jaTranslations[k] = "採用";
    else if (k === "editPanel.shortcutPrev") jaTranslations[k] = "前へ";
    else if (k === "editPanel.shortcutNext") jaTranslations[k] = "次へ";
    else if (k === "editPanel.shortcutClose") jaTranslations[k] = "閉じる";
  }
  else if (k.startsWith("jobs.")) {
    if (k === "jobs.title") jaTranslations[k] = "翻訳タスク";
    else if (k === "jobs.subtitle") jaTranslations[k] = "翻訳プロセスを管理し、進捗と結果を確認";
    else if (k === "jobs.start") jaTranslations[k] = "翻訳を開始";
    else if (k === "jobs.running") jaTranslations[k] = "翻訳中...";
    else if (k === "jobs.stop") jaTranslations[k] = "停止";
    else if (k === "jobs.noScan") jaTranslations[k] = "先にMod言語ファイルをスキャンしてください";
    else if (k === "jobs.noPending") jaTranslations[k] = "すべてのエントリが翻訳済みか辞書にヒットしました";
    else if (k === "jobs.summary") jaTranslations[k] = "タスク概要";
    else if (k === "jobs.totalEntries") jaTranslations[k] = "翻訳待ちエントリ";
    else if (k === "jobs.sourceLang") jaTranslations[k] = "ソース言語";
    else if (k === "jobs.targetLang") jaTranslations[k] = "ターゲット言語";
    else if (k === "jobs.modCount") jaTranslations[k] = "Mod数";
    else if (k === "jobs.translating") jaTranslations[k] = "翻訳処理中";
    else if (k === "jobs.retryFailed") jaTranslations[k] = "失敗をリトライ";
    else if (k === "jobs.retrying") jaTranslations[k] = "リトライ中...";
    else if (k === "jobs.newTranslation") jaTranslations[k] = "新しい翻訳を開始";
    else if (k === "jobs.restart") jaTranslations[k] = "再翻訳";
    else if (k === "jobs.progressFallback") jaTranslations[k] = "- / -";
    else if (k === "jobs.logPanel.colStatus") jaTranslations[k] = "ステータス";
    else if (k === "jobs.entryStatus.pending") jaTranslations[k] = "未翻訳";
    else if (k === "jobs.entryStatus.dictionaryHit") jaTranslations[k] = "辞書ヒット";
    else if (k === "jobs.entryStatus.skip") jaTranslations[k] = "スキップ";
    else if (k === "jobs.entryStatus.translating") jaTranslations[k] = "翻訳中";
    else if (k === "jobs.entryStatus.completed") jaTranslations[k] = "完了";
    else if (k === "jobs.entryStatus.failed") jaTranslations[k] = "失敗";
    else if (k === "jobs.sourceType.existing") jaTranslations[k] = "既存翻訳";
    else if (k === "jobs.sourceType.dictionary") jaTranslations[k] = "辞書マッチ";
    else if (k === "jobs.sourceType.llm") jaTranslations[k] = "LLM翻訳";
    else if (k === "jobs.sourceType.skipped") jaTranslations[k] = "スキップ済み";
    else if (k === "jobs.sourceType.failed") jaTranslations[k] = "翻訳失敗";
    else if (k === "jobs.sourceType.reviewed") jaTranslations[k] = "レビュー済み";
  }
  else if (k.startsWith("tooltip.")) {
    if (k === "tooltip.dryRun") jaTranslations[k] = "翻訳内容をプレビュー";
    else if (k === "tooltip.validate") jaTranslations[k] = "パッケージを確認して生成";
  }
  else if (k.startsWith("summary.")) {
    if (k === "summary.scanCompleted") jaTranslations[k] = "スキャン完了";
    else if (k === "summary.translateCompleted") jaTranslations[k] = "翻訳完了";
    else if (k === "summary.elapsed") jaTranslations[k] = "経過時間";
    else if (k === "summary.existing") jaTranslations[k] = "既存 {count}";
  }
  else if (k.startsWith("validate.")) {
    if (k === "validate.summary") jaTranslations[k] = "{count} 件翻訳 · {date} · {total} 項目";
    else if (k === "validate.noJob") jaTranslations[k] = "翻訳ジョブが見つかりません。先に翻訳を完了してください。";
    else if (k === "validate.jobPending") jaTranslations[k] = "翻訳ジョブが実行中です。完了をお待ちください。";
    else if (k === "validate.doubleClickEdit") jaTranslations[k] = "ダブルクリックで編集";
    else if (k === "validate.title") jaTranslations[k] = "レビュー";
    else if (k === "validate.description") jaTranslations[k] = "LLM翻訳結果を1件ずつ確認し、レビュー完了後にパッケージに進めます";
    else if (k === "validate.entries") jaTranslations[k] = "{count} 件";
    else if (k === "validate.loading") jaTranslations[k] = "読み込み中...";
    else if (k === "validate.markDone") jaTranslations[k] = "レビュー完了";
    else if (k === "validate.noMatch") jaTranslations[k] = "一致するエントリがありません";
    else if (k === "validate.noResults") jaTranslations[k] = "翻訳結果がありません";
    else if (k === "validate.reviewed") jaTranslations[k] = "レビュー済み";
    else if (k === "validate.searchPlaceholder") jaTranslations[k] = "Mod名、ModId、キー、原文、訳文を検索...";
  }
  else if (k.startsWith("settings.")) {
    if (k === "settings.temperature") jaTranslations[k] = "Temperature";
    else if (k === "settings.batchSize") jaTranslations[k] = "Batch size";
    else if (k === "settings.batchSizeHint") jaTranslations[k] = "1バッチあたりの最大エントリ数（デフォルト80）。大きいバッチはトークン効率が良いが応答時間が長くなります。";
    else if (k === "settings.concurrencyHint") jaTranslations[k] = "同時APIリクエスト数（デフォルト10）。429応答時に自動的にバックオフします。";
    else if (k === "settings.timeoutSecsHint") jaTranslations[k] = "1リクエストあたりのタイムアウト秒数（デフォルト180）。大量バッチでは増やしてください。";
    else if (k === "settings.retryCountHint") jaTranslations[k] = "失敗時のリトライ回数（デフォルト5）。レート制限による失敗は特別処理されます。";
    else if (k === "settings.rateLimitRpmHint") jaTranslations[k] = "1分あたりの最大リクエスト数（デフォルト3000）。0 = 無制限。";
    else if (k === "settings.preferDictionary") jaTranslations[k] = "ユーザー辞書を優先";
    else if (k === "settings.resetMainLog") jaTranslations[k] = "起動時に main.log をリセット";
    else if (k === "settings.enableDebug") jaTranslations[k] = "デバッグログを有効化";
    else if (k === "settings.enableHttp") jaTranslations[k] = "HTTPリクエストログを有効化";
    else if (k === "settings.defaultInstance") jaTranslations[k] = "デフォルトインスタンスパス";
    else if (k === "settings.translationPacks") jaTranslations[k] = "翻訳リソースパック";
    else if (k === "settings.resourcePackName") jaTranslations[k] = "リソースパックファイル名";
    else if (k === "settings.resourcePackHint") jaTranslations[k] = "スキャナーは resourcepacks/ 内をこの名前で検索します";
    else if (k === "settings.addPack") jaTranslations[k] = "リソースパックを追加";
    else if (k === "settings.removePack") jaTranslations[k] = "削除";
    else if (k === "settings.packPlaceholder") jaTranslations[k] = "例: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip";
    else if (k === "settings.packDefaultI18n") jaTranslations[k] = "デフォルトで CFPAOrg (i18n) と VM 翻訳パックを含みます";
    else if (k === "settings.outputPackName") jaTranslations[k] = "出力リソースパック名";
    else if (k === "settings.placeholderHint") jaTranslations[k] = "{{mc_version}} プレースホルダーでインスタンスバージョンに自動置換";
    else if (k === "settings.futureAdvanced") jaTranslations[k] = "辞書、パッケージング、実験機能の設定は後続フェーズで接続します。";
    else if (k === "settings.providerOpenai") jaTranslations[k] = "OpenAI 互換";
    else if (k === "settings.sourceHint") jaTranslations[k] = "ソース言語は auto を指定可能。スキャナーは en_us を優先します。";
    else if (k === "settings.targetHint") jaTranslations[k] = "ターゲット言語は Minecraft locale code にする必要があります。auto は使えません。";
    else if (k === "settings.invalidSourceLanguage") jaTranslations[k] = "ソース言語は auto または有効な Minecraft locale code にしてください。";
    else if (k === "settings.invalidTargetLanguage") jaTranslations[k] = "ターゲット言語は有効な Minecraft locale code にしてください。auto は使えません。";
    else if (k === "settings.maxTokensHint") jaTranslations[k] = "応答トークン数を制限。0 = 無制限（APIデフォルト）。翻訳では0または大きい値（32768など）を推奨。";
    else if (k === "settings.maxTokensPlaceholder") jaTranslations[k] = "0 = 無制限";
    else if (k === "settings.modelPlaceholder") jaTranslations[k] = "カスタムモデル名を入力...";
    else if (k === "settings.noModels") jaTranslations[k] = "モデルが取得されていません";
    else if (k === "settings.selectModel") jaTranslations[k] = "モデルを選択...";
    else if (k === "settings.customModel") jaTranslations[k] = "カスタムモデルを入力";
    else if (k === "settings.pickFromList") jaTranslations[k] = "リストから選択";
    else if (k === "settings.modelsFetched") jaTranslations[k] = "{url} から {count} 個のモデルを取得しました";
    else if (k === "settings.card.apiParams") jaTranslations[k] = "API パラメーター";
    else if (k === "settings.card.concurrency") jaTranslations[k] = "並列設定";
    else if (k === "settings.card.timeouts") jaTranslations[k] = "タイムアウトとリトライ";
    else if (k === "settings.card.dictionary") jaTranslations[k] = "辞書";
    else if (k === "settings.provider") jaTranslations[k] = "プロバイダー";
    else if (k === "settings.baseUrl") jaTranslations[k] = "ベースURL";
    else if (k === "settings.tab.performance") jaTranslations[k] = "パフォーマンス";
    else if (k === "settings.tab.reuse") jaTranslations[k] = "再利用";
    else if (k === "settings.tab.logs") jaTranslations[k] = "ログ";
    else if (k === "settings.tab.advanced") jaTranslations[k] = "詳細設定";
    else if (k === "settings.tab.appearance") jaTranslations[k] = "外観";
    else if (k === "settings.tab.language") jaTranslations[k] = "言語と翻訳";
    else if (k === "settings.tab.api") jaTranslations[k] = "API設定";
    else if (k === "settings.loadingFonts") jaTranslations[k] = "読み込み中…";
    else if (k === "settings.apiKey") jaTranslations[k] = "APIキー";
    else if (k === "settings.appLanguage") jaTranslations[k] = "アプリ言語";
    else if (k === "settings.uiFont") jaTranslations[k] = "UIフォント";
    else if (k === "settings.uiFontOption.system") jaTranslations[k] = "システムデフォルト";
    else if (k === "settings.uiFontPresets") jaTranslations[k] = "プリセット";
    else if (k === "settings.uiFontSystem") jaTranslations[k] = "システムフォント（{count}）";
    else if (k === "settings.uiTheme") jaTranslations[k] = "テーマ";
    else if (k === "settings.uiDarkMode") jaTranslations[k] = "ダークモード";
    else if (k === "settings.uiDarkModeOn") jaTranslations[k] = "ダークモードに切り替え";
    else if (k === "settings.uiDarkModeOff") jaTranslations[k] = "ライトモードに切り替え";
    else if (k === "settings.uiThemeOption.default") jaTranslations[k] = "クラシック";
    else if (k === "settings.uiThemeOption.ocean") jaTranslations[k] = "オーシャンブルー";
    else if (k === "settings.uiThemeOption.aurora") jaTranslations[k] = "オーロラパープル";
    else if (k === "settings.uiThemeOption.gold") jaTranslations[k] = "アンバーゴールド";
    else if (k === "settings.systemPrompt") jaTranslations[k] = "システムプロンプト";
    else if (k === "settings.systemPromptHint") jaTranslations[k] = "AI翻訳アシスタントのロールと動作をカスタマイズ。デフォルトで完全なMinecraft翻訳エキスパート設定が提供されます。";
    else if (k === "settings.autosaveHint") jaTranslations[k] = "自動保存 — 変更は自動的に保存されます";
  }
  else if (k.startsWith("logs.")) {
    if (k === "logs.title") jaTranslations[k] = "ログ";
    else if (k === "logs.subtitle") jaTranslations[k] = "フェーズ1ではmain、job、errorログを書き込みます。完全なフィルターは後続フェーズで接続します。";
    else if (k === "logs.recentJob") jaTranslations[k] = "最近のジョブ";
    else if (k === "logs.jobId") jaTranslations[k] = "ジョブID：{id}";
    else if (k === "logs.instance") jaTranslations[k] = "インスタンス：{path}";
    else if (k === "logs.warning") jaTranslations[k] = "warning：{count}";
    else if (k === "logs.empty") jaTranslations[k] = "まだスキャンジョブが実行されていません。";
    else if (k === "logs.pause") jaTranslations[k] = "一時停止";
    else if (k === "logs.resume") jaTranslations[k] = "再開";
    else if (k === "logs.copyAll") jaTranslations[k] = "すべてコピー";
    else if (k === "logs.clear") jaTranslations[k] = "クリア";
    else if (k === "logs.allLevel") jaTranslations[k] = "すべて";
    else if (k === "logs.paused") jaTranslations[k] = "ログ一時停止中";
    else if (k === "logs.lines") jaTranslations[k] = "{count} 行";
    else if (k === "logs.linesWithTotal") jaTranslations[k] = "/ {count} 全体";
    else if (k === "logs.scrollToBottom") jaTranslations[k] = "最下部へ";
  }
  else if (k.startsWith("packages.")) {
    if (k === "packages.title") jaTranslations[k] = "リソースパックパッケージング";
    else if (k === "packages.subtitle") jaTranslations[k] = "翻訳リソースパックを生成してインスタンスにデプロイ";
    else if (k === "packages.generate") jaTranslations[k] = "リソースパックを生成";
    else if (k === "packages.noScan") jaTranslations[k] = "先にModをスキャンして翻訳してください";
    else if (k === "packages.allMods") jaTranslations[k] = "すべてのMod ({count})";
    else if (k === "packages.entries_label") jaTranslations[k] = "{count} 項目";
    else if (k === "packages.entryCount") jaTranslations[k] = "{count} 翻訳";
    else if (k === "packages.failed_label") jaTranslations[k] = "失敗";
    else if (k === "packages.files_label") jaTranslations[k] = "{count} ファイル";
    else if (k === "packages.modCount") jaTranslations[k] = "{count} 個のMod";
    else if (k === "packages.noLangFiles") jaTranslations[k] = "言語ファイルなし";
    else if (k === "packages.noTranslation") jaTranslations[k] = "翻訳結果がありません。先に翻訳を完了してください。";
    else if (k === "packages.packDone") jaTranslations[k] = "パッケージ完了";
    else if (k === "packages.packing") jaTranslations[k] = "パッケージ中...";
    else if (k === "packages.packingPercent") jaTranslations[k] = "パッケージ中 ({percent}%)";
    else if (k === "packages.ready") jaTranslations[k] = "準備完了";
    else if (k === "packages.regenerate") jaTranslations[k] = "再生成";
    else if (k === "packages.regenerateTooltip") jaTranslations[k] = "リソースパックを再生成";
    else if (k === "packages.outputDir") jaTranslations[k] = "出力先";
    else if (k === "packages.outputDirBrowse") jaTranslations[k] = "参照...";
    else if (k === "packages.readyToPack") jaTranslations[k] = "翻訳完了。「生成」をクリックしてパックを作成";
    else if (k === "packages.reviewRequired") jaTranslations[k] = "現在の翻訳ジョブはまだレビューされていません。先に「レビュー」ページでレビューを完了してください。";
  }
  else if (k.startsWith("packing.")) {
    if (k === "packing.translationPack") jaTranslations[k] = "翻訳リソースパック";
    else if (k === "packing.packed") jaTranslations[k] = "パック完了 ✓";
  }
  else if (k.startsWith("splash.")) {
    if (k === "splash.phase.completed") jaTranslations[k] = "";
    else if (k === "splash.offline") jaTranslations[k] = "オフラインモード";
    else if (k === "splash.firstLaunch") jaTranslations[k] = "初回起動、初期化中…";
    else if (k === "splash.skip") jaTranslations[k] = "スキップして続行";
  }
});

// Get enUs values for Korean (koKr tends to follow enUs patterns)
const enValues = extractKVs("enUs");

// Korean translations for missing keys - follow existing koKr patterns
const koTranslations = {};
koMiss.forEach((k) => {
  const en = enValues[k] || "";
  if (k === "common.loading") koTranslations[k] = "로딩 중...";
  else if (k === "common.save") koTranslations[k] = "저장";
  else if (k === "common.cancel") koTranslations[k] = "취소";
  else if (k === "common.copied") koTranslations[k] = "복사됨";
  else if (k === "common.delete") koTranslations[k] = "삭제";
  else if (k === "common.filterMin") koTranslations[k] = "최소";
  else if (k === "common.filterMax") koTranslations[k] = "최대";
  else if (k === "dashboard.scanProgress") koTranslations[k] = "{current} / {total}";
  else if (k === "dashboard.instancePlaceholder") koTranslations[k] = "E:/PCL2/.minecraft/versions/Aaalice Craft";
  else if (k === "dashboard.stats.resourcePackCovered") koTranslations[k] = "리소스팩으로 커버";
  else if (k === "dashboard.stats.resourcePackCoveredHint") koTranslations[k] = "일치한 소스 키";
  else if (k === "dashboard.stats.actualPending") koTranslations[k] = "번역 대기열 합계";
  else if (k === "dashboard.stats.actualPendingHint") koTranslations[k] = "번역이 필요한 항목 (기존 번역 제외)";
  else if (k === "dashboard.column.pending") koTranslations[k] = "번역 대기";
  else if (k === "dashboard.rangeFrom") koTranslations[k] = "최소";
  else if (k === "dashboard.rangeTo") koTranslations[k] = "최대";
  else if (k === "dashboard.resourceFilesEntries") koTranslations[k] = "{files}개 파일 / {entries}개 항목";
  else if (k === "dashboard.filterAllFormats") koTranslations[k] = "모든 형식";
  else if (k === "dashboard.filterAllStatus") koTranslations[k] = "모든 상태";
  else if (k === "dashboard.gotIt") koTranslations[k] = "확인";
  else if (k.startsWith("dictionary.")) {
    if (k === "dictionary.title") koTranslations[k] = "사전 관리";
    else if (k === "dictionary.subtitle") koTranslations[k] = "총 {total}개 사전 항목, {mods}개 모드";
    else if (k === "dictionary.subtitleEmpty") koTranslations[k] = "사전이 아직 로드되지 않음";
    else if (k === "dictionary.searchPlaceholder") koTranslations[k] = "원문, 번역문 또는 키 검색...";
    else if (k === "dictionary.allTypes") koTranslations[k] = "모든 유형";
    else if (k === "dictionary.typeManual") koTranslations[k] = "수동";
    else if (k === "dictionary.typeResourcepack") koTranslations[k] = "리소스팩";
    else if (k === "dictionary.typeCfpa") koTranslations[k] = "CFPA";
    else if (k === "dictionary.typeLlm") koTranslations[k] = "LLM";
    else if (k === "dictionary.search") koTranslations[k] = "검색";
    else if (k === "dictionary.export") koTranslations[k] = "내보내기";
    else if (k === "dictionary.import") koTranslations[k] = "가져오기";
    else if (k === "dictionary.empty") koTranslations[k] = "사전이 비어 있습니다. 먼저 모드를 스캔하고 번역해주세요";
    else if (k === "dictionary.col.source") koTranslations[k] = "원문";
    else if (k === "dictionary.col.target") koTranslations[k] = "번역문";
    else if (k === "dictionary.col.mod") koTranslations[k] = "모드";
    else if (k === "dictionary.col.key") koTranslations[k] = "키";
    else if (k === "dictionary.col.type") koTranslations[k] = "유형";
    else if (k === "dictionary.col.actions") koTranslations[k] = "작업";
    else if (k === "dictionary.clickToEdit") koTranslations[k] = "클릭하여 편집";
    else if (k === "dictionary.saved") koTranslations[k] = "저장됨";
    else if (k === "dictionary.deleted") koTranslations[k] = "삭제됨";
    else if (k === "dictionary.moreResults") koTranslations[k] = "처음 500개 표시. {count}개 더 있음";
  }
  else if (k.startsWith("editPanel.")) {
    if (k === "editPanel.ariaClose") koTranslations[k] = "닫기";
    else if (k === "editPanel.ariaLabel") koTranslations[k] = "번역 편집 패널";
    else if (k === "editPanel.ariaTargetEdit") koTranslations[k] = "번역문 편집";
    else if (k === "editPanel.close") koTranslations[k] = "닫기";
    else if (k === "editPanel.copied") koTranslations[k] = "복사됨";
    else if (k === "editPanel.copySource") koTranslations[k] = "원문 복사";
    else if (k === "editPanel.entryNotFound") koTranslations[k] = "항목을 찾을 수 없음 (필터에서 제외됨)";
    else if (k === "editPanel.llmFailed") koTranslations[k] = "LLM 번역 실패";
    else if (k === "editPanel.llmTranslate") koTranslations[k] = "LLM 번역";
    else if (k === "editPanel.llmTranslateTooltip") koTranslations[k] = "LLM 번역";
    else if (k === "editPanel.nextTooltip") koTranslations[k] = "다음 (→)";
    else if (k === "editPanel.prevTooltip") koTranslations[k] = "이전 (←)";
    else if (k === "editPanel.retranslate") koTranslations[k] = "다시 번역";
    else if (k === "editPanel.retry") koTranslations[k] = "재시도";
    else if (k === "editPanel.save") koTranslations[k] = "저장";
    else if (k === "editPanel.translating") koTranslations[k] = "번역 중...";
    else if (k === "editPanel.accept") koTranslations[k] = "적용";
    else if (k === "editPanel.shortcutPrev") koTranslations[k] = "이전";
    else if (k === "editPanel.shortcutNext") koTranslations[k] = "다음";
    else if (k === "editPanel.shortcutClose") koTranslations[k] = "닫기";
  }
  else if (k.startsWith("jobs.")) {
    if (k === "jobs.title") koTranslations[k] = "번역 작업";
    else if (k === "jobs.subtitle") koTranslations[k] = "번역 프로세스를 관리하고 진행 상황 확인";
    else if (k === "jobs.start") koTranslations[k] = "번역 시작";
    else if (k === "jobs.running") koTranslations[k] = "번역 중...";
    else if (k === "jobs.stop") koTranslations[k] = "중지";
    else if (k === "jobs.noScan") koTranslations[k] = "먼저 모드 언어 파일을 스캔해주세요";
    else if (k === "jobs.noPending") koTranslations[k] = "모든 항목이 번역되었거나 사전에 있습니다";
    else if (k === "jobs.summary") koTranslations[k] = "작업 요약";
    else if (k === "jobs.totalEntries") koTranslations[k] = "번역 대기 항목";
    else if (k === "jobs.sourceLang") koTranslations[k] = "소스 언어";
    else if (k === "jobs.targetLang") koTranslations[k] = "대상 언어";
    else if (k === "jobs.modCount") koTranslations[k] = "모드 수";
    else if (k === "jobs.translating") koTranslations[k] = "번역 처리 중";
    else if (k === "jobs.retryFailed") koTranslations[k] = "실패 재시도";
    else if (k === "jobs.retrying") koTranslations[k] = "재시도 중...";
    else if (k === "jobs.newTranslation") koTranslations[k] = "새 번역 시작";
    else if (k === "jobs.restart") koTranslations[k] = "다시 번역";
    else if (k === "jobs.progressFallback") koTranslations[k] = "- / -";
    else if (k === "jobs.logPanel.colStatus") koTranslations[k] = "상태";
    else if (k === "jobs.entryStatus.pending") koTranslations[k] = "번역 대기";
    else if (k === "jobs.entryStatus.dictionaryHit") koTranslations[k] = "사전 일치";
    else if (k === "jobs.entryStatus.skip") koTranslations[k] = "건너뜀";
    else if (k === "jobs.entryStatus.translating") koTranslations[k] = "번역 중";
    else if (k === "jobs.entryStatus.completed") koTranslations[k] = "완료";
    else if (k === "jobs.entryStatus.failed") koTranslations[k] = "실패";
    else if (k === "jobs.sourceType.existing") koTranslations[k] = "기존 번역";
    else if (k === "jobs.sourceType.dictionary") koTranslations[k] = "사전 일치";
    else if (k === "jobs.sourceType.llm") koTranslations[k] = "LLM 번역";
    else if (k === "jobs.sourceType.skipped") koTranslations[k] = "건너뜀";
    else if (k === "jobs.sourceType.failed") koTranslations[k] = "번역 실패";
    else if (k === "jobs.sourceType.reviewed") koTranslations[k] = "검토됨";
  }
  else if (k.startsWith("tooltip.")) {
    if (k === "tooltip.dryRun") koTranslations[k] = "번역 내용 미리보기";
    else if (k === "tooltip.validate") koTranslations[k] = "패키징 확인 및 생성";
  }
  else if (k.startsWith("summary.")) {
    if (k === "summary.scanCompleted") koTranslations[k] = "스캔 완료";
    else if (k === "summary.translateCompleted") koTranslations[k] = "번역 완료";
    else if (k === "summary.elapsed") koTranslations[k] = "경과 시간";
    else if (k === "summary.existing") koTranslations[k] = "기존 {count}";
  }
  else if (k.startsWith("validate.")) {
    if (k === "validate.summary") koTranslations[k] = "{count}개 번역 · {date} · {total}개 항목";
    else if (k === "validate.noJob") koTranslations[k] = "번역 작업을 찾을 수 없습니다. 먼저 번역을 완료해주세요.";
    else if (k === "validate.jobPending") koTranslations[k] = "번역 작업이 실행 중입니다. 완료될 때까지 기다려주세요.";
    else if (k === "validate.doubleClickEdit") koTranslations[k] = "더블클릭하여 편집";
    else if (k === "validate.title") koTranslations[k] = "검토";
    else if (k === "validate.description") koTranslations[k] = "LLM 번역 결과를 하나씩 검토하고 완료 후 패키징으로 진행";
    else if (k === "validate.entries") koTranslations[k] = "{count}개";
    else if (k === "validate.loading") koTranslations[k] = "로딩 중...";
    else if (k === "validate.markDone") koTranslations[k] = "검토 완료";
    else if (k === "validate.noMatch") koTranslations[k] = "일치하는 항목 없음";
    else if (k === "validate.noResults") koTranslations[k] = "번역 결과 없음";
    else if (k === "validate.reviewed") koTranslations[k] = "검토됨";
    else if (k === "validate.searchPlaceholder") koTranslations[k] = "모드명, ModId, 키, 원문 또는 번역문 검색...";
  }
  else if (k.startsWith("settings.")) {
    if (k === "settings.temperature") koTranslations[k] = "Temperature";
    else if (k === "settings.batchSize") koTranslations[k] = "Batch size";
    else if (k === "settings.batchSizeHint") koTranslations[k] = "배치당 최대 항목 수(기본 80). 큰 배치는 토큰 효율이 좋지만 응답 시간이 길어집니다.";
    else if (k === "settings.concurrencyHint") koTranslations[k] = "동시 API 요청 수(기본 10). 429 응답 시 자동 백오프됩니다.";
    else if (k === "settings.timeoutSecsHint") koTranslations[k] = "요청당 타임아웃(초) (기본 180). 대량 배치 시 증가하세요.";
    else if (k === "settings.retryCountHint") koTranslations[k] = "실패 시 재시도 횟수(기본 5). 속도 제한 실패는 특별 처리됩니다.";
    else if (k === "settings.rateLimitRpmHint") koTranslations[k] = "분당 최대 요청 수(기본 3000). 0 = 무제한.";
    else if (k === "settings.preferDictionary") koTranslations[k] = "사용자 사전 우선";
    else if (k === "settings.resetMainLog") koTranslations[k] = "시작 시 main.log 초기화";
    else if (k === "settings.enableDebug") koTranslations[k] = "디버그 로그 활성화";
    else if (k === "settings.enableHttp") koTranslations[k] = "HTTP 요청 로그 활성화";
    else if (k === "settings.defaultInstance") koTranslations[k] = "기본 인스턴스 경로";
    else if (k === "settings.translationPacks") koTranslations[k] = "번역 리소스 팩";
    else if (k === "settings.resourcePackName") koTranslations[k] = "리소스 팩 파일명";
    else if (k === "settings.resourcePackHint") koTranslations[k] = "스캐너가 resourcepacks/ 에서 이 이름으로 검색합니다";
    else if (k === "settings.addPack") koTranslations[k] = "팩 추가";
    else if (k === "settings.removePack") koTranslations[k] = "삭제";
    else if (k === "settings.packPlaceholder") koTranslations[k] = "예: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip";
    else if (k === "settings.packDefaultI18n") koTranslations[k] = "기본적으로 CFPAOrg (i18n) 및 VM 번역 팩 포함";
    else if (k === "settings.outputPackName") koTranslations[k] = "출력 리소스 팩 이름";
    else if (k === "settings.placeholderHint") koTranslations[k] = "{{mc_version}} 플레이스홀더로 인스턴스 버전 자동 대체";
    else if (k === "settings.futureAdvanced") koTranslations[k] = "사전, 패키징, 실험 기능 설정은 이후 단계에서 연결됩니다.";
    else if (k === "settings.providerOpenai") koTranslations[k] = "OpenAI 호환";
    else if (k === "settings.sourceHint") koTranslations[k] = "소스 언어는 auto를 사용할 수 있으며 스캐너는 en_us를 우선합니다.";
    else if (k === "settings.targetHint") koTranslations[k] = "대상 언어는 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.";
    else if (k === "settings.invalidSourceLanguage") koTranslations[k] = "소스 언어는 auto 또는 올바른 Minecraft locale code여야 합니다.";
    else if (k === "settings.invalidTargetLanguage") koTranslations[k] = "대상 언어는 올바른 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.";
    else if (k === "settings.maxTokensHint") koTranslations[k] = "응답 토큰 수 제한. 0 = 무제한(API 기본값). 번역 시 0 또는 큰 값(예: 32768) 권장.";
    else if (k === "settings.maxTokensPlaceholder") koTranslations[k] = "0 = 무제한";
    else if (k === "settings.modelPlaceholder") koTranslations[k] = "사용자 모델명 입력...";
    else if (k === "settings.noModels") koTranslations[k] = "모델을 불러오지 않음";
    else if (k === "settings.selectModel") koTranslations[k] = "모델 선택...";
    else if (k === "settings.customModel") koTranslations[k] = "사용자 모델 입력";
    else if (k === "settings.pickFromList") koTranslations[k] = "목록에서 선택";
    else if (k === "settings.modelsFetched") koTranslations[k] = "{url}에서 {count}개 모델을 가져왔습니다";
    else if (k === "settings.card.apiParams") koTranslations[k] = "API 매개변수";
    else if (k === "settings.card.concurrency") koTranslations[k] = "동시 설정";
    else if (k === "settings.card.timeouts") koTranslations[k] = "시간 초과 및 재시도";
    else if (k === "settings.card.dictionary") koTranslations[k] = "사전";
    else if (k === "settings.provider") koTranslations[k] = "공급자";
    else if (k === "settings.baseUrl") koTranslations[k] = "기본 URL";
    else if (k === "settings.tab.performance") koTranslations[k] = "성능";
    else if (k === "settings.tab.reuse") koTranslations[k] = "재사용";
    else if (k === "settings.tab.logs") koTranslations[k] = "로그";
    else if (k === "settings.tab.advanced") koTranslations[k] = "고급 설정";
    else if (k === "settings.tab.appearance") koTranslations[k] = "외관";
    else if (k === "settings.tab.language") koTranslations[k] = "언어 및 번역";
    else if (k === "settings.tab.api") koTranslations[k] = "API 설정";
    else if (k === "settings.loadingFonts") koTranslations[k] = "로딩 중…";
    else if (k === "settings.apiKey") koTranslations[k] = "API 키";
    else if (k === "settings.appLanguage") koTranslations[k] = "앱 언어";
    else if (k === "settings.uiFont") koTranslations[k] = "UI 글꼴";
    else if (k === "settings.uiFontOption.system") koTranslations[k] = "시스템 기본";
    else if (k === "settings.uiFontPresets") koTranslations[k] = "프리셋";
    else if (k === "settings.uiFontSystem") koTranslations[k] = "시스템 글꼴 ({count}개)";
    else if (k === "settings.uiTheme") koTranslations[k] = "테마";
    else if (k === "settings.uiDarkMode") koTranslations[k] = "다크 모드";
    else if (k === "settings.uiDarkModeOn") koTranslations[k] = "다크 모드로 전환";
    else if (k === "settings.uiDarkModeOff") koTranslations[k] = "라이트 모드로 전환";
    else if (k === "settings.uiThemeOption.default") koTranslations[k] = "클래식";
    else if (k === "settings.uiThemeOption.ocean") koTranslations[k] = "오션 블루";
    else if (k === "settings.uiThemeOption.aurora") koTranslations[k] = "오로라 퍼플";
    else if (k === "settings.uiThemeOption.gold") koTranslations[k] = "앰버 골드";
    else if (k === "settings.systemPrompt") koTranslations[k] = "시스템 프롬프트";
    else if (k === "settings.systemPromptHint") koTranslations[k] = "AI 번역 도우미의 역할과 동작을 커스터마이즈합니다. 기본값으로 완전한 Minecraft 번역 전문가 설정이 제공됩니다.";
    else if (k === "settings.autosaveHint") koTranslations[k] = "자동 저장 — 변경 사항이 자동으로 저장됩니다";
  }
  else if (k.startsWith("logs.")) {
    if (k === "logs.title") koTranslations[k] = "로그";
    else if (k === "logs.subtitle") koTranslations[k] = "1단계에서는 main, job, error 로그를 기록합니다. 전체 필터는 이후 단계에서 연결됩니다.";
    else if (k === "logs.recentJob") koTranslations[k] = "최근 작업";
    else if (k === "logs.jobId") koTranslations[k] = "작업 ID: {id}";
    else if (k === "logs.instance") koTranslations[k] = "인스턴스: {path}";
    else if (k === "logs.warning") koTranslations[k] = "warning: {count}";
    else if (k === "logs.empty") koTranslations[k] = "아직 스캔 작업이 실행되지 않았습니다.";
    else if (k === "logs.pause") koTranslations[k] = "일시정지";
    else if (k === "logs.resume") koTranslations[k] = "재개";
    else if (k === "logs.copyAll") koTranslations[k] = "모두 복사";
    else if (k === "logs.clear") koTranslations[k] = "지우기";
    else if (k === "logs.allLevel") koTranslations[k] = "모두";
    else if (k === "logs.paused") koTranslations[k] = "로그 일시정지됨";
    else if (k === "logs.lines") koTranslations[k] = "{count}줄";
    else if (k === "logs.linesWithTotal") koTranslations[k] = "/ 총 {count}";
    else if (k === "logs.scrollToBottom") koTranslations[k] = "맨 아래로";
  }
  else if (k.startsWith("packages.")) {
    if (k === "packages.title") koTranslations[k] = "리소스팩 패키징";
    else if (k === "packages.subtitle") koTranslations[k] = "번역 리소스팩을 생성하여 인스턴스에 배포";
    else if (k === "packages.generate") koTranslations[k] = "리소스팩 생성";
    else if (k === "packages.noScan") koTranslations[k] = "먼저 모드를 스캔하고 번역해주세요";
    else if (k === "packages.allMods") koTranslations[k] = "모든 모드 ({count})";
    else if (k === "packages.entries_label") koTranslations[k] = "{count}개 항목";
    else if (k === "packages.entryCount") koTranslations[k] = "{count}개 번역";
    else if (k === "packages.failed_label") koTranslations[k] = "실패";
    else if (k === "packages.files_label") koTranslations[k] = "{count}개 파일";
    else if (k === "packages.modCount") koTranslations[k] = "{count}개 모드";
    else if (k === "packages.noLangFiles") koTranslations[k] = "언어 파일 없음";
    else if (k === "packages.noTranslation") koTranslations[k] = "번역 결과가 없습니다. 먼저 번역을 완료해주세요.";
    else if (k === "packages.packDone") koTranslations[k] = "패키징 완료";
    else if (k === "packages.packing") koTranslations[k] = "패키징 중...";
    else if (k === "packages.packingPercent") koTranslations[k] = "패키징 중 ({percent}%)";
    else if (k === "packages.ready") koTranslations[k] = "준비됨";
    else if (k === "packages.regenerate") koTranslations[k] = "재생성";
    else if (k === "packages.regenerateTooltip") koTranslations[k] = "리소스 팩 재생성";
    else if (k === "packages.outputDir") koTranslations[k] = "출력 폴더";
    else if (k === "packages.outputDirBrowse") koTranslations[k] = "찾아보기...";
    else if (k === "packages.readyToPack") koTranslations[k] = "번역 완료. '생성'을 클릭하여 팩 만들기";
    else if (k === "packages.reviewRequired") koTranslations[k] = "현재 번역 작업이 아직 검토되지 않았습니다. '검토' 페이지에서 검토를 완료해주세요.";
  }
  else if (k.startsWith("packing.")) {
    if (k === "packing.translationPack") koTranslations[k] = "번역 리소스팩";
    else if (k === "packing.packed") koTranslations[k] = "패킹 완료 ✓";
  }
  else if (k.startsWith("splash.")) {
    if (k === "splash.phase.completed") koTranslations[k] = "";
    else if (k === "splash.offline") koTranslations[k] = "오프라인 모드";
    else if (k === "splash.firstLaunch") koTranslations[k] = "첫 실행, 초기화 중…";
    else if (k === "splash.skip") koTranslations[k] = "건너뛰고 계속";
  }
});

// ruRu missing translations
const ruTranslations = {};
ruMiss.forEach((k) => {
  const en = enValues[k] || "";
  if (k === "common.filterMin") ruTranslations[k] = "Мин";
  else if (k === "common.filterMax") ruTranslations[k] = "Макс";
  else if (k === "dictionary.empty") ruTranslations[k] = "Словарь пуст. Сначала отсканируйте и переведите моды";
  else if (k === "editPanel.llmTranslateTooltip") ruTranslations[k] = "LLM Перевод";
  else if (k === "jobs.retryFailed") ruTranslations[k] = "Повторить ошибки";
  else if (k === "jobs.retrying") ruTranslations[k] = "Повтор...";
  else if (k === "jobs.restart") ruTranslations[k] = "Перевести заново";
  else if (k === "jobs.logPanel.colStatus") ruTranslations[k] = "Статус";
  else if (k === "jobs.entryStatus.pending") ruTranslations[k] = "Ожидает";
  else if (k === "jobs.entryStatus.dictionaryHit") ruTranslations[k] = "Словарь";
  else if (k === "jobs.entryStatus.skip") ruTranslations[k] = "Пропущено";
  else if (k === "jobs.entryStatus.translating") ruTranslations[k] = "Перевод...";
  else if (k === "jobs.entryStatus.completed") ruTranslations[k] = "Готово";
  else if (k === "jobs.entryStatus.failed") ruTranslations[k] = "Ошибка";
  else if (k === "jobs.sourceType.existing") ruTranslations[k] = "Существующий";
  else if (k === "jobs.sourceType.dictionary") ruTranslations[k] = "Словарь";
  else if (k === "jobs.sourceType.llm") ruTranslations[k] = "LLM";
  else if (k === "jobs.sourceType.skipped") ruTranslations[k] = "Пропущено";
  else if (k === "jobs.sourceType.failed") ruTranslations[k] = "Ошибка";
  else if (k === "jobs.sourceType.reviewed") ruTranslations[k] = "Проверено";
  else if (k === "logs.pause") ruTranslations[k] = "Пауза";
  else if (k === "logs.resume") ruTranslations[k] = "Продолжить";
  else if (k === "logs.copyAll") ruTranslations[k] = "Копировать всё";
  else if (k === "logs.clear") ruTranslations[k] = "Очистить";
  else if (k === "logs.allLevel") ruTranslations[k] = "Все";
  else if (k === "logs.paused") ruTranslations[k] = "Лог приостановлен";
  else if (k === "logs.lines") ruTranslations[k] = "{count} строк";
  else if (k === "logs.linesWithTotal") ruTranslations[k] = "/ {count} всего";
  else if (k === "logs.scrollToBottom") ruTranslations[k] = "Вниз";
  else if (k === "packages.title") ruTranslations[k] = "Упаковка перевода";
  else if (k === "packages.subtitle") ruTranslations[k] = "Генерация ресурс-пака с переводами";
  else if (k === "packages.entries_label") ruTranslations[k] = "{count} записей";
  else if (k === "packages.entryCount") ruTranslations[k] = "{count} переводов";
  else if (k === "packages.failed_label") ruTranslations[k] = "Ошибка";
  else if (k === "packages.files_label") ruTranslations[k] = "{count} файлов";
  else if (k === "packages.modCount") ruTranslations[k] = "{count} модов";
  else if (k === "packages.noLangFiles") ruTranslations[k] = "Нет языковых файлов";
  else if (k === "packages.noTranslation") ruTranslations[k] = "Результаты перевода отсутствуют. Сначала выполните перевод.";
  else if (k === "packages.packingPercent") ruTranslations[k] = "Упаковка ({percent}%)";
  else if (k === "packages.regenerate") ruTranslations[k] = "Перегенерировать";
  else if (k === "packages.regenerateTooltip") ruTranslations[k] = "Перегенерировать ресурс-пак";
  else if (k === "packages.outputDirBrowse") ruTranslations[k] = "Обзор...";
}

// Generate formatted code blocks for insertion
function genCode(kvs) {
  const sorted = Object.keys(kvs).sort();
  return sorted.map((k) => `  "${k}": "${kvs[k]}",`).join("\n");
}

// Check if we have all keys covered
console.log("\njaJp translation coverage:", Object.keys(jaTranslations).length, "/", jaMiss.length);
console.log("koKr translation coverage:", Object.keys(koTranslations).length, "/", koMiss.length);
console.log("ruRu translation coverage:", Object.keys(ruTranslations).length, "/", ruMiss.length);

// Check for any missing
jaMiss.forEach((k) => {
  if (!(k in jaTranslations)) console.log("UNCOVERED ja:", k);
});
koMiss.forEach((k) => {
  if (!(k in koTranslations)) console.log("UNCOVERED ko:", k);
});
ruMiss.forEach((k) => {
  if (!(k in ruTranslations)) console.log("UNCOVERED ru:", k);
});

console.log("\n=== ja code ===");
console.log(genCode(jaTranslations));
console.log("\n=== ko code ===");
console.log(genCode(koTranslations));
console.log("\n=== ru code ===");
console.log(genCode(ruTranslations));
