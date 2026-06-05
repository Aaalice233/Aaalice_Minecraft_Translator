import { PackageCheck } from "lucide-react";
import type { AppLanguage } from "../types";
import { t } from "../i18n/translations";

interface Props {
  language: AppLanguage;
  onConfirm: () => void;
}

/**
 * ValidatePage — 校验阶段 placeholder
 *
 * 翻译完成后进入校验阶段，供用户检查冲突后手动触发打包。
 * 首期仅显示提示文本和确认按钮，校验的具体逻辑后续接入。
 */
export function ValidatePage({ language, onConfirm }: Props) {
  return (
    <section className="page validate-page">
      <div className="page-header">
        <div>
          <h1>{t(language, "pipeline.validate")}</h1>
          <p>翻译完成，请检查冲突后确认打包（首期 placeholder，后续接入完整校验功能）</p>
        </div>
      </div>

      <div className="panel" style={{ padding: "24px 18px", marginBottom: 18 }}>
        <p style={{ color: "#6b665d", margin: 0 }}>
          校验阶段 — 后续接入。翻译完成后将在此处显示冲突检查和格式校验结果。
        </p>
      </div>

      <button
        className="primary-button"
        onClick={onConfirm}
        type="button"
        data-tooltip={t(language, "tooltip.validate")}
      >
        <PackageCheck size={18} />
        确认打包
      </button>
    </section>
  );
}
