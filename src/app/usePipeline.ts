import { useCallback, useMemo, useState } from "react";
import type { PipelineStage, StageStatus } from "../types";
import { PIPELINE_STAGES } from "../types";

export interface UsePipelineReturn {
  currentStage: PipelineStage;
  stageStatuses: Record<PipelineStage, StageStatus>;
  nextStage: PipelineStage | null;
  advanceStage: () => void;
  resetPipeline: () => void;
  markStageFailed: (stage: PipelineStage, type: "failed_partial" | "failed_total") => void;
  onScanComplete: (
    activePage: string,
    stageToPage: Record<PipelineStage, string>,
  ) => string | null;
}

const INITIAL_STATUSES: Record<PipelineStage, StageStatus> = {
  scan: "active",
  translate: "locked",
  validate: "locked",
  pack: "locked",
};

/**
 * usePipeline — 管理整条翻译流水线的阶段状态和转换逻辑
 *
 * 状态转换规则:
 *   locked → active : 前一阶段 completed 时自动或手动触发
 *   active → completed : 阶段业务逻辑完成时触发
 *   active → failed_partial : 部分失败（允许继续）
 *   active → failed_total : 完全失败（阻止进入下一阶段）
 *   completed → locked : 仅重新扫描时触发
 */
export function usePipeline(): UsePipelineReturn {
  const [currentStage, setCurrentStage] = useState<PipelineStage>("scan");
  const [stageStatuses, setStageStatuses] = useState<
    Record<PipelineStage, StageStatus>
  >(INITIAL_STATUSES);

  /** 计算下一阶段（按 PIPELINE_STAGES 顺序，无条件返回） */
  const nextStage = useMemo<PipelineStage | null>(() => {
    const idx = PIPELINE_STAGES.indexOf(currentStage);
    if (idx === -1 || idx >= PIPELINE_STAGES.length - 1) return null;
    return PIPELINE_STAGES[idx + 1];
  }, [currentStage]);

  /** 推进到下一阶段 */
  const advanceStage = useCallback(() => {
    const idx = PIPELINE_STAGES.indexOf(currentStage);
    if (idx === -1 || idx >= PIPELINE_STAGES.length - 1) return;
    const next = PIPELINE_STAGES[idx + 1];

    // 标记当前阶段为 completed
    setStageStatuses((prev) => ({ ...prev, [currentStage]: "completed" }));
    // 标记下一阶段为 active
    setStageStatuses((prev) => ({ ...prev, [next]: "active" }));
    // 推进 currentStage
    setCurrentStage(next);
  }, [currentStage]);

  /** 重置流水线（重新扫描时调用） */
  const resetPipeline = useCallback(() => {
    setCurrentStage("scan");
    setStageStatuses(INITIAL_STATUSES);
  }, []);

  /** 将指定阶段标记为失败 */
  const markStageFailed = useCallback(
    (stage: PipelineStage, type: "failed_partial" | "failed_total") => {
      setStageStatuses((prev) => ({ ...prev, [stage]: type }));
    },
    [],
  );

  /**
   * 扫描完成回调 — 仅记录扫描结果，不推进阶段
   * 用户通过"下一阶段"按钮手动控制阶段推进
   */
  const onScanComplete = useCallback(
    (_activePage: string, _stageToPage: Record<PipelineStage, string>): null => {
      return null;
    },
    [],
  );

  return {
    currentStage,
    stageStatuses,
    nextStage,
    advanceStage,
    resetPipeline,
    markStageFailed,
    onScanComplete,
  };
}
