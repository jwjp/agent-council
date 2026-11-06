import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileText, Copy, X, AlertCircle } from "lucide-react";
import { api } from "./api";
export const FileLinkContext = createContext<(target: string) => void>(
  () => {},
);
export const useFileLink = () => useContext(FileLinkContext);
interface Preview {
  path: string;
  name: string;
  text: string;
  line: number | null;
  truncated: boolean;
  start_line: number;
}
export function FilePreviewProvider({
  children,
  ko,
}: {
  children: ReactNode;
  ko: boolean;
}) {
  const [target, setTarget] = useState(""),
    [file, setFile] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null),
    request = useRef(0);
  useEffect(() => {
    if (!target) return;
    const id = ++request.current;
    setFile(null);
    setError("");
    setCopied(false);
    void api<Preview>("/files/read", { target })
      .then((v) => {
        if (id === request.current) setFile(v);
      })
      .catch((e) => {
        if (id === request.current) setError(String(e));
      });
    const previous = document.activeElement as HTMLElement | null;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setTarget("");
      }
    };
    document.addEventListener("keydown", listener, true);
    ref.current?.focus();
    return () => {
      request.current++;
      document.removeEventListener("keydown", listener, true);
      previous?.focus();
    };
  }, [target]);
  useEffect(() => {
    ref.current
      ?.querySelector(".highlighted-line")
      ?.scrollIntoView({ block: "center" });
  }, [file]);
  return (
    <FileLinkContext.Provider value={setTarget}>
      {children}
      {target && (
        <div className="file-backdrop" onClick={() => setTarget("")}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={ko ? "파일 미리보기" : "File preview"}
            className="file-drawer"
            ref={ref}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const nodes = ref.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              );
              if (!nodes?.length) return;
              const first = nodes[0],
                last = nodes[nodes.length - 1];
              if (
                e.shiftKey &&
                (document.activeElement === first ||
                  document.activeElement === ref.current)
              ) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }}
          >
            <header>
              <span className="file-heading-icon">
                <FileText size={20} />
              </span>
              <div>
                <h2>{file?.name || (ko ? "파일 미리보기" : "File preview")}</h2>
                <p title={file?.path || target}>{file?.path || target}</p>
              </div>
              <button
                className="icon-button"
                title={ko ? "경로 복사" : "Copy path"}
                disabled={!file}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(file!.path)
                    .then(() => setCopied(true))
                }
              >
                <Copy size={15} />
                {copied && <span>✓</span>}
              </button>
              <button
                className="icon-button"
                aria-label={ko ? "파일 닫기" : "Close file"}
                onClick={() => setTarget("")}
              >
                <X size={18} />
              </button>
            </header>
            <div className="file-caption">
              {ko
                ? "읽기 전용 · 프로젝트 및 참고 폴더"
                : "Read only · Project and reference folders"}
              {file?.line && (
                <span>
                  {ko ? "이동한 줄" : "Line"} {file.line}
                </span>
              )}
            </div>
            {error ? (
              <div className="file-error">
                <AlertCircle size={24} />
                <h3>
                  {ko ? "파일을 열 수 없습니다" : "Could not open this file"}
                </h3>
                <p>{error}</p>
              </div>
            ) : !file ? (
              <div className="file-loading">
                {ko ? "파일을 여는 중…" : "Opening file…"}
              </div>
            ) : (
              <div className="file-source scrollable">
                {file.text.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      file.line === i + file.start_line
                        ? "highlighted-line"
                        : ""
                    }
                  >
                    <span className="line-number">{i + file.start_line}</span>
                    <code>{line || " "}</code>
                  </div>
                ))}
              </div>
            )}
            <footer>
              {file?.truncated
                ? ko
                  ? "미리보기는 512KB · 3,000줄까지 표시합니다."
                  : "Preview limited to 512 KB and 3,000 lines."
                : ko
                  ? "파일 링크를 눌러 내용과 줄 번호를 확인하세요."
                  : "File links open here with line numbers."}
            </footer>
          </section>
        </div>
      )}
    </FileLinkContext.Provider>
  );
}
