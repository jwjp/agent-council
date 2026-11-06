import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Smartphone,
  Link2,
  Copy,
  Check,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import { api } from "./api";

interface Status {
  config: { enabled: boolean; origin: string; port: number };
  ready: boolean;
  error: string;
  pending: {
    id: string;
    name: string | null;
    expires: number;
    approved: boolean;
    folder: string;
    allow_work: boolean;
  }[];
  devices: {
    id: string;
    name: string;
    folder: string;
    allow_work: boolean;
    expires: number;
  }[];
}
export function CompanionSettings({
  t,
}: {
  t: (en: string, ko: string) => string;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [origin, setOrigin] = useState(""),
    [port, setPort] = useState(43128);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [work, setWork] = useState(true);
  const [invitation, setInvitation] = useState<{
      id: string;
      url: string;
      expires: number;
    } | null>(null),
    [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    let initial = true;
    const refresh = () =>
      void api<Status>("/companion")
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          if (initial) {
            setOrigin(s.config.origin);
            setPort(s.config.port);
            initial = false;
          }
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setStatus(await api<Status>("/companion"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  let httpsPort = "8443";
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") httpsPort = url.port || "443";
  } catch {}
  const command = `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        t(
          "Select and copy the text below.",
          "아래 텍스트를 선택해서 복사해 주세요.",
        ),
      );
    }
  };
  const validInvite =
    invitation &&
    invitation.expires * 1000 > Date.now() &&
    status?.pending.some((p) => p.id === invitation.id);
  return (
    <section className="phone-settings">
      <div className="phone-intro">
        <span className="phone-icon">
          <Smartphone size={23} />
        </span>
        <div>
          <strong>
            {t("Your workspace, wherever you are", "어디서든 이어지는 작업")}
          </strong>
          <p>
            {t(
              "Use your phone to follow progress and continue the conversation.",
              "휴대폰에서 진행 상황을 확인하고 대화를 이어가세요.",
            )}
          </p>
        </div>
      </div>
      {error && (
        <p className="phone-error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p>{t("Checking host…", "호스트를 확인하는 중…")}</p>
      ) : (
        <>
          <div className="phone-setup">
            <label>
              {t("Tailscale HTTPS address", "Tailscale HTTPS 주소")}
              <input
                aria-label="Companion HTTPS address"
                type="url"
                value={origin}
                placeholder="https://your-pc.your-tailnet.ts.net:8443"
                onChange={(e) => setOrigin(e.target.value)}
              />
            </label>
            <div className="phone-setup-row">
              <label>
                {t("Local port", "로컬 포트")}
                <input
                  aria-label="Companion local port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
              <button
                className="primary-button"
                disabled={busy || !origin}
                onClick={() =>
                  void action(async () => {
                    await api(
                      "/companion",
                      { enabled: true, origin, port },
                      "PUT",
                    );
                    setInvitation(null);
                  })
                }
              >
                <Link2 size={14} />
                {status.config.enabled
                  ? t("Save connection", "연결 설정 저장")
                  : t("Start gateway", "게이트웨이 시작")}
              </button>
            </div>
            <p className="phone-hint">
              {t(
                "Install Tailscale on both devices. Run this on the host, paste the printed HTTPS address above, then start the gateway. Choose an unused HTTPS port for existing services.",
                "두 기기에 Tailscale을 설치하세요. PC에서 아래 명령을 실행하고, 출력된 HTTPS 주소를 위에 넣은 뒤 게이트웨이를 시작하세요. 기존 서비스와 겹치지 않는 HTTPS 포트를 사용합니다.",
              )}
            </p>
            <div className="phone-command">
              <code>{command}</code>
              <button
                className="icon-button"
                aria-label="Copy Tailscale command"
                onClick={() => void copy(command)}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <div className="phone-readiness">
              <span className={status.ready ? "ready-dot" : "idle-dot"} />
              {status.error ||
                (status.ready
                  ? t(
                      "Local gateway ready · Tailscale connection required",
                      "로컬 게이트웨이 준비됨 · Tailscale 연결 필요",
                    )
                  : t("Gateway is off", "게이트웨이가 꺼져 있어요"))}
              {status.config.enabled && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api(
                        "/companion",
                        { ...status.config, enabled: false },
                        "PUT",
                      );
                      setInvitation(null);
                    })
                  }
                >
                  {t("Turn off", "끄기")}
                </button>
              )}
            </div>
          </div>
          {status.ready && (
            <div className="phone-pair-section">
              <div className="phone-section-title">
                <strong>{t("Pair a device", "기기 연결")}</strong>
                <span>{t("Current project & team", "현재 프로젝트와 팀")}</span>
              </div>
              <div
                className="phone-access"
                role="group"
                aria-label="Device access"
              >
                <button
                  className={!work ? "chosen" : ""}
                  onClick={() => setWork(false)}
                >
                  {t("View progress", "진행 상황 보기")}
                </button>
                <button
                  className={work ? "chosen" : ""}
                  onClick={() => setWork(true)}
                >
                  {t("Send requests", "작업 요청하기")}
                </button>
              </div>
              <p className="phone-hint">
                {t(
                  "This device can read the approved project and reference folders. Requests run the selected agents with the host's permissions. Full access can affect files beyond this project.",
                  "기기는 승인한 프로젝트와 참고 폴더를 읽을 수 있습니다. 작업 요청 시 선택한 AI가 PC의 실행 권한으로 동작하며, 전체 권한에서는 프로젝트 밖 파일에도 접근할 수 있습니다.",
                )}
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const invite = await api<{
                      id: string;
                      url: string;
                      expires: number;
                    }>("/companion/invitations", { allow_work: work });
                    setInvitation(invite);
                    setQr(
                      await QRCode.toDataURL(invite.url, {
                        width: 220,
                        margin: 2,
                        errorCorrectionLevel: "M",
                      }),
                    );
                  })
                }
              >
                <Smartphone size={15} />
                {t("Create pairing QR", "연결 QR 만들기")}
              </button>
              {validInvite && (
                <div className="phone-qr">
                  <img
                    src={qr}
                    width={200}
                    height={200}
                    alt={t(
                      "Scan to request pairing",
                      "스캔해서 기기 연결 요청",
                    )}
                  />
                  <div>
                    <strong>
                      {t(
                        "Scan, then approve here",
                        "스캔한 뒤 이곳에서 승인하세요",
                      )}
                    </strong>
                    <p>
                      {t(
                        "Single use · expires in five minutes",
                        "한 번만 사용 · 5분 후 만료",
                      )}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => void copy(invitation!.url)}
                    >
                      <Copy size={13} />
                      {t("Copy pairing link", "연결 링크 복사")}
                    </button>
                  </div>
                </div>
              )}
              {status.pending.map((p) => (
                <div className="phone-device" key={p.id}>
                  <span className="phone-icon small">
                    <Smartphone size={18} />
                  </span>
                  <div>
                    <strong>
                      {p.name ||
                        t("Waiting for a scan…", "스캔을 기다리고 있어요…")}
                    </strong>
                    <small>
                      {p.folder} ·{" "}
                      {p.allow_work
                        ? t("Requests allowed", "작업 요청 허용")
                        : t("View only", "보기 전용")}
                    </small>
                  </div>
                  {p.name && (
                    <button
                      className="primary-button"
                      disabled={busy || p.approved}
                      onClick={() =>
                        void action(() =>
                          api(`/companion/invitations/${p.id}/approve`, {}),
                        )
                      }
                    >
                      {p.approved
                        ? t("Approved", "승인됨")
                        : t("Approve", "승인")}
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label="Reject pairing"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        api(
                          `/companion/invitations/${p.id}`,
                          undefined,
                          "DELETE",
                        ),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="phone-section-title">
            <strong>{t("Paired devices", "연결된 기기")}</strong>
            <ShieldCheck size={15} />
          </div>
          {status.devices.length === 0 ? (
            <p className="phone-hint">
              {t("No devices paired yet.", "아직 연결된 기기가 없습니다.")}
            </p>
          ) : (
            status.devices.map((d) => (
              <div className="phone-device" key={d.id}>
                <span className="phone-icon small">
                  <Smartphone size={18} />
                </span>
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {d.folder} ·{" "}
                    {d.allow_work
                      ? t("Can send requests", "작업 요청 가능")
                      : t("View only", "보기 전용")}
                  </small>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      api(`/companion/devices/${d.id}`, undefined, "DELETE"),
                    )
                  }
                >
                  <Unplug size={13} />
                  {t("Disconnect", "연결 해제")}
                </button>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}
