export interface PipelineCountSummary {
  pipelineContactCount: number;
  excludedFromPipelineCount: number;
  allContactCount: number;
}

/** Shared default predicate for any view that claims to describe the lead pipeline. */
export function pipelineContactWhere(): { excludeFromPipeline: false } {
  return { excludeFromPipeline: false };
}

/** Names every population explicitly so filtered totals cannot be mistaken for raw totals. */
export function summarizePipelineCounts(
  includedCounts: readonly number[],
  excludedFromPipelineCount: number
): PipelineCountSummary {
  const pipelineContactCount = includedCounts.reduce((sum, count) => sum + count, 0);
  return {
    pipelineContactCount,
    excludedFromPipelineCount,
    allContactCount: pipelineContactCount + excludedFromPipelineCount,
  };
}
