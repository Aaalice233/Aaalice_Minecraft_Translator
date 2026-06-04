import type { AppLanguage, PipelineStage, StageStatus } from "../types";
import { PIPELINE_STAGES } from "../types";
import { t } from "../i18n/translations";

interface Props {
  currentStage: PipelineStage;
  stageStatuses: Record<PipelineStage, StageStatus>;
  onNavigate: (stage: PipelineStage) => void;
  language: AppLanguage;
}

const STATUS_ICON: Record<StageStatus, string> = {
  completed: "✅",
  active: "",
  failed_partial: "⚠️",
  failed_total: "❌",
  locked: "",
};

const STATUS_CLASS: Record<StageStatus, string> = {
  completed: "pipeline-stage-completed",
  active: "pipeline-stage-active",
  failed_partial: "pipeline-stage-failed-partial",
  failed_total: "pipeline-stage-failed-total",
  locked: "pipeline-stage-locked",
};

/**
 * PipelineBreadcrumb — 全展开流水线面包屑导航
 *
 * 所有阶段始终显示名称，没有折叠/悬浮效果。
 * locked 阶段灰色不可点击，其他阶段根据状态显示对应颜色和图标。
 */
export function PipelineBreadcrumb({
  currentStage,
  stageStatuses,
  onNavigate,
  language,
}: Props) {
  return (
    <nav className="pipeline-breadcrumb" aria-label={t(language, "pipeline.scan") + " pipeline"}>
      {PIPELINE_STAGES.map((stage, idx) => {
        const status = stageStatuses[stage];
        const isCurrent = stage === currentStage;

        return (
          <span key={stage} className="pipeline-stage-wrap">
            {idx > 0 && <span className="pipeline-arrow">→</span>}

            <button
              className={`pipeline-stage-node ${STATUS_CLASS[status]} ${isCurrent ? "is-current" : ""}`}
              disabled={isCurrent || status === "locked"}
              onClick={() => !isCurrent && onNavigate(stage)}
              type="button"
            >
              {STATUS_ICON[status] && (
                <span className="pipeline-stage-icon">{STATUS_ICON[status]}</span>
              )}
              <span>{t(language, `pipeline.${stage}` as const)}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
