import type { ReactNode } from "react";
import type { Message } from "./types";
import "./report-content.css";

export function ReportContent({ message, render, label }: {
  message: Message;
  render: (text: string) => ReactNode;
  label: string;
}) {
  const { text, report_summary: summary } = message;
  if (!summary || !text.startsWith(summary)) return render(text);
  const details = text.slice(summary.length).trim();
  return (
    <>
      {render(summary)}
      {details && (
        <details className="report-evidence">
          <summary>{label}</summary>
          {render(details)}
        </details>
      )}
    </>
  );
}
