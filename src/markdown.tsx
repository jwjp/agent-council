import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight } from "lucide-react";
import { linkKind } from "./links";

export const MarkdownContent = memo(function MarkdownContent({
  text,
  onFile,
  onWeb,
}: {
  text: string;
  onFile: (href: string) => void;
  onWeb: (href: string) => void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) =>
          key === "href" && linkKind(url) !== "blocked" ? url : ""
        }
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  if (linkKind(href) === "file") onFile(href);
                  else if (linkKind(href) === "web") onWeb(href);
                }
              }}
            >
              {children}
              <ArrowUpRight size={11} />
            </a>
          ),
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
