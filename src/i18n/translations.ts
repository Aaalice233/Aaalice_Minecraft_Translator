import type { AppLanguage } from "../types";

export type TranslationKey =
  | "app.loadingSettings"
  | "app.brandSubtitle"
  | "app.currentInstance"
  | "app.noInstance"
  | "pipeline.validate"
  | "app.ready"
  | "nav.dashboard"
  | "nav.jobs"
  | "nav.dictionary"
  | "nav.packages"
  | "nav.ftb"
  | "nav.hardcoded"
  | "nav.validate"
  | "nav.settings"
  | "nav.logs"
| "nav.collapse"
| "nav.expand"
  | "dashboard.title"
  | "dashboard.subtitle"
  | "dashboard.scan"
  | "dashboard.scanProgress"
  | "dashboard.instancePath"
  | "dashboard.instancePlaceholder"
  | "dashboard.pickInstance"
  | "dashboard.pickInstanceError"
  | "dashboard.rescan"
  | "dashboard.warningsCount"
  | "dashboard.stats.mods"
  | "dashboard.stats.modsHint"
  | "dashboard.stats.pendingEntries"
  | "dashboard.stats.resourcePackCovered"
  | "dashboard.stats.resourcePackCoveredHint"
  | "dashboard.stats.actualPending"
  | "dashboard.stats.actualPendingHint"
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
  | "dashboard.column.pending"
  | "dashboard.column.status"
  | "dashboard.filterEmpty"
  | "dashboard.filterSearch"
  | "dashboard.emptyScan"
  | "dashboard.hasTarget"
  | "dashboard.needsTranslation"
  | "dashboard.resourceSources"
  | "dashboard.resourceCount"
  | "dashboard.emptyResource"
  | "common.loading"
  | "common.save"
  | "common.cancel"
  | "common.copied"
  | "common.delete"
  | "dictionary.title"
  | "dictionary.subtitle"
  | "dictionary.subtitleEmpty"
  | "dictionary.searchPlaceholder"
  | "dictionary.allTypes"
  | "dictionary.typeManual"
  | "dictionary.typeResourcepack"
  | "dictionary.typeCfpa"
  | "dictionary.typeLlm"
  | "dictionary.search"
  | "dictionary.export"
  | "dictionary.import"
  | "dictionary.empty"
  | "dictionary.col.source"
  | "dictionary.col.target"
  | "dictionary.col.mod"
  | "dictionary.col.key"
  | "dictionary.col.type"
  | "dictionary.col.actions"
  | "dictionary.clickToEdit"
  | "dictionary.saved"
  | "dictionary.deleted"
  | "dictionary.moreResults"
  | "jobs.title"
  | "jobs.subtitle"
  | "jobs.start"
  | "jobs.running"
  | "jobs.stop"
  | "jobs.noScan"
  | "jobs.noPending"
  | "jobs.summary"
  | "jobs.totalEntries"
  | "jobs.sourceLang"
  | "jobs.targetLang"
  | "jobs.modCount"
  | "jobs.translating"
  | "jobs.stage.matching"
  | "jobs.stage.translating"
  | "jobs.stage.packaging"
  | "jobs.completed.message"
  | "jobs.canceled"
  | "jobs.canceledStatus"
  | "jobs.failed.message"
  | "jobs.retryFailed"
  | "jobs.retrying"
  | "jobs.progressFallback"
  | "jobs.logPanel.title"
  | "jobs.logPanel.filterPlaceholder"
  | "jobs.logPanel.clear"
  | "jobs.logPanel.copyEntry"
  | "jobs.logPanel.noEntries"
  | "jobs.logPanel.entriesCount"
  | "jobs.logPanel.colKey"
  | "jobs.logPanel.colSource"
  | "jobs.logPanel.colTarget"
  | "jobs.logPanel.colMod"
  | "jobs.logPanel.colType"
  | "jobs.logPanel.colStatus"
  | "jobs.entryStatus.pending"
  | "jobs.entryStatus.dictionaryHit"
  | "jobs.entryStatus.skip"
  | "jobs.entryStatus.translating"
  | "jobs.entryStatus.completed"
  | "jobs.entryStatus.failed"
  | "jobs.sourceType.existing"
  | "jobs.sourceType.dictionary"
  | "jobs.sourceType.llm"
  | "jobs.sourceType.skipped"
  | "jobs.sourceType.failed"
  | "packages.title"
  | "packages.subtitle"
  | "packages.dryRun"
  | "packages.generate"
  | "packages.noScan"
  | "packages.result"
  | "packages.mods"
  | "packages.entries"
  | "packages.conflicts"
  | "packages.conflictDetail"
  | "packages.confirmTitle"
  | "packages.confirmMessage"
  | "packages.copyToInstance"
  | "packages.copySuccess"
  | "packages.copyFailed"
  | "packages.replaced"
  | "settings.title"
  | "settings.subtitle"
  | "settings.systemPrompt"
  | "settings.systemPromptHint"
  | "settings.save"
  | "settings.saved"
  | "settings.fetchModels"
  | "settings.modelsFetched"
  | "settings.autosaveHint"
  | "settings.provider"
  | "settings.baseUrl"
  | "settings.tab.language"
  | "settings.tab.api"
  | "settings.tab.performance"
  | "settings.tab.reuse"
  | "settings.tab.logs"
  | "settings.tab.advanced"
  | "settings.tab.appearance"
  | "settings.apiKey"
  | "settings.appLanguage"
  | "settings.uiFont"
  | "settings.uiFontOption.system"
  | "settings.uiFontOption.yahei"
  | "settings.uiFontOption.noto"
  | "settings.uiFontOption.simsun"
  | "settings.uiFontPresets"
  | "settings.uiFontSystem"
  | "settings.loadingFonts"
  | "settings.uiTheme"
  | "settings.uiThemeOption.default"
  | "settings.uiThemeOption.ocean"
  | "settings.uiThemeOption.aurora"
  | "settings.uiThemeOption.gold"
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
  | "settings.concurrencyHint"
  | "settings.batchSize"
  | "settings.batchSizeHint"
  | "settings.batchMaxChars"
  | "settings.batchMaxCharsHint"
  | "settings.timeoutSecs"
  | "settings.timeoutSecsHint"
  | "settings.retryCount"
  | "settings.retryCountHint"
  | "settings.retryDelaySecs"
  | "settings.retryDelaySecsHint"
  | "settings.rateLimitRpm"
  | "settings.rateLimitRpmHint"
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
  | "settings.translationPacks"
  | "settings.resourcePackName"
  | "settings.resourcePackHint"
  | "settings.addPack"
  | "settings.removePack"
  | "settings.packPlaceholder"
  | "settings.packDefaultI18n"
  | "settings.futureAdvanced"
  | "logs.title"
  | "logs.subtitle"
  | "logs.recentJob"
  | "logs.jobId"
  | "logs.instance"
  | "logs.warning"
  | "logs.empty"
  | "dashboard.stage.scan"
  | "dashboard.stage.resourcepacks"
  | "dashboard.stage.aggregate"
  | "dashboard.stage.log"
  | "dashboard.stage.done"
  | "dashboard.cancel"
  | "dashboard.cancelling"
  | "dashboard.cancelledMessage"
  | "placeholder.disabled"
  | "placeholder.subtitle"
  | "placeholder.empty"
  | "tooltip.scan"
  | "tooltip.cancelScan"
  | "tooltip.pickInstance"
  | "tooltip.rescan"
  | "tooltip.saveSettings"
  | "tooltip.fetchModels"
  | "tooltip.generatePack"
  | "tooltip.dryRun"
  | "tooltip.copyToInstance"
  | "tooltip.startTranslation"
  | "tooltip.stopTranslation"
  | "tooltip.clearLog"
  | "tooltip.export"
  | "tooltip.import"
  | "tooltip.search"
  | "tooltip.delete"
  | "tooltip.filter"
  | "tooltip.clearFilter"
  | "tooltip.validate"
  | "tooltip.nav"
  | "tooltip.currentPage"
  | "tooltip.busy"
  | "tooltip.completed"
  | "summary.scanCompleted"
  | "summary.translateCompleted"
  | "summary.elapsed"
  | "summary.mods"
  | "summary.modsSpeed"
  | "summary.entries"
  | "summary.entriesSpeed"
  | "summary.dictionary"
  | "summary.llm"
  | "summary.failed";

type TranslationMap = Record<TranslationKey, string>;

export const appLanguages: Array<{ code: AppLanguage; label: string }> = [
  { code: "zh_cn", label: "简体中文" },
  { code: "en_us", label: "English" },
  { code: "ja_jp", label: "日本語" },
  { code: "ko_kr", label: "한국어" },
  { code: "ru_ru", label: "Русский" },
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
  ru_ru: "ru-RU",
};

const zhCn: TranslationMap = {
  "app.loadingSettings": "正在读取设置...",
  "app.brandSubtitle": "MC 翻译器",
  "app.currentInstance": "当前实例",
  "app.noInstance": "未选择实例",
  "app.ready": "就绪",
  "pipeline.validate": "校验",
  "nav.dashboard": "扫描",
  "nav.jobs": "翻译",
  "nav.validate": "校验",
  "nav.packages": "打包",
  "nav.ftb": "FTB",
  "nav.hardcoded": "硬编码",
  "nav.dictionary": "词典",
  "nav.settings": "设置",
  "nav.logs": "调试",
  "nav.collapse": "收起侧栏",
  "nav.expand": "展开侧栏",
  "dashboard.title": "项目扫描概览",
  "dashboard.subtitle": "扫描实例中的模组语言文件和已有目标语言资源包。",
  "dashboard.scan": "开始扫描",
  "dashboard.scanProgress": "{current} / {total}",
  "dashboard.instancePath": "实例路径",
  "dashboard.instancePlaceholder": "E:/PCL2/.minecraft/versions/Aaalice Craft",
  "dashboard.pickInstance": "选择实例",
  "dashboard.pickInstanceError": "选择实例失败：",
  "dashboard.rescan": "重新扫描",
  "dashboard.warningsCount": "{count} 条扫描提示",
  "dashboard.stats.mods": "已扫描模组",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.pendingEntries": "待翻译条目",
  "dashboard.stats.resourcePackCovered": "汉化资源包可复用",
  "dashboard.stats.resourcePackCoveredHint": "匹配模组来源键的条目",
  "dashboard.stats.actualPending": "翻译队列总计",
  "dashboard.stats.actualPendingHint": "需翻译条目（不含已有汉化）",
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
  "dashboard.column.pending": "待翻译",
  "dashboard.column.status": "状态",
  "dashboard.filterEmpty": "没有匹配的模组。尝试调整过滤条件。",
  "dashboard.filterSearch": "搜索...",
  "dashboard.emptyScan": "选择实例并开始扫描后显示结果。",
  "dashboard.hasTarget": "已有目标语言",
  "dashboard.needsTranslation": "待翻译",
  "dashboard.resourceSources": "已识别的目标语言资源来源",
  "dashboard.resourceCount": "{files} 个语言文件 / {entries} 条",
  "dashboard.emptyResource": "等待扫描资源包。",
  "dashboard.stage.scan": "扫描模组",
  "dashboard.stage.resourcepacks": "扫描资源包",
  "dashboard.stage.aggregate": "聚合结果",
  "dashboard.stage.log": "写入日志",
  "dashboard.stage.done": "扫描完成",
  "dashboard.cancel": "取消扫描",
  "dashboard.cancelling": "正在停止...",
  "dashboard.cancelledMessage": "扫描已被取消，显示部分结果",
  "common.loading": "加载中...",
  "common.save": "保存",
  "common.cancel": "取消",
  "common.copied": "已复制",
  "common.delete": "删除",
  "dictionary.title": "词典管理",
  "dictionary.subtitle": "共 {total} 条词典条目，{mods} 个模组",
  "dictionary.subtitleEmpty": "词典尚未加载",
  "dictionary.searchPlaceholder": "搜索原文、译文或翻译键...",
  "dictionary.allTypes": "所有类型",
  "dictionary.typeManual": "手动",
  "dictionary.typeResourcepack": "资源包",
  "dictionary.typeCfpa": "CFPA",
  "dictionary.typeLlm": "LLM",
  "dictionary.search": "搜索",
  "dictionary.export": "导出",
  "dictionary.import": "导入",
  "dictionary.empty": "词典为空，请先扫描并翻译模组",
  "dictionary.col.source": "原文",
  "dictionary.col.target": "译文",
  "dictionary.col.mod": "模组",
  "dictionary.col.key": "翻译键",
  "dictionary.col.type": "来源",
  "dictionary.col.actions": "操作",
  "dictionary.clickToEdit": "点击编辑译文",
  "dictionary.saved": "译文已更新",
  "dictionary.deleted": "条目已删除",
  "dictionary.moreResults": "显示前 500 条，还有 {count} 条未显示",
  "jobs.title": "翻译任务",
  "jobs.subtitle": "管理翻译流程，查看进度和结果",
  "jobs.start": "开始翻译",
  "jobs.running": "翻译中...",
  "jobs.stop": "停止",
  "jobs.noScan": "请先扫描模组语言文件",
  "jobs.noPending": "所有条目已翻译或命中词典，无需翻译",
  "jobs.summary": "任务摘要",
  "jobs.totalEntries": "待翻译条目",
  "jobs.sourceLang": "来源语言",
  "jobs.targetLang": "目标语言",
  "jobs.modCount": "模组数量",
  "jobs.translating": "翻译处理中",
  "jobs.stage.matching": "匹配词典",
  "jobs.stage.translating": "翻译中",
  "jobs.stage.packaging": "打包中",
  "jobs.completed.message": "翻译完成：共处理 {count} 条条目",
  "jobs.canceled": "翻译已取消",
  "jobs.canceledStatus": "已取消",
  "jobs.failed.message": "翻译失败：{error}",
  "jobs.retryFailed": "重试失败条目",
  "jobs.retrying": "重试中...",
  "jobs.progressFallback": "- / -",
  "jobs.logPanel.title": "翻译日志",
  "jobs.logPanel.filterPlaceholder": "按模组名或键名过滤...",
  "jobs.logPanel.clear": "清空日志",
  "jobs.logPanel.copyEntry": "复制",
  "jobs.logPanel.noEntries": "暂无翻译日志",
  "jobs.logPanel.entriesCount": "{count} 条",
  "jobs.logPanel.colKey": "键名",
  "jobs.logPanel.colSource": "原文",
  "jobs.logPanel.colTarget": "译文",
  "jobs.logPanel.colMod": "模组",
  "jobs.logPanel.colType": "来源",
  "jobs.logPanel.colStatus": "状态",
  "jobs.entryStatus.pending": "待翻译",
  "jobs.entryStatus.dictionaryHit": "词典命中",
  "jobs.entryStatus.skip": "跳过",
  "jobs.entryStatus.translating": "翻译中",
  "jobs.entryStatus.completed": "已完成",
  "jobs.entryStatus.failed": "失败",
  "jobs.sourceType.existing": "已有翻译",
  "jobs.sourceType.dictionary": "词典匹配",
  "jobs.sourceType.llm": "LLM 翻译",
  "jobs.sourceType.skipped": "已跳过",
  "jobs.sourceType.failed": "翻译失败",
  "packages.title": "资源包打包",
  "packages.subtitle": "生成翻译资源包并部署到实例",
  "packages.dryRun": "预览",
  "packages.generate": "生成资源包",
  "packages.noScan": "请先扫描并翻译模组",
  "packages.result": "打包摘要",
  "packages.mods": "模组数",
  "packages.entries": "条目数",
  "packages.conflicts": "冲突数",
  "packages.conflictDetail": "冲突详情",
  "packages.confirmTitle": "确认部署",
  "packages.confirmMessage": "将资源包复制到实例 resourcepacks 目录：{path}",
  "packages.copyToInstance": "复制到实例",
  "packages.copySuccess": "已复制到 {path} {replaced}",
  "packages.copyFailed": "复制失败",
  "packages.replaced": "（已替换旧版本）",
  "settings.title": "设置中心",
  "settings.subtitle": "常用选项会持久化保存到本地设置文件。",
  "settings.systemPrompt": "系统提示词",
  "settings.systemPromptHint": "自定义 AI 翻译助手的角色和行为设定。默认已提供完善的 Minecraft 翻译专家设定，大多数用户无需修改。",
  "settings.save": "保存设置",
  "settings.saved": "设置已保存",
  "settings.fetchModels": "拉取模型",
  "settings.modelsFetched": "已从 {url} 拉取 {count} 个模型",
  "settings.autosaveHint": "自动保存需点击右上角保存按钮",
  "settings.provider": "供应商",
  "settings.baseUrl": "API 地址",
  "settings.tab.language": "语言与翻译",
  "settings.tab.api": "API 设置",
  "settings.tab.performance": "性能设置",
  "settings.tab.reuse": "资源复用",
  "settings.tab.logs": "日志设置",
  "settings.tab.advanced": "高级设置",
  "settings.tab.appearance": "界面",
  "settings.apiKey": "API 密钥",
  "settings.appLanguage": "应用语言",
  "settings.uiFont": "界面字体",
  "settings.uiFontOption.system": "系统默认",
  "settings.uiFontOption.yahei": "微软雅黑",
  "settings.uiFontOption.noto": "思源黑体",
  "settings.uiFontOption.simsun": "宋体",
  "settings.uiFontPresets": "预设",
  "settings.uiFontSystem": "系统字体（{count} 个）",
  "settings.loadingFonts": "正在加载…",
  "settings.uiTheme": "主题",
  "settings.uiThemeOption.default": "经典",
  "settings.uiThemeOption.ocean": "海洋蓝",
  "settings.uiThemeOption.aurora": "极光紫",
  "settings.uiThemeOption.gold": "琥珀金",
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
  "settings.concurrencyHint": "同时发送的 API 请求数量（默认 10）。程序会自动根据 API 限流情况动态调整，遇 429 自动降级，无需手动操心。",
  "settings.batchSize": "Batch size",
  "settings.batchSizeHint": "每批最多包含的条目数（默认 80）。较大的 batch 可提高 Token 利用率，但单次响应时间更长。建议保持默认。",
  "settings.batchMaxChars": "每批最大字符数",
  "settings.batchMaxCharsHint": "每批的最大字符数（默认 120000）。超过此值时自动拆分批次。适用于 API 有上下文窗口限制的情况。",
  "settings.timeoutSecs": "超时时间（秒）",
  "settings.timeoutSecsHint": "单次 API 请求的超时秒数（默认 180）。翻译大批量时可适当增加。",
  "settings.retryCount": "重试次数",
  "settings.retryCountHint": "API 请求失败时的重试次数（默认 5）。限流导致的失败有特殊处理。",
  "settings.retryDelaySecs": "重试延迟（秒）",
  "settings.retryDelaySecsHint": "首次重试前的等待秒数（默认 2）。后续重试的等待时间会翻倍（2→4→8 秒）。",
  "settings.rateLimitRpm": "速率限制（RPM）",
  "settings.rateLimitRpmHint": "每分钟最多请求数（默认 3000）。0 表示不限速。超过此值时自动等待。",
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
  "settings.translationPacks": "汉化资源包",
  "settings.resourcePackName": "资源包文件名",
  "settings.resourcePackHint": "扫描 resourcepacks/ 时会按此名称在实例中匹配资源包",
  "settings.addPack": "添加资源包",
  "settings.removePack": "删除",
  "settings.packPlaceholder": "例如: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
  "settings.packDefaultI18n": "默认含 CFPAOrg (i18n) 和 VM 汉化资源包",
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
  "tooltip.scan": "开始扫描模组的语言文件",
  "tooltip.cancelScan": "取消正在进行的扫描",
  "tooltip.pickInstance": "选择 Minecraft 实例目录",
  "tooltip.rescan": "重新扫描所有模组",
  "tooltip.saveSettings": "保存并应用当前的设置更改",
  "tooltip.fetchModels": "从 API 拉取可用模型列表",
  "tooltip.generatePack": "生成翻译资源包",
  "tooltip.dryRun": "预览将生成的翻译内容",
  "tooltip.copyToInstance": "将资源包复制到实例目录",
  "tooltip.startTranslation": "开始翻译待处理的条目",
  "tooltip.stopTranslation": "停止正在进行的翻译任务",
  "tooltip.clearLog": "清空所有翻译日志条目",
  "tooltip.export": "将词典条目导出为文件",
  "tooltip.import": "从文件导入词典条目",
  "tooltip.search": "搜索匹配的词典条目",
  "tooltip.delete": "永久删除此条目",
  "tooltip.filter": "按此列筛选",
  "tooltip.clearFilter": "清除此列的筛选条件",
  "tooltip.validate": "确认打包并生成资源包",
  "tooltip.nav": "导航到 {page} 页面",
  "tooltip.currentPage": "当前所在页面",
  "tooltip.busy": "{page} 正在运行…",
  "tooltip.completed": "{page} 已完成",
  "summary.scanCompleted": "扫描完成",
  "summary.translateCompleted": "翻译完成",
  "summary.elapsed": "耗时",
  "summary.mods": "{count} 个模组",
  "summary.modsSpeed": "{speed} 模组/秒",
  "summary.entries": "{count} 条翻译",
  "summary.entriesSpeed": "{speed} 条/秒",
  "summary.dictionary": "词典 {count}",
  "summary.llm": "LLM {count}",
  "summary.failed": "失败 {count}",
};

const enUs: TranslationMap = {
  ...zhCn,
  "app.loadingSettings": "Loading settings...",
  "app.brandSubtitle": "MC Translator",
  "app.currentInstance": "Current instance",
  "app.noInstance": "No instance selected",
  "app.ready": "Ready",
  "pipeline.validate": "Validate",
  "nav.dashboard": "Scan",
  "nav.jobs": "Translate",
  "nav.validate": "Validate",
  "nav.packages": "Pack",
  "nav.ftb": "FTB",
  "nav.hardcoded": "Hardcoded",
  "nav.dictionary": "Dictionary",
  "nav.settings": "Settings",
  "nav.logs": "Debug",
  "nav.collapse": "Collapse sidebar",
  "nav.expand": "Expand sidebar",
  "dashboard.title": "Project scan overview",
  "dashboard.subtitle": "Scan mod language files and existing target-language resource packs.",
  "dashboard.scan": "Start scan",
  "dashboard.instancePath": "Instance path",
  "dashboard.pickInstance": "Choose instance",
  "dashboard.pickInstanceError": "Failed to pick instance: ",
  "dashboard.rescan": "Rescan",
  "dashboard.warningsCount": "{count} scan warnings",
  "dashboard.stats.mods": "Scanned mods",
  "dashboard.stats.pendingEntries": "Pending entries",
  "dashboard.stats.resourcePackCovered": "Resource-pack covered",
  "dashboard.stats.resourcePackCoveredHint": "Matched source keys",
  "dashboard.stats.actualPending": "Queue total",
  "dashboard.stats.actualPendingHint": "Entries needing translation (excl. existing)",
  "dashboard.stats.recovered": "Recovered files",
  "dashboard.stats.recoveredHint": "Lenient parse",
  "dashboard.modsTitle": "Detected mods",
  "dashboard.waiting": "Waiting for scan",
  "dashboard.column.mod": "Mod",
  "dashboard.column.langFiles": "Lang files",
  "dashboard.column.recovered": "Recovered",
  "dashboard.column.source": "Source",
  "dashboard.column.target": "Target",
  "dashboard.column.pending": "Pending",
  "dashboard.column.status": "Status",
  "dashboard.filterEmpty": "No matching mods. Try adjusting filters.",
  "dashboard.filterSearch": "Search...",
  "dashboard.emptyScan": "Select an instance and start scanning to show results.",
  "dashboard.hasTarget": "Target exists",
  "dashboard.needsTranslation": "Needs translation",
  "dashboard.resourceSources": "Detected target-language resource sources",
  "dashboard.resourceCount": "{files} language files / {entries} entries",
  "dashboard.emptyResource": "Waiting for resource pack scan.",
  "dashboard.stage.scan": "Scanning mods",
  "dashboard.stage.resourcepacks": "Scanning resource packs",
  "dashboard.stage.aggregate": "Aggregating results",
  "dashboard.stage.log": "Writing logs",
  "dashboard.stage.done": "Scan complete",
  "dashboard.cancel": "Cancel scan",
  "dashboard.cancelling": "Stopping...",
  "dashboard.cancelledMessage": "Scan was cancelled, showing partial results",
  "common.copied": "Copied",
  "settings.title": "Settings",
  "settings.subtitle": "Common options are persisted to the local settings file.",
  "settings.systemPrompt": "System prompt",
  "settings.systemPromptHint": "Customize the AI translator's role and behavior. The default provides a complete Minecraft translation expert setup.",
  "settings.save": "Save settings",
  "settings.saved": "Settings saved",
  "settings.fetchModels": "Fetch models",
  "settings.modelsFetched": "Fetched {count} models from {url}",
  "settings.autosaveHint": "Click the save button to persist changes",
  "settings.provider": "Provider",
  "settings.baseUrl": "Base URL",
  "settings.tab.language": "Language & translation",
  "settings.tab.api": "API",
  "settings.tab.performance": "Performance",
  "settings.tab.reuse": "Reuse",
  "settings.tab.logs": "Logs",
  "settings.tab.advanced": "Advanced",
  "settings.tab.appearance": "Appearance",
  "settings.apiKey": "API Key",
  "settings.appLanguage": "App language",
  "settings.uiFont": "UI Font",
  "settings.uiFontOption.system": "System Default",
  "settings.uiFontOption.yahei": "Microsoft YaHei",
  "settings.uiFontOption.noto": "Noto Sans SC",
  "settings.uiFontOption.simsun": "SimSun",
  "settings.uiFontPresets": "Presets",
  "settings.uiFontSystem": "System Fonts ({count})",
  "settings.loadingFonts": "Loading…",
  "settings.uiTheme": "Theme",
  "settings.uiThemeOption.default": "Classic",
  "settings.uiThemeOption.ocean": "Ocean Blue",
  "settings.uiThemeOption.aurora": "Aurora Purple",
  "settings.uiThemeOption.gold": "Amber Gold",
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
  "settings.concurrencyHint": "Concurrent API requests (default 10). Auto-adapts to rate limits — 429 responses trigger automatic backoff.",
  "settings.batchSizeHint": "Max entries per batch (default 80). Larger batches use tokens more efficiently but take longer per request.",
  "settings.batchMaxChars": "Max chars per batch",
  "settings.batchMaxCharsHint": "Max characters per batch (default 120000). Batches exceeding this are auto-split.",
  "settings.timeoutSecs": "Timeout (seconds)",
  "settings.timeoutSecsHint": "Single request timeout in seconds (default 180). Increase for large batches.",
  "settings.retryCount": "Retry count",
  "settings.retryCountHint": "Retry count on failure (default 5). Rate limit failures have special handling.",
  "settings.retryDelaySecs": "Retry delay (seconds)",
  "settings.retryDelaySecsHint": "Initial retry delay in seconds (default 2). Subsequent retries double (2→4→8s).",
  "settings.rateLimitRpm": "Rate limit (RPM)",
  "settings.rateLimitRpmHint": "Max requests per minute (default 3000). 0 = unlimited.",
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
  "settings.translationPacks": "Translation packs",
  "settings.resourcePackName": "Pack filename",
  "settings.resourcePackHint": "Scanner matches resource packs in resourcepacks/ by this name",
  "settings.addPack": "Add pack",
  "settings.removePack": "Remove",
  "settings.packPlaceholder": "e.g. Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
  "settings.packDefaultI18n": "Defaults include CFPAOrg (i18n) and VM translation packs",
  "settings.futureAdvanced": "Dictionary, packaging, and lab settings will be connected in later phases.",
  "logs.title": "Logs",
  "logs.subtitle": "Phase 1 writes main, job, and error logs; full filters arrive later.",
  "logs.recentJob": "Recent job",
  "logs.jobId": "Job ID: {id}",
  "logs.instance": "Instance: {path}",
  "logs.empty": "No scan job has run yet.",
  "jobs.stage.matching": "Matching dictionary",
  "jobs.stage.translating": "Translating",
  "jobs.stage.packaging": "Packaging",
  "jobs.completed.message": "Translation complete: {count} entries",
  "jobs.canceled": "Translation canceled",
  "jobs.canceledStatus": "Canceled",
  "jobs.failed.message": "Translation failed: {error}",
  "jobs.retryFailed": "Retry Failed",
  "jobs.retrying": "Retrying...",
  "jobs.progressFallback": "- / -",
  "jobs.logPanel.title": "Translation Log",
  "jobs.logPanel.filterPlaceholder": "Filter by mod name or key...",
  "jobs.logPanel.clear": "Clear Log",
  "jobs.logPanel.copyEntry": "Copy",
  "jobs.logPanel.noEntries": "No translation log entries",
  "jobs.logPanel.entriesCount": "{count} entries",
  "jobs.logPanel.colKey": "Key",
  "jobs.logPanel.colSource": "Source",
  "jobs.logPanel.colTarget": "Target",
  "jobs.logPanel.colMod": "Mod",
  "jobs.logPanel.colType": "Type",
  "jobs.logPanel.colStatus": "Status",
  "jobs.entryStatus.pending": "Pending",
  "jobs.entryStatus.dictionaryHit": "Dictionary",
  "jobs.entryStatus.skip": "Skipped",
  "jobs.entryStatus.translating": "Translating",
  "jobs.entryStatus.completed": "Completed",
  "jobs.entryStatus.failed": "Failed",
  "jobs.sourceType.existing": "Existing",
  "jobs.sourceType.dictionary": "Dictionary",
  "jobs.sourceType.llm": "LLM",
  "jobs.sourceType.skipped": "Skipped",
  "jobs.sourceType.failed": "Failed",
  "placeholder.disabled": "Disabled",
  "placeholder.subtitle": "Phase 1 keeps this entry visible; the workflow will be connected later.",
  "placeholder.empty": "This module does not run automatic processing in the current phase.",
  "tooltip.scan": "Start scanning mod language files",
  "tooltip.cancelScan": "Cancel the current scan",
  "tooltip.pickInstance": "Select Minecraft instance directory",
  "tooltip.rescan": "Rescan all mods",
  "tooltip.saveSettings": "Save and apply current settings",
  "tooltip.fetchModels": "Fetch available models from the API",
  "tooltip.generatePack": "Generate translation resource pack",
  "tooltip.dryRun": "Preview translation contents",
  "tooltip.copyToInstance": "Copy resource pack to instance directory",
  "tooltip.startTranslation": "Start translating pending entries",
  "tooltip.stopTranslation": "Stop the running translation task",
  "tooltip.clearLog": "Clear all translation log entries",
  "tooltip.export": "Export dictionary entries to file",
  "tooltip.import": "Import dictionary entries from file",
  "tooltip.search": "Search matching dictionary entries",
  "tooltip.delete": "Permanently delete this entry",
  "tooltip.filter": "Filter by this column",
  "tooltip.clearFilter": "Clear this column's filter",
  "tooltip.validate": "Confirm packaging and generate resource pack",
  "tooltip.nav": "Navigate to {page} page",
  "tooltip.currentPage": "You are here",
  "tooltip.busy": "{page} is running…",
  "tooltip.completed": "{page} completed",
  "summary.scanCompleted": "Scan Complete",
  "summary.translateCompleted": "Translation Complete",
  "summary.elapsed": "Elapsed",
  "summary.mods": "{count} mods",
  "summary.modsSpeed": "{speed} mods/s",
  "summary.entries": "{count} entries",
  "summary.entriesSpeed": "{speed} entries/s",
  "summary.dictionary": "Dict {count}",
  "summary.llm": "LLM {count}",
  "summary.failed": "Failed {count}",
};

const jaJp: TranslationMap = {
  ...enUs,
  "app.loadingSettings": "設定を読み込んでいます...",
  "app.brandSubtitle": "MC 翻訳機",
  "app.currentInstance": "現在のインスタンス",
  "app.noInstance": "インスタンス未選択",
  "app.ready": "準備完了",
  "pipeline.validate": "検証",
  "nav.dashboard": "スキャン",
  "nav.jobs": "翻訳",
  "nav.validate": "検証",
  "nav.packages": "パック",
  "nav.ftb": "FTB",
  "nav.hardcoded": "ハードコード",
  "nav.dictionary": "辞書",
  "nav.settings": "設定",
  "nav.logs": "デバッグ",
  "nav.collapse": "サイドバーを折りたたむ",
  "nav.expand": "サイドバーを展開",
  "dashboard.title": "プロジェクトスキャン概要",
  "dashboard.subtitle": "Mod の言語ファイルと既存の対象言語リソースパックをスキャンします。",
  "dashboard.scan": "スキャン開始",
  "dashboard.instancePath": "インスタンスパス",
  "dashboard.pickInstance": "選択",
  "dashboard.pickInstanceError": "インスタンス選択に失敗しました：",
  "dashboard.rescan": "再スキャン",
  "dashboard.warningsCount": "{count} 件のスキャン警告",
  "dashboard.stats.mods": "スキャン済み Mod",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.pendingEntries": "未翻訳項目",
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
  "dashboard.filterEmpty": "一致する Mod がありません。フィルターを調整してください。",
  "dashboard.filterSearch": "検索...",
  "dashboard.emptyScan": "インスタンスを選択してスキャンを開始すると結果が表示されます。",
  "dashboard.hasTarget": "対象言語あり",
  "dashboard.needsTranslation": "翻訳待ち",
  "dashboard.resourceSources": "検出された対象言語リソース",
  "dashboard.resourceCount": "{files} 個の言語ファイル / {entries} 件",
  "dashboard.emptyResource": "リソースパックのスキャン待ち。",
  "dashboard.stage.scan": "Mod スキャン中",
  "dashboard.stage.resourcepacks": "リソースパック スキャン中",
  "dashboard.stage.aggregate": "結果集計中",
  "dashboard.stage.log": "ログ書き込み中",
  "dashboard.stage.done": "スキャン完了",
  "dashboard.cancel": "スキャンキャンセル",
  "dashboard.cancelling": "停止中...",
  "dashboard.cancelledMessage": "スキャンがキャンセルされました。部分的な結果を表示しています",
  "settings.title": "設定",
  "settings.subtitle": "よく使う設定はローカル設定ファイルに保存されます。",
  "settings.save": "設定を保存",
  "settings.saved": "設定を保存しました",
  "settings.fetchModels": "モデル取得",
  "settings.autosaveHint": "変更の保存には右上の保存ボタンが必要です",
  "settings.provider": "プロバイダ",
  "settings.baseUrl": "ベース URL",
  "settings.tab.language": "言語と翻訳",
  "settings.tab.api": "API 設定",
  "settings.tab.performance": "性能設定",
  "settings.tab.reuse": "再利用",
  "settings.tab.logs": "ログ設定",
  "settings.tab.advanced": "詳細設定",
  "settings.tab.appearance": "外観",
  "settings.apiKey": "API キー",
  "settings.appLanguage": "アプリ言語",
  "settings.uiFont": "UIフォント",
  "settings.uiFontOption.system": "システムデフォルト",
  "settings.uiFontOption.yahei": "Microsoft YaHei",
  "settings.uiFontOption.noto": "Noto Sans SC",
  "settings.uiFontOption.simsun": "SimSun",
  "settings.uiFontPresets": "プリセット",
  "settings.uiFontSystem": "システムフォント（{count}）",
  "settings.loadingFonts": "読み込み中…",
  "settings.uiTheme": "テーマ",
  "settings.uiThemeOption.default": "クラシック",
  "settings.uiThemeOption.ocean": "オーシャンブルー",
  "settings.uiThemeOption.aurora": "オーロラパープル",
  "settings.uiThemeOption.gold": "アンバーゴールド",
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
  "settings.translationPacks": "翻訳リソースパック",
  "settings.resourcePackName": "リソースパックファイル名",
  "settings.resourcePackHint": "スキャナーは resourcepacks/ 内をこの名前で検索します",
  "settings.addPack": "リソースパックを追加",
  "settings.removePack": "削除",
  "settings.packPlaceholder": "例: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
  "settings.packDefaultI18n": "デフォルトで CFPAOrg (i18n) と VM 翻訳パックを含みます",
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
  "tooltip.scan": "Mod の言語ファイルをスキャンします",
  "tooltip.cancelScan": "進行中のスキャンをキャンセル",
  "tooltip.pickInstance": "Minecraft インスタンスディレクトリを選択",
  "tooltip.rescan": "すべての Mod を再スキャン",
  "tooltip.saveSettings": "設定を保存して適用",
  "tooltip.fetchModels": "API から利用可能なモデルを取得",
  "tooltip.generatePack": "翻訳リソースパックを生成",
  "tooltip.dryRun": "翻訳内容をプレビュー",
  "tooltip.copyToInstance": "リソースパックをインスタンスにコピー",
  "tooltip.startTranslation": "未翻訳項目の翻訳を開始",
  "tooltip.stopTranslation": "実行中の翻訳を停止",
  "tooltip.clearLog": "すべての翻訳ログをクリア",
  "tooltip.export": "辞書をファイルにエクスポート",
  "tooltip.import": "ファイルから辞書をインポート",
  "tooltip.search": "辞書を検索",
  "tooltip.delete": "この項目を完全に削除",
  "tooltip.filter": "この列でフィルター",
  "tooltip.clearFilter": "この列のフィルターをクリア",
  "tooltip.validate": "パッケージを確認して生成",
  "tooltip.nav": "{page} ページに移動",
  "tooltip.currentPage": "現在のページ",
  "tooltip.busy": "{page} を実行中…",
  "tooltip.completed": "{page} 完了",
  "summary.scanCompleted": "スキャン完了",
  "summary.translateCompleted": "翻訳完了",
  "summary.elapsed": "経過時間",
  "summary.mods": "{count} 個のMOD",
  "summary.modsSpeed": "{speed} MOD/秒",
  "summary.entries": "{count} 項目",
  "summary.entriesSpeed": "{speed} 項目/秒",
  "summary.dictionary": "辞書 {count}",
  "summary.llm": "LLM {count}",
  "summary.failed": "失敗 {count}",
};

const koKr: TranslationMap = {
  ...enUs,
  "app.loadingSettings": "설정을 불러오는 중...",
  "app.brandSubtitle": "MC 번역기",
  "app.currentInstance": "현재 인스턴스",
  "app.noInstance": "인스턴스가 선택되지 않음",
  "app.ready": "준비됨",
  "pipeline.validate": "검증",
  "nav.dashboard": "스캔",
  "nav.jobs": "번역",
  "nav.validate": "검증",
  "nav.packages": "패킹",
  "nav.ftb": "FTB",
  "nav.hardcoded": "하드코딩",
  "nav.dictionary": "사전",
  "nav.settings": "설정",
  "nav.logs": "디버그",
  "nav.collapse": "사이드바 접기",
  "nav.expand": "사이드바 펼치기",
  "dashboard.title": "프로젝트 스캔 개요",
  "dashboard.subtitle": "모드 언어 파일과 기존 대상 언어 리소스 팩을 스캔합니다.",
  "dashboard.scan": "스캔 시작",
  "dashboard.instancePath": "인스턴스 경로",
  "dashboard.pickInstance": "인스턴스 선택",
  "dashboard.pickInstanceError": "인스턴스 선택 실패: ",
  "dashboard.rescan": "다시 스캔",
  "dashboard.warningsCount": "스캔 경고 {count}개",
  "dashboard.stats.mods": "스캔한 모드",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.pendingEntries": "번역 대기 항목",
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
  "dashboard.filterEmpty": "일치하는 모드가 없습니다. 필터를 조정해 보세요.",
  "dashboard.filterSearch": "검색...",
  "dashboard.emptyScan": "인스턴스를 선택하고 스캔을 시작하면 결과가 표시됩니다.",
  "dashboard.hasTarget": "대상 언어 있음",
  "dashboard.needsTranslation": "번역 필요",
  "dashboard.resourceSources": "감지된 대상 언어 리소스",
  "dashboard.resourceCount": "언어 파일 {files}개 / 항목 {entries}개",
  "dashboard.emptyResource": "리소스 팩 스캔 대기.",
  "dashboard.stage.scan": "모드 스캔 중",
  "dashboard.stage.resourcepacks": "리소스팩 스캔 중",
  "dashboard.stage.aggregate": "결과 집계 중",
  "dashboard.stage.log": "로그 쓰는 중",
  "dashboard.stage.done": "스캔 완료",
  "dashboard.cancel": "스캔 취소",
  "dashboard.cancelling": "중지 중...",
  "dashboard.cancelledMessage": "스캔이 취소되었습니다. 부분 결과를 표시합니다",
  "settings.title": "설정",
  "settings.subtitle": "일반 옵션은 로컬 설정 파일에 저장됩니다.",
  "settings.save": "설정 저장",
  "settings.saved": "설정이 저장됨",
  "settings.fetchModels": "모델 가져오기",
  "settings.autosaveHint": "변경 사항을 저장하려면 오른쪽 위 저장 버튼을 누르세요",
  "settings.provider": "공급자",
  "settings.baseUrl": "기본 URL",
  "settings.tab.language": "언어 및 번역",
  "settings.tab.api": "API 설정",
  "settings.tab.performance": "성능 설정",
  "settings.tab.reuse": "재사용",
  "settings.tab.logs": "로그 설정",
  "settings.tab.advanced": "고급 설정",
  "settings.tab.appearance": "외관",
  "settings.apiKey": "API 키",
  "settings.appLanguage": "앱 언어",
  "settings.uiFont": "UI 글꼴",
  "settings.uiFontOption.system": "시스템 기본",
  "settings.uiFontOption.yahei": "Microsoft YaHei",
  "settings.uiFontOption.noto": "Noto Sans SC",
  "settings.uiFontOption.simsun": "SimSun",
  "settings.uiFontPresets": "프리셋",
  "settings.uiFontSystem": "시스템 글꼴 ({count}개)",
  "settings.loadingFonts": "로딩 중…",
  "settings.uiTheme": "테마",
  "settings.uiThemeOption.default": "클래식",
  "settings.uiThemeOption.ocean": "오션 블루",
  "settings.uiThemeOption.aurora": "오로라 퍼플",
  "settings.uiThemeOption.gold": "앰버 골드",
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
  "settings.translationPacks": "번역 리소스 팩",
  "settings.resourcePackName": "리소스 팩 파일명",
  "settings.resourcePackHint": "스캐너가 resourcepacks/ 에서 이 이름으로 검색합니다",
  "settings.addPack": "팩 추가",
  "settings.removePack": "삭제",
  "settings.packPlaceholder": "예: Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
  "settings.packDefaultI18n": "기본적으로 CFPAOrg (i18n) 및 VM 번역 팩 포함",
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
  "tooltip.scan": "모드 언어 파일 스캔 시작",
  "tooltip.cancelScan": "진행 중인 스캔 취소",
  "tooltip.pickInstance": "Minecraft 인스턴스 디렉토리 선택",
  "tooltip.rescan": "모든 모드 다시 스캔",
  "tooltip.saveSettings": "현재 설정 저장 및 적용",
  "tooltip.fetchModels": "API에서 사용 가능한 모델 가져오기",
  "tooltip.generatePack": "번역 리소스 팩 생성",
  "tooltip.dryRun": "번역 내용 미리보기",
  "tooltip.copyToInstance": "리소스 팩을 인스턴스에 복사",
  "tooltip.startTranslation": "대기 중인 항목 번역 시작",
  "tooltip.stopTranslation": "실행 중인 번역 작업 중지",
  "tooltip.clearLog": "모든 번역 로그 지우기",
  "tooltip.export": "사전 항목을 파일로 내보내기",
  "tooltip.import": "파일에서 사전 항목 가져오기",
  "tooltip.search": "사전 항목 검색",
  "tooltip.delete": "이 항목을 영구 삭제",
  "tooltip.filter": "이 열로 필터링",
  "tooltip.clearFilter": "이 열의 필터 지우기",
  "tooltip.validate": "패키징 확인 및 리소스 팩 생성",
  "tooltip.nav": "{page} 페이지로 이동",
  "tooltip.currentPage": "현재 페이지",
  "tooltip.busy": "{page} 실행 중…",
  "tooltip.completed": "{page} 완료",
  "summary.scanCompleted": "스캔 완료",
  "summary.translateCompleted": "번역 완료",
  "summary.elapsed": "경과 시간",
  "summary.mods": "{count} 모드",
  "summary.modsSpeed": "{speed} 모드/초",
  "summary.entries": "{count} 항목",
  "summary.entriesSpeed": "{speed} 항목/초",
  "summary.dictionary": "사전 {count}",
  "summary.llm": "LLM {count}",
  "summary.failed": "실패 {count}",
};



const ruRu: TranslationMap = {
  ...enUs,
  "app.loadingSettings": "Загрузка настроек...",
  "app.brandSubtitle": "MC Перевод",
  "app.currentInstance": "Текущий экземпляр",
  "app.noInstance": "Экземпляр не выбран",
  "app.ready": "Готово",
  "pipeline.validate": "Проверка",
  "nav.dashboard": "Сканирование",
  "nav.jobs": "Перевод",
  "nav.validate": "Проверка",
  "nav.packages": "Упаковка",
  "nav.ftb": "FTB",
  "nav.hardcoded": "Хардкод",
  "nav.dictionary": "Словарь",
  "nav.settings": "Настройки",
  "nav.logs": "Отладка",
  "nav.collapse": "Свернуть панель",
  "nav.expand": "Развернуть панель",
  "dashboard.title": "Обзор сканирования проекта",
  "dashboard.subtitle": "Сканирование языковых файлов модов и ресурс-паков.",
  "dashboard.scan": "Начать сканирование",
  "dashboard.scanProgress": "{current} / {total}",
  "dashboard.instancePath": "Путь к экземпляру",
  "dashboard.instancePlaceholder": "E:/PCL2/.minecraft/versions/Aaalice Craft",
  "dashboard.pickInstance": "Выбрать экземпляр",
  "dashboard.pickInstanceError": "Не удалось выбрать экземпляр: ",
  "dashboard.rescan": "Пересканировать",
  "dashboard.warningsCount": "{count} предупреждений сканирования",
  "dashboard.stats.mods": "Просканировано модов",
  "dashboard.stats.modsHint": "mods/*.jar",
  "dashboard.stats.pendingEntries": "Ожидающих перевода",
  "dashboard.stats.resourcePackCovered": "Покрыто ресурс-паками",
  "dashboard.stats.resourcePackCoveredHint": "Совпавшие исходные ключи",
  "dashboard.stats.actualPending": "К переводу",
  "dashboard.stats.actualPendingHint": "Записи для перевода (без существующих переводов)",
  "dashboard.stats.recovered": "Восстановлено файлов",
  "dashboard.stats.recoveredHint": "Либеральный парсинг",
  "dashboard.modsTitle": "Обнаруженные моды",
  "dashboard.waiting": "Ожидание сканирования",
  "dashboard.column.mod": "Мод",
  "dashboard.column.modId": "ID мода",
  "dashboard.column.format": "Формат",
  "dashboard.column.langFiles": "Файлы языка",
  "dashboard.column.recovered": "Восстановлено",
  "dashboard.column.source": "Исходный",
  "dashboard.column.target": "Целевой",
  "dashboard.column.pending": "Ожидает",
  "dashboard.column.status": "Статус",
  "dashboard.filterEmpty": "Нет подходящих модов.",
  "dashboard.filterSearch": "Поиск...",
  "dashboard.emptyScan": "Выберите экземпляр и начните сканирование.",
  "dashboard.hasTarget": "Целевой язык есть",
  "dashboard.needsTranslation": "Требуется перевод",
  "dashboard.resourceSources": "Обнаружены источники ресурсов целевого языка",
  "dashboard.resourceCount": "{files} файлов / {entries} записей",
  "dashboard.emptyResource": "Ожидание сканирования ресурс-паков.",
  "dashboard.stage.scan": "Сканирование модов",
  "dashboard.stage.resourcepacks": "Сканирование ресурс-паков",
  "dashboard.stage.aggregate": "Сбор результатов",
  "dashboard.stage.log": "Запись логов",
  "dashboard.stage.done": "Сканирование завершено",
  "dashboard.cancel": "Отменить сканирование",
  "dashboard.cancelling": "Остановка...",
  "dashboard.cancelledMessage": "Сканирование отменено, показаны частичные результаты",
  "common.loading": "Загрузка...",
  "common.save": "Сохранить",
  "common.cancel": "Отмена",
  "common.copied": "Скопировано",
  "common.delete": "Удалить",
  "dictionary.title": "Словарь переводов",
  "dictionary.subtitle": "Управление записями пользовательского словаря.",
  "dictionary.subtitleEmpty": "Записей пока нет.",
  "dictionary.searchPlaceholder": "Поиск по исходному тексту...",
  "dictionary.allTypes": "Все типы",
  "dictionary.typeManual": "Ручной",
  "dictionary.typeResourcepack": "Ресурс-пак",
  "dictionary.typeCfpa": "CFPA",
  "dictionary.typeLlm": "LLM",
  "dictionary.search": "Поиск",
  "dictionary.export": "Экспорт",
  "dictionary.import": "Импорт",
  "dictionary.col.source": "Исходный",
  "dictionary.col.target": "Перевод",
  "dictionary.col.mod": "Мод",
  "dictionary.col.key": "Ключ",
  "dictionary.col.type": "Тип",
  "dictionary.col.actions": "Действия",
  "dictionary.clickToEdit": "Нажмите для редактирования",
  "dictionary.saved": "Сохранено",
  "dictionary.deleted": "Удалено",
  "dictionary.moreResults": "Показано {count} записей; возможно, есть еще.",
  "jobs.title": "Очередь перевода",
  "jobs.subtitle": "Мониторинг и управление задачами перевода.",
  "jobs.start": "Начать перевод",
  "jobs.running": "Выполняется...",
  "jobs.stop": "Остановить",
  "jobs.noScan": "Сначала выполните сканирование.",
  "jobs.noPending": "Нет записей, ожидающих перевода.",
  "jobs.summary": "Перевод: {mods} модов, {entries} записей",
  "jobs.totalEntries": "Записей: {count}",
  "jobs.sourceLang": "Исходный язык: {lang}",
  "jobs.targetLang": "Целевой язык: {lang}",
  "jobs.modCount": "Модов: {count}",
  "jobs.translating": "Перевод...",
  "jobs.stage.matching": "Сопоставление словаря",
  "jobs.stage.translating": "Перевод",
  "jobs.stage.packaging": "Упаковка",
  "jobs.completed.message": "Перевод завершен: {count} записей",
  "jobs.canceled": "Перевод отменен",
  "jobs.canceledStatus": "Отменено",
  "jobs.failed.message": "Ошибка перевода: {error}",
  "jobs.progressFallback": "- / -",
  "jobs.logPanel.title": "Журнал перевода",
  "jobs.logPanel.filterPlaceholder": "Фильтр по имени мода или ключу...",
  "jobs.logPanel.clear": "Очистить журнал",
  "jobs.logPanel.copyEntry": "Копировать",
  "jobs.logPanel.noEntries": "Нет записей в журнале",
  "jobs.logPanel.entriesCount": "{count} записей",
  "jobs.logPanel.colKey": "Ключ",
  "jobs.logPanel.colSource": "Исходный",
  "jobs.logPanel.colTarget": "Перевод",
  "jobs.logPanel.colMod": "Мод",
  "jobs.logPanel.colType": "Тип",
  "packages.title": "Упаковка перевода",
  "packages.subtitle": "Генерация ресурс-пака с переводами.",
  "packages.dryRun": "Тестовый запуск",
  "packages.generate": "Сгенерировать пак",
  "packages.noScan": "Сначала выполните сканирование.",
  "packages.result": "Результат: {mods} модов, {entries} записей",
  "packages.mods": "Модов: {count}",
  "packages.entries": "Записей: {count}",
  "packages.conflicts": "Конфликтов: {count}",
  "packages.conflictDetail": "{mod}: {key}",
  "packages.confirmTitle": "Подтверждение копирования",
  "packages.confirmMessage": "Скопировать ресурс-пак в экземпляр?",
  "packages.copyToInstance": "Копировать в экземпляр",
  "packages.copySuccess": "Ресурс-пак скопирован в экземпляр.",
  "packages.copyFailed": "Не удалось скопировать в экземпляр.",
  "packages.replaced": "Заменен существующий файл.",
  "settings.title": "Настройки",
  "settings.subtitle": "Общие параметры сохраняются в локальный файл.",
  "settings.save": "Сохранить настройки",
  "settings.saved": "Настройки сохранены",
  "settings.fetchModels": "Получить модели",
  "settings.modelsFetched": "Получено {count} моделей из {url}",
  "settings.autosaveHint": "Нажмите кнопку сохранения для изменений",
  "settings.provider": "Провайдер",
  "settings.baseUrl": "Базовый URL",
  "settings.tab.language": "Язык и перевод",
  "settings.tab.api": "API",
  "settings.tab.performance": "Производительность",
  "settings.tab.reuse": "Повторное использование",
  "settings.tab.logs": "Логи",
  "settings.tab.advanced": "Расширенные",
  "settings.tab.appearance": "Внешний вид",
  "settings.apiKey": "API ключ",
  "settings.appLanguage": "Язык приложения",
  "settings.uiFont": "Шрифт интерфейса",
  "settings.uiFontOption.system": "Системный",
  "settings.uiFontOption.yahei": "Microsoft YaHei",
  "settings.uiFontOption.noto": "Noto Sans SC",
  "settings.uiFontOption.simsun": "SimSun",
  "settings.uiFontPresets": "Пресеты",
  "settings.uiFontSystem": "Системные шрифты ({count})",
  "settings.loadingFonts": "Загрузка…",
  "settings.uiTheme": "Тема",
  "settings.uiThemeOption.default": "Классика",
  "settings.uiThemeOption.ocean": "Океанский синий",
  "settings.uiThemeOption.aurora": "Пурпурный",
  "settings.uiThemeOption.gold": "Золотистый",
  "settings.sourceLanguage": "Исходный язык",
  "settings.targetLanguage": "Целевой язык",
  "settings.sourceHint": "Исходный язык может быть auto; сканер предпочитает en_us.",
  "settings.targetHint": "Целевой язык должен быть кодом локали Minecraft.",
  "settings.invalidSourceLanguage": "Исходный язык должен быть auto или кодом локали Minecraft.",
  "settings.invalidTargetLanguage": "Целевой язык должен быть кодом локали Minecraft.",
  "settings.temperature": "Температура",
  "settings.temperatureHint": "Ниже = детерминированнее, выше = креативнее.",
  "settings.maxTokens": "Макс. токенов",
  "settings.maxTokensHint": "Ограничение токенов. 0 = без лимита.",
  "settings.maxTokensPlaceholder": "0 = без лимита",
  "settings.modelLabel": "Модель",
  "settings.modelPlaceholder": "Введите название модели...",
  "settings.noModels": "Модели не получены",
  "settings.selectModel": "Выберите модель...",
  "settings.customModel": "Ввести свою модель",
  "settings.pickFromList": "Выбрать из списка",
  "settings.concurrency": "Параллельных запросов",
  "settings.batchSize": "Размер пачки",
  "settings.batchMaxChars": "Макс. символов в пачке",
  "settings.timeoutSecs": "Таймаут (сек)",
  "settings.retryCount": "Кол-во повторов",
  "settings.retryDelaySecs": "Задержка повтора (сек)",
  "settings.rateLimitRpm": "Лимит запросов (RPM)",
  "settings.reuseI18n": "Обнаруживать и использовать i18n ресурс-паки",
  "settings.reuseVm": "Обнаруживать и использовать VM ресурс-паки",
  "settings.preferDictionary": "Предпочитать пользовательский словарь",
  "settings.keepExisting": "Сохранять существующие переводы в ресурс-паках",
  "settings.enableFtb": "Включить перевод FTB Quest",
  "settings.resetMainLog": "Сбрасывать main.log при запуске",
  "settings.enableDebug": "Включить отладочный лог",
  "settings.enableHttp": "Включить лог HTTP запросов",
  "settings.enableTokens": "Включить статистику токенов",
  "settings.defaultInstance": "Путь к экземпляру по умолчанию",
  "settings.translationPacks": "Ресурс-паки перевода",
  "settings.resourcePackName": "Имя файла ресурс-пака",
  "settings.resourcePackHint": "Сканер ищет ресурс-паки в resourcepacks/ по этому имени",
  "settings.addPack": "Добавить ресурс-пак",
  "settings.removePack": "Удалить",
  "settings.packPlaceholder": "например Minecraft-Mod-Language-Modpack-Converted-1.21.1.zip",
  "settings.packDefaultI18n": "По умолчанию включает CFPAOrg (i18n) и VM ресурс-паки",
  "settings.futureAdvanced": "Настройки словаря и упаковки будут позже.",
  "logs.title": "Логи",
  "logs.subtitle": "Фаза 1 записывает main, job и error логи.",
  "logs.recentJob": "Последняя задача",
  "logs.jobId": "ID задачи: {id}",
  "logs.instance": "Экземпляр: {path}",
  "logs.warning": "warning: {count}",
  "logs.empty": "Сканирование еще не выполнялось.",
  "placeholder.disabled": "Отключено",
  "placeholder.subtitle": "Фаза 1 держит модуль видимым; интеграция позже.",
  "placeholder.empty": "Модуль не запускает автообработку в текущей фазе.",
  "tooltip.scan": "Начать сканирование языковых файлов модов",
  "tooltip.cancelScan": "Отменить текущее сканирование",
  "tooltip.pickInstance": "Выбрать директорию экземпляра Minecraft",
  "tooltip.rescan": "Пересканировать все моды",
  "tooltip.saveSettings": "Сохранить и применить настройки",
  "tooltip.fetchModels": "Получить список моделей из API",
  "tooltip.generatePack": "Сгенерировать ресурс-пак перевода",
  "tooltip.dryRun": "Предпросмотр содержимого перевода",
  "tooltip.copyToInstance": "Скопировать ресурс-пак в экземпляр",
  "tooltip.startTranslation": "Начать перевод ожидающих записей",
  "tooltip.stopTranslation": "Остановить текущий перевод",
  "tooltip.clearLog": "Очистить все записи журнала перевода",
  "tooltip.export": "Экспортировать словарь в файл",
  "tooltip.import": "Импортировать словарь из файла",
  "tooltip.search": "Поиск записей в словаре",
  "tooltip.delete": "Удалить эту запись навсегда",
  "tooltip.filter": "Фильтр по этому столбцу",
  "tooltip.clearFilter": "Очистить фильтр этого столбца",
  "tooltip.validate": "Подтвердить упаковку и сгенерировать пак",
  "tooltip.nav": "Перейти на страницу {page}",
  "tooltip.currentPage": "Текущая страница",
  "tooltip.busy": "{page} выполняется…",
  "tooltip.completed": "{page} выполнено",
  "summary.scanCompleted": "Сканирование завершено",
  "summary.translateCompleted": "Перевод завершён",
  "summary.elapsed": "Прошло",
  "summary.mods": "{count} модов",
  "summary.modsSpeed": "{speed} модов/с",
  "summary.entries": "{count} записей",
  "summary.entriesSpeed": "{speed} записей/с",
  "summary.dictionary": "Словарь {count}",
  "summary.llm": "LLM {count}",
  "summary.failed": "Ошибок {count}",
};
const translations: Record<AppLanguage, TranslationMap> = {
  zh_cn: zhCn,
  en_us: enUs,
  ja_jp: jaJp,
  ko_kr: koKr,
  ru_ru: ruRu,
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
