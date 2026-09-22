import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MotionConfig } from "motion/react";
import popupCss from "../../popup.css";
import { globalStyles, SHADOW_STYLES } from "../ui/page-styles";

export const popupTokens = popupCss.slice(0, popupCss.indexOf("@media"));
const frameCss =
  popupCss
    .replaceAll(":root", ":host")
    .replace(/\bbody\s*\{/g, ".popup-surface {") +
  "\n" +
  globalStyles() +
  "\n" +
  SHADOW_STYLES +
  `
:host { display:block; min-width:0; font:13px/1.5 'Segoe UI','Microsoft YaHei',sans-serif; }
.popup-surface { width:100%; padding:16px; background:var(--canvas); border-radius:12px; }
.popo-page-queue, .popo-page-queue[data-collapsed='true'], .popo-toast-viewport {position:relative;inset:auto;width:100%;max-height:none;z-index:0;}
.popo-page-queue-body{max-height:none;}
.popo-toast-viewport{margin-top:12px;}
.sample-page {padding:18px;background:#f7f9fc;color:#243448;border-radius:12px;min-width:0;}
.sample-toolbar .popo-page-download-controls{flex-wrap:wrap!important;min-width:0!important;max-width:100%;}
.sample-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-bottom:18px;border-bottom:1px solid #dce3ed;}
.sample-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;min-height:82px;border-bottom:1px solid #dce3ed;}
.sample-name{display:flex;gap:10px;align-items:center;min-width:0;flex:1;}
.sample-name span{overflow-wrap:anywhere;}
.sample-name svg{flex-shrink:0;color:#986e1c;}
.sample-title {margin:0 0 14px;font-size:13px;font-weight:600;}
.sample-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.sample-empty{padding:28px 12px;text-align:center;color:var(--muted);}
.sample-note{color:var(--muted);font-size:12px;line-height:1.6;margin:12px 0;}
.demo-fieldset{border:0;padding:0;margin:0;min-width:0;}
.sample-skeleton{background:#fff;border-radius:12px;overflow:hidden;}.sample-skeleton .popo-directory-transition-shell{padding:20px!important;}
.sample-error{color:var(--red-ink);font-size:12px;line-height:1.6;}
:focus-visible{outline:2px solid var(--blue);outline-offset:3px;}
@container (max-width:420px){.sample-row{grid-template-columns:1fr;align-items:start;padding:14px 0;gap:12px;}.sample-row .popo-stable-download-button{justify-self:end;}}
`;
export function Frame({
  children,
  narrow = false,
  reduced = false,
  label = "组件示例",
}: {
  children: ReactNode;
  narrow?: boolean;
  reduced?: boolean;
  label?: string;
}) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback((host: HTMLDivElement | null) => {
    if (host) setRoot(host.shadowRoot || host.attachShadow({ mode: "open" }));
  }, []);
  return (
    <div
      className={`design-frame${narrow ? " is-narrow" : ""}`}
      style={{ containerType: "inline-size" }}
      aria-label={label}
    >
      <div ref={attach} />
      {root &&
        createPortal(
          <MotionConfig reducedMotion={reduced ? "always" : "user"}>
            <style>
              {frameCss}
              {reduced
                ? "*{animation:none!important;transition:none!important;}"
                : ""}
            </style>
            {children}
          </MotionConfig>,
          root,
        )}
    </div>
  );
}
