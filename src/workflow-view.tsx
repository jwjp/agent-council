import type { Activity, Job, Settings } from "./types";
import { workflowProgress } from "./workflow";
import "./workflow.css";

export function WorkflowProgress({
  job,
  events,
  settings,
  t,
}: {
  job: Job | null;
  events: Activity[];
  settings: Pick<Settings, "coder" | "reviewers">;
  t: (en: string, ko: string) => string;
}) {
  if (!job) return null;
  const flow = workflowProgress(job, events, settings);
  const label: Record<string, string> = {
    work: t("Work", "작업"),
    review: t("Review", "검토"),
    refinement: t("Improve", "의견 반영"),
    verification: t("Recheck", "재검토"),
    discussion: t("Discuss", "의견 비교"),
    report: t("Synthesize", "최종 정리"),
    question: t("Your input", "답변 대기"),
  };
  const titles: Record<string, string> = {
    work: t("Working on your request", "요청을 살펴보고 있어요"),
    review: t(
      "Gathering independent perspectives",
      "각자의 시선으로 검토하고 있어요",
    ),
    refinement: t(
      "Applying confirmed feedback",
      "확인된 의견을 반영하고 있어요",
    ),
    verification: t(
      "Checking what changed",
      "수정 결과를 다시 확인하고 있어요",
    ),
    discussion: t(
      "Finding the strongest conclusion",
      "의견을 비교해 더 나은 방향을 찾고 있어요",
    ),
    report: t(
      "Bringing the findings together",
      "결과와 근거를 정리하고 있어요",
    ),
  };
  const title =
    flow.stage === "question"
      ? t(
          "Your answer will guide the next step",
          "답변을 주시면 이어서 진행할 수 있어요",
        )
      : flow.running
        ? titles[flow.stage] || titles.work
        : job.status === "done"
          ? flow.issues
            ? t(
                "Finished with some agents unavailable",
                "일부 AI의 확인이 필요한 상태로 마쳤어요",
              )
            : t("Ready for your next step", "다음 대화를 이어갈 준비가 됐어요")
          : job.status === "cancelled"
            ? t("Stopped at your request", "요청에 따라 중지했어요")
            : t("This run needs attention", "진행 기록을 확인해 주세요");
  const index = flow.steps.indexOf(flow.stage);
  return (
    <section
      className="workflow-progress"
      data-running={flow.running}
      data-stage={flow.stage}
      aria-label={t("Council progress", "회의 진행 상황")}
    >
      <div className="workflow-heading" aria-live="polite" aria-atomic="true">
        <span
          className={`workflow-light ${flow.running ? "active" : flow.issues ? "issue" : ""}`}
        />
        <strong>{title}</strong>
        {flow.running && flow.members.length > 0 && (
          <span className="workflow-count">
            {flow.completed}/{flow.members.length} {t("finished", "완료")}
            {flow.failed > 0 &&
              ` · ${flow.failed} ${t("unavailable", "확인 필요")}`}
          </span>
        )}
      </div>
      <ol className="workflow-steps">
        {flow.steps.map((stage, i) => (
          <li
            key={stage}
            data-state={
              stage === flow.stage && flow.running
                ? "active"
                : i < index ||
                    (!flow.running &&
                      job.status === "done" &&
                      flow.stage !== "question")
                  ? "done"
                  : "pending"
            }
            aria-current={stage === flow.stage ? "step" : undefined}
          >
            <span className="workflow-node">{i + 1}</span>
            {label[stage]}
          </li>
        ))}
      </ol>
    </section>
  );
}
