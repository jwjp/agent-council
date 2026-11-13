import { useEffect, useState } from "react";
import { ChevronRight, FileDiff } from "lucide-react";
import { api } from "./api";

type Change = {
  path: string;
  kind: "added" | "modified" | "deleted";
  patch: string | null;
  truncated: boolean;
};
type Changes = { available: boolean; source?: "git" | "folder"; skipped: number; files: Change[] };
type Translate = (en: string, ko: string) => string;

export function ReportChanges({ job, t }: { job: string; t: Translate }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void api<Changes | null>(
      `/jobs/${encodeURIComponent(job)}/changes`,
      undefined,
      "GET",
      {
        retryOnDisconnect: true,
      },
    ).then(
      (value) => {
        if (current) setChanges(value);
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [job]);

  if (error || changes?.available === false) {
    return (
      <p className="report-change-note">
        {error
          ? t("Could not load changes.", "변경 내역을 불러오지 못했습니다.")
          : t(
              "No comparable file snapshots for this run.",
              "이번 작업의 파일 전후 기록을 비교할 수 없습니다.",
            )}
      </p>
    );
  }
  if (!changes) return null;
  if (!changes.files.length) {
    return (
      <p className="report-change-note">
        {changes.skipped
          ? t(
              "No changes in comparable files. Some files were skipped.",
              "비교 가능한 파일에서 변경이 없었습니다. 일부 파일은 제외됐습니다.",
            )
          : changes.source === "folder"
            ? t("No changes in supported project files.", "비교 대상 프로젝트 파일에 변경이 없었습니다.")
            : t(
              "No working-tree changes in this run.",
              "이번 작업에서 작업 트리 변경이 없었습니다.",
            )}
      </p>
    );
  }
  return (
    <details className="report-changes">
      <summary>
        <FileDiff size={14} aria-hidden="true" />
        <strong>{t("Changes from this run", "이번 작업의 변경 내역")}</strong>
        <span>
          {changes.files.length}
          {changes.skipped ? "+" : ""}
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      {changes.source === "folder" && (
        <p className="report-change-note">
          {t("Folder comparison covers supported text files.", "폴더 비교는 지원하는 텍스트 파일을 대상으로 합니다.")}
        </p>
      )}
      {changes.skipped > 0 && (
        <p className="report-change-note">
          {t(
            "Some files could not be compared or displayed.",
            "일부 파일은 비교하거나 표시하지 못했습니다.",
          )}
        </p>
      )}
      {changes.files.map(({ path, kind, patch, truncated }) => {
        const open = selected === path;
        return (
          <div className="report-change-file" key={path}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setSelected(open ? null : path)}
            >
              <code title={path}>{path}</code>
              <span data-kind={kind}>
                {kind === "added"
                  ? t("Added", "추가")
                  : kind === "deleted"
                    ? t("Deleted", "삭제")
                    : t("Modified", "수정")}
              </span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            {open && (
              <>
                {patch && (
                  <pre
                    className="report-diff scrollable"
                    tabIndex={0}
                    aria-label={t("File diff", "파일 변경 비교")}
                  >
                    {patch.split("\n").map((line, index) => (
                      <span
                        key={index}
                        data-line={
                          line.startsWith("@@")
                            ? "hunk"
                            : line.startsWith("+")
                              ? "add"
                              : line.startsWith("-")
                                ? "delete"
                                : undefined
                        }
                      >
                        {line || " "}
                      </span>
                    ))}
                  </pre>
                )}
                {(!patch || truncated) && (
                  <p className="report-change-note">
                    {truncated
                      ? t(
                          "Preview limited by size.",
                          "미리보기 크기 제한이 적용됐습니다.",
                        )
                      : t(
                          "No text diff for this file.",
                          "이 파일의 텍스트 변경 비교가 없습니다.",
                        )}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </details>
  );
}
