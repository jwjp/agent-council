import { useEffect, type RefObject } from "react";

// Only follow unzoomed visual bounds. Pinch zoom must remain a browser operation.
function trackPhoneViewport(root: HTMLElement): () => void {
  const viewport = window.visualViewport;
  let frame = 0;
  const update = () => {
    frame = 0;
    if (viewport && Math.abs(viewport.scale - 1) > 0.03) return;
    const height = viewport?.height ?? window.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const top = viewport?.offsetTop ?? 0;
    root.style.setProperty("--phone-height", `${Math.round(height)}px`);
    root.style.setProperty(
      "--phone-top",
      `${Number.isFinite(top) ? Math.max(0, Math.round(top)) : 0}px`,
    );
    const active = document.activeElement;
    const editing =
      active instanceof HTMLElement &&
      root.contains(active) &&
      active.matches("input,textarea,[contenteditable=true]");
    root.classList.toggle("phone-keyboard", !!editing && height < 540);
    root.classList.toggle("phone-keyboard-tight", !!editing && height < 300);
    root.classList.toggle("phone-short", height < 540);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  document.addEventListener("visibilitychange", schedule);
  update();
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    document.removeEventListener("visibilitychange", schedule);
    root.style.removeProperty("--phone-height");
    root.style.removeProperty("--phone-top");
    root.classList.remove(
      "phone-keyboard",
      "phone-keyboard-tight",
      "phone-short",
    );
  };
}

export function usePhoneViewport(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (root.current) return trackPhoneViewport(root.current);
  }, [root]);
}
