import type { AppLanguage } from "../types";

export type TranslationKey =
  | "app.loadingSettings"
  | "app.currentInstance"
  | "app.noInstance"
  | "app.phase"
  | "app.ready"
  | "nav.dashboard"
  | "nav.jobs"
  | "nav.dictionary"
  | "nav.packages"
  | "nav.ftb"
  | "nav.hardcoded"
  | "nav.settings"
  | "nav.logs"
  | "dashboard.title"
  | "dashboard.subtitle"
  | "dashboard.scan"
  | "dashboard.scanning"
  | "dashboard.scanProgress"
  | "dashboard.instancePath"
  | "dashboard.instancePlaceholder"
  | "dashboard.pickInstance"
  | "dashboard.rescan"
  | "dashboard.moreWarnings"
  | "dashboard.stats.mods"
  | "dashboard.stats.modsHint"
  | "dashboard.stats.langFiles"
  | "dashboard.stats.sourceEntries"
  | "dashboard.stats.targetEntries"
  | "dashboard.stats.pendingEntries"
  | "dashboard.stats.pendingHint"
  | "dashboard.stats.recovered"
  | "dashboard.stats.recoveredHint"
  | "dashboard.modsTitle"
  | "dashboard.waiting"
  | "dashboard.column.mod"
  | "dashboard.column.modId"
  | "dashboard.column.format"
  | "dashboard.column.langFiles"
  | "dashboard.column.recovered"
  | "dashboard.column.source"
  | "dashboard.column.target"
  | "dashboard.column.status"
  | "dashboard.emptyScan"
  | "dashboard.hasTarget"
  | "dashboard.needsTranslation"
  | "dashboard.resourceSources"
  | "dashboard.resourceCount"
  | "dashboard.emptyResource"
  | "settings.title"
  | "settings.subtitle"
  | "settings.save"
  | "settings.saved"
  | "settings.fetchModels"
  | "settings.modelsFetched"
  | "settings.autosaveHint"
  | "settings.tab.language"
  | "settings.tab.api"
  | "settings.tab.performance"
  | "settings.tab.reuse"
  | "settings.tab.logs"
  | "settings.tab.advanced"
  | "settings.appLanguage"
  | "settings.sourceLanguage"
  | "settings.targetLanguage"
  | "settings.sourceHint"
  | "settings.targetHint"
  | "settings.invalidSourceLanguage"
  | "settings.invalidTargetLanguage"
  | "settings.temperature"
  | "settings.temperatureHint"
  | "settings.maxTokens"
  | "settings.maxTokensHint"
  | "settings.maxTokensPlaceholder"
  | "settings.modelLabel"
  | "settings.modelPlaceholder"
  | "settings.noModels"
  | "settings.selectModel"
  | "settings.customModel"
  | "settings.pickFromList"
  | "settings.concurrency"
  | "settings.batchSize"
  | "settings.batchMaxChars"
  | "settings.timeoutSecs"
  | "settings.retryCount"
  | "settings.retryDelaySecs"
  | "settings.rateLimitRpm"
  | "settings.reuseI18n"
  | "settings.reuseVm"
  | "settings.preferDictionary"
  | "settings.keepExisting"
  | "settings.enableFtb"
  | "settings.resetMainLog"
  | "settings.enableDebug"
  | "settings.enableHttp"
  | "settings.enableTokens"
  | "settings.defaultInstance"
  | "settings.futureAdvanced"
  | "logs.title"
  | "logs.subtitle"
  | "logs.recentJob"
  | "logs.jobId"
  | "logs.instance"
  | "logs.warning"
  | "logs.empty"
  | "placeholder.disabled"
  | "placeholder.subtitle"
  | "placeholder.empty";

type TranslationMap = Record<TranslationKey, string>;

export const appLanguages: Array<{ code: AppLanguage; label: string }> = [
  { code: "zh_cn", label: "简体中文" },
  { code: "en_us", label: "English" },
  { code: "ja_jp", label: "日本語" },
  { code: "ko_kr", label: "한국어" },
];

export const minecraftLanguageOptions = [
  { code: "auto", label: "Auto" },
  { code: "zh_cn", label: "Chinese (Simplified)" },
  { code: "zh_tw", label: "Chinese (Traditional)" },
  { code: "en_us", label: "English (US)" },
  { code: "en_gb", label: "English (UK)" },
  { code: "ja_jp", label: "Japanese" },
  { code: "ko_kr", label: "Korean" },
  { code: "fr_fr", label: "French" },
  { code: "de_de", label: "German" },
  { code: "es_es", label: "Spanish" },
  { code: "pt_br", label: "Portuguese (Brazil)" },
  { code: "ru_ru", label: "Russian" },
];

export const localeByAppLanguage: Record<AppLanguage, string> = {
  zh_cn: "zh-CN",
  en_us: "en-US",
  ja_jp: "ja-JP",
  ko_kr: "ko-KR",
};

const zhCn: TranslationMap = {
  "app.loadingSettings": "正在读取设置...",
  "app.currentInstance": "当前实例",
  "app.noInstance": "未选择实例",
  "app.phase": "第一阶段：扫描闭环",
  "app.ready": "就绪",
  "nav.dashboard": "总览",
  "nav.jobs": "翻译任务",
  "nav.dictionary": "词典与纠错",
  "nav.packages": "资源包管理",
  "nav.ftb": "FTB 任务",
  "nav.hardcoded": "硬编码实验室",
  "nav.settings": "设置中心",
  "nav.logs": "日志中心",
  "dashboard.title": "项目扫描概览",
  "dashboard.subtitle": "扫描实例中的模组语言文件和已有目标语言资源包。",
  "dashboard.scan": "开始扫描",
  "dashboard.scanning": "扫描中",
  "dashboard.scanProgress": "{current} / {total}",
  "dashboard.instancePath": "实例路径",
  "dashboard.instancePlaceholder": "E:/PCL2/.minecraft/versions/Aaalice Craft",
  "dashboard.pickInstance": "选择实例",
  "dashboard.rescan": "重新扫描",
  "dashboard.moreWarnings": "还有 {count} 条扫描提示，完整内容已写入任务日志。",
  "dashboard.stats.mods": "已扫描模组",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.langFiles": "语言文件",
  "dashboard.stats.sourceEntries": "来源条目",
  "dashboard.stats.targetEntries": "目标条目",
  "dashboard.stats.pendingEntries": "待翻译条目",
  "dashboard.stats.pendingHint": "后续进入词典/LLM",
  "dashboard.stats.recovered": "自动修复文件",
  "dashboard.stats.recoveredHint": "宽松解析成功",
  "dashboard.modsTitle": "检测到的模组",
  "dashboard.waiting": "等待扫描",
  "dashboard.column.mod": "模组",
  "dashboard.column.modId": "Mod ID",
  "dashboard.column.format": "格式",
  "dashboard.column.langFiles": "语言文件",
  "dashboard.column.recovered": "自愈",
  "dashboard.column.source": "来源",
  "dashboard.column.target": "目标",
  "dashboard.column.status": "状态",
  "dashboard.emptyScan": "选择实例并开始扫描后显示结果。",
  "dashboard.hasTarget": "已有目标语言",
  "dashboard.needsTranslation": "待翻译",
  "dashboard.resourceSources": "已识别的目标语言资源来源",
  "dashboard.resourceCount": "{files} 个语言文件 / {entries} 条",
  "dashboard.emptyResource": "等待扫描资源包。",
  "settings.title": "设置中心",
  "settings.subtitle": "常用选项会持久化保存到本地设置文件。",
  "settings.save": "保存设置",
  "settings.saved": "设置已保存",
  "settings.fetchModels": "拉取模型",
  "settings.modelsFetched": "已从 {url} 拉取 {count} 个模型",
  "settings.autosaveHint": "自动保存需点击右上角保存按钮",
  "settings.tab.language": "语言与翻译",
  "settings.tab.api": "API 设置",
  "settings.tab.performance": "性能设置",
  "settings.tab.reuse": "资源复用",
  "settings.tab.logs": "日志设置",
  "settings.tab.advanced": "高级设置",
  "settings.appLanguage": "应用语言",
  "settings.sourceLanguage": "来源语言",
  "settings.targetLanguage": "目标语言",
  "settings.sourceHint": "来源语言可填 auto，程序会优先使用 en_us。",
  "settings.targetHint": "目标语言必须是 Minecraft locale code，不能为 auto。",
  "settings.invalidSourceLanguage": "来源语言必须是 auto 或合法 Minecraft locale code。",
  "settings.invalidTargetLanguage": "目标语言必须是合法 Minecraft locale code，且不能为 auto。",
  "settings.temperature": "Temperature",
  "settings.temperatureHint": "越低输出越确定，越高越有创造性。翻译建议 0.3–1.0。",
  "settings.maxTokens": "Max tokens",
  "settings.maxTokensHint": "限制每次请求的响应 token 数。0 = 不限制（使用 API 默认值）。翻译建议设为 0 或较大值（如 32768），过小会截断翻译结果。",
  "settings.maxTokensPlaceholder": "0 = 不限制",
  "settings.modelLabel": "模型",
  "settings.modelPlaceholder": "输入自定义模型名称…",
  "settings.noModels": "尚未拉取模型",
  "settings.selectModel": "选择一个模型…",
  "settings.customModel": "输入自定义模型",
  "settings.pickFromList": "从列表选择",
  "settings.concurrency": "并发请求数",
  "settings.batchSize": "Batch size",
  "settings.batchMaxChars": "每批最大字符数",
  "settings.timeoutSecs": "超时时间（秒）",
  "settings.retryCount": "重试次数",
  "settings.retryDelaySecs": "重试延迟（秒）",
  "settings.rateLimitRpm": "速率限制（RPM）",
  "settings.reuseI18n": "检测并复用 i18n 目标语言资源包",
  "settings.reuseVm": "检测并复用 VM 汉化包",
  "settings.preferDictionary": "优先使用用户词典",
  "settings.keepExisting": "保留已有资源包翻译",
  "settings.enableFtb": "启用 FTB Quest 翻译入口",
  "settings.resetMainLog": "启动时重置 main.log",
  "settings.enableDebug": "启用调试日志",
  "settings.enableHttp": "启用 HTTP 请求日志",
  "settings.enableTokens": "启用 Token 使用统计",
  "settings.defaultInstance": "默认实例路径",
  "settings.futureAdvanced": "词典、打包和实验功能设置会在对应阶段接入。",
  "logs.title": "日志中心",
  "logs.subtitle": "第一阶段已写入 main、job 和 error 日志；完整过滤器在后续阶段接入。",
  "logs.recentJob": "最近任务",
  "logs.jobId": "任务 ID：{id}",
  "logs.instance": "实例：{path}",
  "logs.warning": "warning：{count}",
  "logs.empty": "尚未执行扫描任务。",
  "placeholder.disabled": "未启用",
  "placeholder.subtitle": "第一阶段只保留入口；功能会在后续阶段接入主链路。",
  "placeholder.empty": "当前阶段不执行此模块的自动处理。",
};

const enUs: TranslationMap = {
  ...zhCn,
  "app.loadingSettings": "Loading settings...",
  "app.currentInstance": "Current instance",
  "app.noInstance": "No instance selected",
  "app.phase": "Phase 1: scan loop",
  "app.ready": "Ready",
  "nav.dashboard": "Dashboard",
  "nav.jobs": "Translation jobs",
  "nav.dictionary": "Dictionary",
  "nav.packages": "Resource packs",
  "nav.ftb": "FTB quests",
  "nav.hardcoded": "Hardcoded lab",
  "nav.settings": "Settings",
  "nav.logs": "Logs",
  "dashboard.title": "Project scan overview",
  "dashboard.subtitle": "Scan mod language files and existing target-language resource packs.",
  "dashboard.scan": "Start scan",
  "dashboard.scanning": "Scanning",
  "dashboard.instancePath": "Instance path",
  "dashboard.pickInstance": "Choose instance",
  "dashboard.rescan": "Rescan",
  "dashboard.moreWarnings": "{count} more scan warnings were written to the job log.",
  "dashboard.stats.mods": "Scanned mods",
  "dashboard.stats.langFiles": "Language files",
  "dashboard.stats.sourceEntries": "Source entries",
  "dashboard.stats.targetEntries": "Target entries",
  "dashboard.stats.pendingEntries": "Pending entries",
  "dashboard.stats.pendingHint": "Next: dictionary/LLM",
  "dashboard.stats.recovered": "Recovered files",
  "dashboard.stats.recoveredHint": "Lenient parse",
  "dashboard.modsTitle": "Detected mods",
  "dashboard.waiting": "Waiting for scan",
  "dashboard.column.mod": "Mod",
  "dashboard.column.langFiles": "Lang files",
  "dashboard.column.recovered": "Recovered",
  "dashboard.column.source": "Source",
  "dashboard.column.target": "Target",
  "dashboard.column.status": "Status",
  "dashboard.emptyScan": "Select an instance and start scanning to show results.",
  "dashboard.hasTarget": "Target exists",
  "dashboard.needsTranslation": "Needs translation",
  "dashboard.resourceSources": "Detected target-language resource sources",
  "dashboard.resourceCount": "{files} language files / {entries} entries",
  "dashboard.emptyResource": "Waiting for resource pack scan.",
  "settings.title": "Settings",
  "settings.subtitle": "Common options are persisted to the local settings file.",
  "settings.save": "Save settings",
  "settings.saved": "Settings saved",
  "settings.fetchModels": "Fetch models",
  "settings.modelsFetched": "Fetched {count} models from {url}",
  "settings.autosaveHint": "Click the save button to persist changes",
  "settings.tab.language": "Language & translation",
  "settings.tab.api": "API",
  "settings.tab.performance": "Performance",
  "settings.tab.reuse": "Reuse",
  "settings.tab.logs": "Logs",
  "settings.tab.advanced": "Advanced",
  "settings.appLanguage": "App language",
  "settings.sourceLanguage": "Source language",
  "settings.targetLanguage": "Target language",
  "settings.sourceHint": "Source can be auto; the scanner prefers en_us.",
  "settings.targetHint": "Target must be a Minecraft locale code, not auto.",
  "settings.invalidSourceLanguage": "Source language must be auto or a valid Minecraft locale code.",
  "settings.invalidTargetLanguage": "Target language must be a valid Minecraft locale code and cannot be auto.",
  "settings.temperatureHint": "Lower = more deterministic, higher = more creative. Recommended 0.3–1.0 for translation.",
  "settings.maxTokensHint": "Caps response tokens per request. 0 = no limit (API default). Set 0 or high (e.g. 32768) for translation to avoid truncation.",
  "settings.maxTokensPlaceholder": "0 = no limit",
  "settings.modelLabel": "Model",
  "settings.modelPlaceholder": "Enter custom model name…",
  "settings.noModels": "No models fetched",
  "settings.selectModel": "Select a model…",
  "settings.customModel": "Enter custom model",
  "settings.pickFromList": "Pick from list",
  "settings.concurrency": "Concurrent requests",
  "settings.batchMaxChars": "Max chars per batch",
  "settings.timeoutSecs": "Timeout (seconds)",
  "settings.retryCount": "Retry count",
  "settings.retryDelaySecs": "Retry delay (seconds)",
  "settings.rateLimitRpm": "Rate limit (RPM)",
  "settings.reuseI18n": "Detect and reuse i18n target-language packs",
  "settings.reuseVm": "Detect and reuse VM translation packs",
  "settings.preferDictionary": "Prefer user dictionary",
  "settings.keepExisting": "Keep existing resource-pack translations",
  "settings.enableFtb": "Enable FTB Quest translation entry",
  "settings.resetMainLog": "Reset main.log on startup",
  "settings.enableDebug": "Enable debug log",
  "settings.enableHttp": "Enable HTTP request log",
  "settings.enableTokens": "Enable token usage stats",
  "settings.defaultInstance": "Default instance path",
  "settings.futureAdvanced": "Dictionary, packaging, and lab settings will be connected in later phases.",
  "logs.title": "Logs",
  "logs.subtitle": "Phase 1 writes main, job, and error logs; full filters arrive later.",
  "logs.recentJob": "Recent job",
  "logs.jobId": "Job ID: {id}",
  "logs.instance": "Instance: {path}",
  "logs.empty": "No scan job has run yet.",
  "placeholder.disabled": "Disabled",
  "placeholder.subtitle": "Phase 1 keeps this entry visible; the workflow will be connected later.",
  "placeholder.empty": "This module does not run automatic processing in the current phase.",
};

const jaJp: TranslationMap = {
  ...enUs,
  "app.loadingSettings": "設定を読み込んでいます...",
  "app.currentInstance": "現在のインスタンス",
  "app.noInstance": "インスタンス未選択",
  "app.phase": "フェーズ1：スキャン連携",
  "app.ready": "準備完了",
  "nav.dashboard": "概要",
  "nav.jobs": "翻訳ジョブ",
  "nav.dictionary": "辞書と修正",
  "nav.packages": "リソースパック",
  "nav.ftb": "FTB クエスト",
  "nav.hardcoded": "ハードコード実験室",
  "nav.settings": "設定",
  "nav.logs": "ログ",
  "dashboard.title": "プロジェクトスキャン概要",
  "dashboard.subtitle": "Mod の言語ファイルと既存の対象言語リソースパックをスキャンします。",
  "dashboard.scan": "スキャン開始",
  "dashboard.scanning": "スキャン中",
  "dashboard.instancePath": "インスタンスパス",
  "dashboard.pickInstance": "選択",
  "dashboard.rescan": "再スキャン",
  "dashboard.moreWarnings": "ほかに {count} 件のスキャン警告があります。詳細はジョブログに記録されました。",
  "dashboard.stats.mods": "スキャン済み Mod",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.langFiles": "言語ファイル",
  "dashboard.stats.sourceEntries": "ソース項目",
  "dashboard.stats.targetEntries": "対象項目",
  "dashboard.stats.pendingEntries": "未翻訳項目",
  "dashboard.stats.pendingHint": "次は辞書/LLM",
  "dashboard.stats.recovered": "復旧ファイル",
  "dashboard.stats.recoveredHint": "緩やかな解析",
  "dashboard.modsTitle": "検出された Mod",
  "dashboard.waiting": "スキャン待ち",
  "dashboard.column.mod": "Mod",
  "dashboard.column.modId": "Mod ID",
  "dashboard.column.format": "形式",
  "dashboard.column.langFiles": "言語ファイル",
  "dashboard.column.recovered": "復旧",
  "dashboard.column.source": "元",
  "dashboard.column.target": "対象",
  "dashboard.column.status": "状態",
  "dashboard.emptyScan": "インスタンスを選択してスキャンを開始すると結果が表示されます。",
  "dashboard.hasTarget": "対象言語あり",
  "dashboard.needsTranslation": "翻訳待ち",
  "dashboard.resourceSources": "検出された対象言語リソース",
  "dashboard.resourceCount": "{files} 個の言語ファイル / {entries} 件",
  "dashboard.emptyResource": "リソースパックのスキャン待ち。",
  "settings.title": "設定",
  "settings.subtitle": "よく使う設定はローカル設定ファイルに保存されます。",
  "settings.save": "設定を保存",
  "settings.saved": "設定を保存しました",
  "settings.fetchModels": "モデル取得",
  "settings.autosaveHint": "変更の保存には右上の保存ボタンが必要です",
  "settings.tab.language": "言語と翻訳",
  "settings.tab.api": "API 設定",
  "settings.tab.performance": "性能設定",
  "settings.tab.reuse": "再利用",
  "settings.tab.logs": "ログ設定",
  "settings.tab.advanced": "詳細設定",
  "settings.appLanguage": "アプリ言語",
  "settings.sourceLanguage": "元言語",
  "settings.targetLanguage": "対象言語",
  "settings.sourceHint": "元言語には auto を指定できます。スキャンは en_us を優先します。",
  "settings.targetHint": "対象言語は Minecraft locale code にしてください。auto は使えません。",
  "settings.invalidSourceLanguage": "元言語は auto または有効な Minecraft locale code にしてください。",
  "settings.invalidTargetLanguage": "対象言語は有効な Minecraft locale code にしてください。auto は使えません。",
  "settings.temperatureHint": "低いほど決定論的、高いほど創造的。翻訳の推奨値 0.3-1.0。",
  "settings.maxTokensHint": "応答のトークン数を制限。0 = 無制限（API デフォルト）。翻訳では 0 または大きな値（例 32768）を推奨。",
  "settings.maxTokensPlaceholder": "0 = 無制限",
  "settings.modelLabel": "モデル",
  "settings.modelPlaceholder": "カスタムモデル名を入力…",
  "settings.noModels": "モデルが取得されていません",
  "settings.selectModel": "モデルを選択…",
  "settings.customModel": "カスタムモデルを入力",
  "settings.pickFromList": "リストから選択",
  "settings.concurrency": "同時リクエスト数",
  "settings.batchMaxChars": "バッチ最大文字数",
  "settings.timeoutSecs": "タイムアウト（秒）",
  "settings.retryCount": "リトライ回数",
  "settings.retryDelaySecs": "リトライ間隔（秒）",
  "settings.rateLimitRpm": "レート制限（RPM）",
  "settings.reuseI18n": "i18n 対象言語リソースパックを検出して再利用",
  "settings.reuseVm": "VM 翻訳リソースパックを検出して再利用",
  "settings.preferDictionary": "ユーザー辞書を優先",
  "settings.keepExisting": "既存リソースパック翻訳を保持",
  "settings.enableFtb": "FTB Quest 翻訳入口を有効化",
  "settings.resetMainLog": "起動時に main.log をリセット",
  "settings.enableDebug": "デバッグログを有効化",
  "settings.enableHttp": "HTTP リクエストログを有効化",
  "settings.enableTokens": "Token 使用統計を有効化",
  "settings.defaultInstance": "既定のインスタンスパス",
  "settings.futureAdvanced": "辞書、パッケージング、実験機能の設定は後続フェーズで接続します。",
  "logs.title": "ログ",
  "logs.subtitle": "フェーズ1では main、job、error ログを書き込みます。完全なフィルターは後続フェーズで接続します。",
  "logs.recentJob": "最近のジョブ",
  "logs.jobId": "ジョブ ID：{id}",
  "logs.instance": "インスタンス：{path}",
  "logs.warning": "warning：{count}",
  "logs.empty": "まだスキャンジョブは実行されていません。",
  "placeholder.disabled": "無効",
  "placeholder.subtitle": "フェーズ1では入口のみ表示します。機能は後続フェーズで主フローに接続します。",
  "placeholder.empty": "現在のフェーズではこのモジュールの自動処理は実行しません。",
};

const koKr: TranslationMap = {
  ...enUs,
  "app.loadingSettings": "설정을 불러오는 중...",
  "app.currentInstance": "현재 인스턴스",
  "app.noInstance": "인스턴스가 선택되지 않음",
  "app.phase": "1단계: 스캔 루프",
  "app.ready": "준비됨",
  "nav.dashboard": "대시보드",
  "nav.jobs": "번역 작업",
  "nav.dictionary": "사전 및 수정",
  "nav.packages": "리소스 팩",
  "nav.ftb": "FTB 퀘스트",
  "nav.hardcoded": "하드코딩 실험실",
  "nav.settings": "설정",
  "nav.logs": "로그",
  "dashboard.title": "프로젝트 스캔 개요",
  "dashboard.subtitle": "모드 언어 파일과 기존 대상 언어 리소스 팩을 스캔합니다.",
  "dashboard.scan": "스캔 시작",
  "dashboard.scanning": "스캔 중",
  "dashboard.instancePath": "인스턴스 경로",
  "dashboard.pickInstance": "인스턴스 선택",
  "dashboard.rescan": "다시 스캔",
  "dashboard.moreWarnings": "스캔 경고가 {count}개 더 있으며 전체 내용은 작업 로그에 기록되었습니다.",
  "dashboard.stats.mods": "스캔한 모드",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.langFiles": "언어 파일",
  "dashboard.stats.sourceEntries": "원문 항목",
  "dashboard.stats.targetEntries": "대상 항목",
  "dashboard.stats.pendingEntries": "번역 대기 항목",
  "dashboard.stats.pendingHint": "다음 단계: 사전/LLM",
  "dashboard.stats.recovered": "복구된 파일",
  "dashboard.stats.recoveredHint": "완화 파싱",
  "dashboard.modsTitle": "감지된 모드",
  "dashboard.waiting": "스캔 대기",
  "dashboard.column.mod": "모드",
  "dashboard.column.modId": "Mod ID",
  "dashboard.column.format": "형식",
  "dashboard.column.langFiles": "언어 파일",
  "dashboard.column.recovered": "복구",
  "dashboard.column.source": "원본",
  "dashboard.column.target": "대상",
  "dashboard.column.status": "상태",
  "dashboard.emptyScan": "인스턴스를 선택하고 스캔을 시작하면 결과가 표시됩니다.",
  "dashboard.hasTarget": "대상 언어 있음",
  "dashboard.needsTranslation": "번역 필요",
  "dashboard.resourceSources": "감지된 대상 언어 리소스",
  "dashboard.resourceCount": "언어 파일 {files}개 / 항목 {entries}개",
  "dashboard.emptyResource": "리소스 팩 스캔 대기.",
  "settings.title": "설정",
  "settings.subtitle": "일반 옵션은 로컬 설정 파일에 저장됩니다.",
  "settings.save": "설정 저장",
  "settings.saved": "설정이 저장됨",
  "settings.fetchModels": "모델 가져오기",
  "settings.autosaveHint": "변경 사항을 저장하려면 오른쪽 위 저장 버튼을 누르세요",
  "settings.tab.language": "언어 및 번역",
  "settings.tab.api": "API 설정",
  "settings.tab.performance": "성능 설정",
  "settings.tab.reuse": "재사용",
  "settings.tab.logs": "로그 설정",
  "settings.tab.advanced": "고급 설정",
  "settings.appLanguage": "앱 언어",
  "settings.sourceLanguage": "원본 언어",
  "settings.targetLanguage": "대상 언어",
  "settings.sourceHint": "원본 언어는 auto를 사용할 수 있으며 스캐너는 en_us를 우선합니다.",
  "settings.targetHint": "대상 언어는 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.",
  "settings.invalidSourceLanguage": "원본 언어는 auto 또는 올바른 Minecraft locale code여야 합니다.",
  "settings.invalidTargetLanguage": "대상 언어는 올바른 Minecraft locale code여야 하며 auto는 사용할 수 없습니다.",
  "settings.temperatureHint": "낮을수록 결정론적, 높을수록 창의적. 번역 권장값 0.3-1.0.",
  "settings.maxTokensHint": "응답 토큰 수 제한. 0 = 무제한(API 기본값). 번역 시 0 또는 큰 값(예: 32768) 권장.",
  "settings.maxTokensPlaceholder": "0 = 무제한",
  "settings.modelLabel": "모델",
  "settings.modelPlaceholder": "사용자 모델명 입력…",
  "settings.noModels": "모델을 불러오지 않음",
  "settings.selectModel": "모델 선택…",
  "settings.customModel": "사용자 모델 입력",
  "settings.pickFromList": "목록에서 선택",
  "settings.concurrency": "동시 요청 수",
  "settings.batchMaxChars": "배치당 최대 문자 수",
  "settings.timeoutSecs": "타임아웃(초)",
  "settings.retryCount": "재시도 횟수",
  "settings.retryDelaySecs": "재시도 지연(초)",
  "settings.rateLimitRpm": "속도 제한(RPM)",
  "settings.reuseI18n": "i18n 대상 언어 리소스 팩 감지 및 재사용",
  "settings.reuseVm": "VM 번역 리소스 팩 감지 및 재사용",
  "settings.preferDictionary": "사용자 사전 우선",
  "settings.keepExisting": "기존 리소스 팩 번역 유지",
  "settings.enableFtb": "FTB Quest 번역 진입점 활성화",
  "settings.resetMainLog": "시작 시 main.log 초기화",
  "settings.enableDebug": "디버그 로그 활성화",
  "settings.enableHttp": "HTTP 요청 로그 활성화",
  "settings.enableTokens": "Token 사용 통계 활성화",
  "settings.defaultInstance": "기본 인스턴스 경로",
  "settings.futureAdvanced": "사전, 패키징, 실험 기능 설정은 이후 단계에서 연결됩니다.",
  "logs.title": "로그",
  "logs.subtitle": "1단계에서는 main, job, error 로그를 기록하며 전체 필터는 이후 단계에서 연결됩니다.",
  "logs.recentJob": "최근 작업",
  "logs.jobId": "작업 ID: {id}",
  "logs.instance": "인스턴스: {path}",
  "logs.warning": "warning: {count}",
  "logs.empty": "아직 스캔 작업이 실행되지 않았습니다.",
  "placeholder.disabled": "비활성화",
  "placeholder.subtitle": "1단계에서는 진입점만 표시하며 기능은 이후 단계에서 주 흐름에 연결됩니다.",
  "placeholder.empty": "현재 단계에서는 이 모듈의 자동 처리를 실행하지 않습니다.",
};

const translations: Record<AppLanguage, TranslationMap> = {
  zh_cn: zhCn,
  en_us: enUs,
  ja_jp: jaJp,
  ko_kr: koKr,
};

export function normalizeAppLanguage(language: string | undefined): AppLanguage {
  return appLanguages.some((item) => item.code === language) ? (language as AppLanguage) : "zh_cn";
}

export function t(
  language: AppLanguage | string | undefined,
  key: TranslationKey,
  params: Record<string, string | number> = {},
): string {
  const normalized = normalizeAppLanguage(language);
  return Object.entries(params).reduce(
    (message, [name, value]) => message.split(`{${name}}`).join(String(value)),
    translations[normalized][key],
  );
}
