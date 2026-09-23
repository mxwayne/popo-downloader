const ROOT_ID = "popo-react-page-root";
const GLOBAL_STYLE_ID = "popo-react-page-global-style";
const PROJECT_COUNT_ID = "popo-stable-project-count";
const DIRECTORY_TRANSITION_OVERLAY_ID = "popo-directory-transition-overlay";
const DIRECTORY_TRANSITION_ATTRIBUTE = "data-popo-directory-transition";
const DIRECTORY_POINTER_INTENT_ATTRIBUTE = "data-popo-directory-pointer-intent";
const DOWNLOAD_ANCHOR_CLASS = "popo-react-download-anchor";
const DOWNLOAD_BUTTON_CLASS = "popo-stable-download-button";
const DOWNLOAD_HOST_ATTRIBUTE = "data-popo-download-host";
export function globalStyles(): string {
  return [
    "html[" +
      DIRECTORY_TRANSITION_ATTRIBUTE +
      "='true'] [role='tooltip'],html[" +
      DIRECTORY_TRANSITION_ATTRIBUTE +
      "='true'] [class*='tooltip'],html[" +
      DIRECTORY_TRANSITION_ATTRIBUTE +
      "='true'] [class*='Tooltip']{visibility:hidden!important;opacity:0!important;pointer-events:none!important;}",
    "html[" +
      DIRECTORY_POINTER_INTENT_ATTRIBUTE +
      "='true'] ." +
      DOWNLOAD_ANCHOR_CLASS +
      ",html[" +
      DIRECTORY_POINTER_INTENT_ATTRIBUTE +
      "='true'] #" +
      PROJECT_COUNT_ID +
      ",html[" +
      DIRECTORY_TRANSITION_ATTRIBUTE +
      "='true'] ." +
      DOWNLOAD_ANCHOR_CLASS +
      ",html[" +
      DIRECTORY_TRANSITION_ATTRIBUTE +
      "='true'] #" +
      PROJECT_COUNT_ID +
      "{visibility:hidden!important;opacity:0!important;pointer-events:none!important;}",
    "#" +
      DIRECTORY_TRANSITION_OVERLAY_ID +
      "{all:initial!important;box-sizing:border-box!important;position:fixed!important;z-index:2147483000!important;inset:60px 0 0!important;display:block!important;overflow:hidden!important;color:#526173!important;background:rgba(255,255,255,.985)!important;cursor:progress!important;pointer-events:none!important;font-family:'Segoe UI','Microsoft YaHei',sans-serif!important;color-scheme:light!important;}",
    "#" +
      DIRECTORY_TRANSITION_OVERLAY_ID +
      "[data-block-interaction='true']{pointer-events:auto!important;}",
    "#" +
      DIRECTORY_TRANSITION_OVERLAY_ID +
      " *{box-sizing:border-box!important;}",
    ".popo-directory-transition-shell{width:100%!important;height:100%!important;padding:38px clamp(28px,6.6vw,92px)!important;}",
    ".popo-directory-transition-heading{display:flex!important;align-items:center!important;gap:12px!important;height:46px!important;}",
    ".popo-directory-transition-folder{position:relative!important;display:block!important;width:40px!important;height:29px!important;border-radius:4px!important;background:#ffd064!important;box-shadow:inset 0 0 0 1px rgba(184,125,0,.08)!important;}",
    ".popo-directory-transition-folder:before{content:''!important;position:absolute!important;top:-5px!important;left:3px!important;width:17px!important;height:8px!important;border-radius:4px 4px 0 0!important;background:#ffc64a!important;}",
    ".popo-directory-transition-label{display:block!important;color:#667487!important;font:600 15px/1.2 'Segoe UI','Microsoft YaHei',sans-serif!important;white-space:nowrap!important;}",
    ".popo-directory-transition-toolbar{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:10px!important;height:70px!important;border-bottom:1px solid #eef1f5!important;}",
    ".popo-directory-transition-control{display:block!important;width:92px!important;height:32px!important;border-radius:7px!important;background:#f1f4f7!important;}",
    ".popo-directory-transition-control:first-child{margin-right:auto!important;width:96px!important;}",
    ".popo-directory-transition-rows{display:grid!important;gap:0!important;}",
    ".popo-directory-transition-row{display:flex!important;align-items:center!important;gap:12px!important;height:48px!important;border-bottom:1px solid #f5f6f8!important;}",
    ".popo-directory-transition-row i:first-child{display:block!important;width:24px!important;height:18px!important;border-radius:4px!important;background:#f5cf72!important;}",
    ".popo-directory-transition-row i:last-child{display:block!important;width:min(34vw,330px)!important;height:11px!important;border-radius:999px!important;background:linear-gradient(90deg,#edf1f5 20%,#f7f9fb 45%,#edf1f5 70%)!important;background-size:220% 100%!important;animation:popo-directory-transition-shimmer 1.35s ease-in-out infinite!important;}",
    "@keyframes popo-directory-transition-shimmer{0%{background-position:130% 0}100%{background-position:-130% 0}}",
    "[" +
      DOWNLOAD_HOST_ATTRIBUTE +
      "]{box-sizing:border-box!important;position:relative!important;padding-right:244px!important;}",
    "." +
      DOWNLOAD_ANCHOR_CLASS +
      "{position:absolute!important;top:0!important;right:0!important;bottom:0!important;z-index:0!important;isolation:isolate!important;display:inline-flex!important;align-items:center!important;justify-content:flex-end!important;width:244px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "{--popo-gradient-surface:linear-gradient(145deg,#1d2a39 0%,#111923 100%);--popo-gradient-highlight:none;--popo-surface-border:#415267;--popo-surface-ink:#9ec9ff;box-sizing:border-box!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 30px!important;width:30px!important;height:30px!important;overflow:visible!important;margin:0 3px!important;padding:0!important;border:1px solid var(--popo-surface-border)!important;border-radius:8px!important;color:var(--popo-surface-ink)!important;background-color:#111923!important;background-image:var(--popo-gradient-highlight),var(--popo-gradient-surface)!important;background-size:220% 100%,100% 100%!important;background-position:-130% 0,0 0!important;background-repeat:no-repeat!important;font:600 11px/1 'Segoe UI','Microsoft YaHei',sans-serif!important;white-space:nowrap!important;cursor:pointer!important;box-shadow:0 7px 18px rgba(4,10,18,.22),inset 0 1px 0 rgba(255,255,255,.055)!important;color-scheme:dark;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-expanded='true']{justify-content:flex-start!important;overflow:hidden!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='queued']{flex-basis:124px!important;width:124px!important;height:32px!important;padding:0 8px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='preparing']{flex-basis:150px!important;width:150px!important;height:40px!important;padding:0 10px 8px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='scanning'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='downloading'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='paused']{flex-basis:232px!important;width:232px!important;height:48px!important;padding:0 10px 10px!important;border-radius:10px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='ready'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='success'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='empty']{flex-basis:166px!important;width:166px!important;height:40px!important;padding:0 10px 8px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='warning'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='failed']{flex-basis:196px!important;width:196px!important;height:40px!important;padding:0 10px 8px!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      ":hover{filter:brightness(1.08)!important;border-color:#5f88b8!important;box-shadow:0 9px 22px rgba(4,10,18,.3),0 0 0 1px rgba(103,170,255,.12)!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      ":disabled{cursor:wait!important;opacity:.82!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='preparing'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='scanning']{--popo-gradient-surface:linear-gradient(145deg,#17385a 0%,#12263b 52%,#101a27 100%);--popo-surface-border:#3e709e;--popo-surface-ink:#9ed1ff;cursor:progress!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='queued']{--popo-gradient-surface:linear-gradient(145deg,#263241 0%,#19222e 100%);--popo-surface-border:#4a596c;--popo-surface-ink:#b8c5d5;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='ready'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='success']{--popo-gradient-surface:linear-gradient(145deg,#173a34 0%,#10241f 100%);--popo-surface-border:#3e7566;--popo-surface-ink:#82ddc0;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='downloading']{--popo-gradient-surface:linear-gradient(145deg,#153c55 0%,#123843 52%,#10251f 100%);--popo-surface-border:#398493;--popo-surface-ink:#9ee6dd;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='paused']{--popo-gradient-surface:linear-gradient(145deg,#393633 0%,#252421 100%);--popo-surface-border:#625d55;--popo-surface-ink:#d3cbc0;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='empty'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='warning']{--popo-gradient-surface:linear-gradient(145deg,#403318 0%,#282114 100%);--popo-surface-border:#796238;--popo-surface-ink:#f1d17f;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='failed']{--popo-gradient-surface:linear-gradient(145deg,#46262c 0%,#29191e 100%);--popo-surface-border:#814c55;--popo-surface-ink:#ffadb7;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='scanning'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='downloading']{--popo-gradient-highlight:linear-gradient(105deg,transparent 28%,rgba(255,255,255,.035) 39%,rgba(142,208,255,.17) 48%,rgba(255,255,255,.05) 57%,transparent 69%);animation:popo-gradient-surface-flow 4.8s ease-in-out infinite!important;}",
    ".popo-download-idle-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:18px!important;height:18px!important;}",
    ".popo-download-idle-icon svg{display:block!important;width:18px!important;height:18px!important;}",
    ".popo-download-complete-marker{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 22px!important;width:22px!important;height:22px!important;margin:0 2px!important;border:1px solid #3e7566!important;border-radius:50%!important;color:#75dbb9!important;background:rgba(11,155,116,.14)!important;box-shadow:0 4px 12px rgba(4,46,35,.2),inset 0 1px 0 rgba(255,255,255,.08)!important;pointer-events:none!important;}",
    ".popo-download-complete-marker svg{display:block!important;width:14px!important;height:14px!important;}",
    ".popo-download-content{position:relative!important;z-index:5!important;display:flex!important;align-items:center!important;width:100%!important;min-width:0!important;gap:6px!important;overflow:hidden!important;}",
    ".popo-download-state-icon{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 20px!important;width:20px!important;height:22px!important;overflow:visible!important;}",
    ".popo-download-state-icon-motion{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:14px!important;height:14px!important;transform-origin:50% 50%!important;}",
    ".popo-download-state-icon-motion svg{display:block!important;width:14px!important;height:14px!important;overflow:visible!important;}",
    ".popo-download-injection-icon .popo-download-folder-glyph{position:absolute!important;z-index:2!important;right:1px!important;bottom:0!important;display:block!important;width:17px!important;height:17px!important;overflow:visible!important;}",
    ".popo-download-resource-block{position:absolute!important;z-index:1!important;top:0!important;left:7px!important;display:block!important;width:6px!important;height:6px!important;border:1px solid currentColor!important;border-radius:2px!important;background:#dff2ff!important;box-shadow:0 0 5px rgba(18,104,232,.42)!important;}",
    ".popo-download-primary{flex:none!important;font-weight:700!important;line-height:1!important;}",
    ".popo-download-secondary{min-width:0!important;margin-left:auto!important;overflow:hidden!important;color:currentColor!important;font-size:10px!important;font-weight:600!important;line-height:1!important;text-overflow:ellipsis!important;opacity:.82!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='queued'] .popo-download-secondary{flex:0 0 auto!important;min-width:max-content!important;overflow:visible!important;text-overflow:clip!important;opacity:.9!important;}",
    ".popo-download-work-beat{display:inline-flex!important;align-items:flex-end!important;gap:2px!important;flex:0 0 auto!important;height:12px!important;}",
    ".popo-download-work-beat i{display:block!important;width:2px!important;height:8px!important;border-radius:999px!important;background:currentColor!important;transform-origin:50% 100%!important;}",
    ".popo-download-work-beat i:first-child{height:4px!important;}.popo-download-work-beat i:last-child{height:6px!important;}",
    ".popo-download-rail{position:absolute!important;right:10px!important;bottom:5px!important;left:10px!important;height:8px!important;overflow:hidden!important;border-radius:999px!important;background:rgba(70,100,138,.16)!important;box-shadow:inset 0 0 0 1px rgba(70,100,138,.08)!important;}",
    ".popo-download-fill,.popo-download-estimate-fill{position:absolute!important;z-index:2!important;inset:0 auto 0 0!important;display:block!important;height:100%!important;overflow:hidden!important;border-radius:inherit!important;background:linear-gradient(90deg,#1268e8,#13a17a)!important;}",
    ".popo-download-estimate-fill{z-index:1!important;background:linear-gradient(90deg,rgba(18,104,232,.5),rgba(19,161,122,.62))!important;}",
    ".popo-download-wave{position:absolute!important;z-index:3!important;inset:0 auto 0 0!important;display:block!important;width:36%!important;height:100%!important;border-radius:inherit!important;background:linear-gradient(90deg,transparent,rgba(55,190,255,.72) 24%,#1268e8 52%,rgba(30,195,166,.8) 76%,transparent)!important;box-shadow:0 0 7px rgba(18,104,232,.48)!important;}",
    ".popo-download-activity-comet{position:absolute!important;z-index:3!important;top:0!important;bottom:0!important;width:30%!important;border-radius:inherit!important;background:linear-gradient(90deg,transparent,rgba(121,190,255,.82),rgba(255,255,255,.95),transparent)!important;}",
    ".popo-download-activity-packet{position:absolute!important;z-index:4!important;top:1px!important;display:block!important;width:6px!important;height:6px!important;border-radius:50%!important;background:#dff2ff!important;box-shadow:0 0 7px rgba(120,192,255,.9)!important;}",
    ".popo-download-activity-packet:nth-of-type(2){top:2px!important;width:4px!important;height:4px!important;}.popo-download-activity-packet:nth-of-type(3){top:1.5px!important;width:5px!important;height:5px!important;}",
    ".popo-download-warning-segment{position:absolute!important;right:0!important;bottom:0!important;width:13px!important;height:100%!important;border-radius:999px!important;background:#e6a700!important;box-shadow:-3px 0 5px rgba(230,167,0,.25)!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='success'] .popo-download-fill,." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='ready'] .popo-download-fill{background:#0b9b74!important;}",
    "." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='failed'] .popo-download-fill{background:#d64550!important;}",
    "@keyframes popo-gradient-surface-flow{0%,100%{background-position:-130% 0,0 0;box-shadow:0 7px 18px rgba(4,10,18,.22),inset 0 1px 0 rgba(255,255,255,.055)}50%{background-position:130% 0,0 0;box-shadow:0 10px 25px rgba(16,82,126,.3),inset 0 1px 0 rgba(255,255,255,.075)}}",
    "@media(prefers-reduced-motion:reduce){." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='scanning'],." +
      DOWNLOAD_BUTTON_CLASS +
      "[data-state='downloading']{animation:none!important;background-position:50% 0,0 0!important;}.popo-download-fill,.popo-download-estimate-fill,.popo-directory-transition-row i:last-child{transition:none!important;animation:none!important;}}",
    "#" + PROJECT_COUNT_ID + "{display:contents!important;}",
    ".popo-react-project-count{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:72px;height:32px;margin-left:10px;margin-right:auto;padding:0 10px;border:1px solid #526f8f;border-radius:7px;color:#eef6ff;background-color:#132235;background-image:radial-gradient(circle at 18% 0%,rgba(111,186,255,.26),transparent 58%),linear-gradient(135deg,#2c4968 0%,#19334d 52%,#0f1a26 100%);background-size:100% 100%;box-shadow:0 6px 16px rgba(4,10,18,.22),inset 0 1px 0 rgba(255,255,255,.09);font:600 13px/1 'Segoe UI','Microsoft YaHei',sans-serif;white-space:nowrap;color-scheme:dark;}",
    ".popo-react-project-count[data-state='loading']{color:#91a0b2;}",
    ".popo-page-download-controls{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;margin:0 8px;color-scheme:dark;}",
    ".popo-page-download-all{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;min-width:96px;height:32px;margin:0;padding:0 12px;border:1px solid #3f719d;border-radius:7px;color:#eaf5ff;background-color:#12314c;background-image:linear-gradient(145deg,#1d5275 0%,#173b58 55%,#10283d 100%);box-shadow:0 6px 16px rgba(4,10,18,.22),inset 0 1px 0 rgba(255,255,255,.09);font:600 13px/1 'Segoe UI','Microsoft YaHei',sans-serif;white-space:nowrap;cursor:pointer;color-scheme:dark;}",
    ".popo-page-download-all svg{width:15px;height:15px;stroke:currentColor;}",
    ".popo-page-download-all:hover{filter:brightness(1.08);border-color:#61a2d7;}",
    ".popo-page-download-all:disabled{cursor:wait;opacity:.62;}",
    ".popo-page-download-all[data-state='queued'],.popo-page-download-all[data-state='preparing'],.popo-page-download-all[data-state='scanning'],.popo-page-download-all[data-state='downloading']{border-color:#3e8ba0;background-image:linear-gradient(145deg,#18506a 0%,#133d4b 55%,#102c30 100%);}",
    ".popo-page-download-all[data-state='success']{border-color:#3e7566;color:#9ce5cf;background-image:linear-gradient(145deg,#173a34 0%,#10241f 100%);}",
    ".popo-page-download-all[data-state='failed'],.popo-page-download-all[data-state='warning']{border-color:#84515a;color:#ffc1c7;background-image:linear-gradient(145deg,#46262c 0%,#29191e 100%);}",
    ".popo-page-batch-action{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 10px;border:1px solid #536579;border-radius:7px;color:#dce8f5;background:linear-gradient(145deg,#263342,#19232f);box-shadow:0 6px 16px rgba(4,10,18,.2),inset 0 1px 0 rgba(255,255,255,.06);font:600 12px/1 'Segoe UI','Microsoft YaHei',sans-serif;white-space:nowrap;cursor:pointer;color-scheme:dark;}",
    ".popo-page-batch-action svg{width:14px;height:14px;stroke:currentColor;}.popo-page-batch-action:hover{filter:brightness(1.1);}.popo-page-batch-action:disabled{cursor:wait;opacity:.62;}",
    ".popo-page-batch-action[data-kind='danger']{border-color:#87505b;color:#ffc1c7;background:linear-gradient(145deg,#46262c,#29191e);}",
    "@media(prefers-color-scheme:dark){.popo-react-project-count,.popo-page-download-all{box-shadow:0 6px 16px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05);}}",
    ":is(html,body).dark .popo-react-project-count,:is(html,body)[data-theme='dark'] .popo-react-project-count,:is(html,body)[data-color-mode='dark'] .popo-react-project-count{color:#eef6ff;border-color:#526f8f;}",
  ].join("\n");
}

export const SHADOW_STYLES = [
  ":host{all:initial;color-scheme:dark;--popo-gradient-surface:linear-gradient(145deg,#1b2735 0%,#111923 100%);--popo-gradient-blue:linear-gradient(145deg,#17385a 0%,#12263b 56%,#101a27 100%);--popo-gradient-download:linear-gradient(145deg,#153c55 0%,#123843 54%,#10251f 100%);--popo-gradient-queued:linear-gradient(145deg,#263241 0%,#19222e 100%);--popo-gradient-paused:linear-gradient(145deg,#393633 0%,#252421 100%);--popo-gradient-warning:linear-gradient(145deg,#403318 0%,#282114 100%);--popo-gradient-failed:linear-gradient(145deg,#46262c 0%,#29191e 100%);--popo-gradient-success:linear-gradient(145deg,#173a34 0%,#10241f 100%);--popo-gradient-highlight:linear-gradient(105deg,transparent 29%,rgba(255,255,255,.03) 40%,rgba(140,207,255,.14) 49%,rgba(255,255,255,.045) 58%,transparent 70%);--popo-ink:#edf3fb;--popo-muted:#a5b2c2;--popo-line:#3b4a5d;--popo-control:linear-gradient(145deg,#263342,#19232f);}",
  "*{box-sizing:border-box;}",
  "button{font:600 11px/1 'Segoe UI','Microsoft YaHei',sans-serif;}",
  ".popo-page-queue{--popo-current-surface:var(--popo-gradient-surface);position:fixed;left:20px;bottom:20px;z-index:2147483645;width:min(380px,calc(100vw - 40px));max-height:min(62vh,560px);overflow:hidden;border:1px solid var(--popo-line);border-radius:12px;color:var(--popo-ink);background-color:#111923;background-image:var(--popo-current-surface);background-repeat:no-repeat;box-shadow:0 16px 42px rgba(2,7,13,.42),inset 0 1px 0 rgba(255,255,255,.05);font-family:'Segoe UI','Microsoft YaHei',sans-serif;}",
  ".popo-page-queue[data-status='queued'],.popo-page-queue[data-status='waiting_worker']{--popo-current-surface:var(--popo-gradient-queued);}",
  ".popo-page-queue[data-status='scanning'],.popo-page-queue[data-status='scan_complete'],.popo-page-queue[data-status='awaiting_confirmation'],.popo-page-queue[data-status='starting']{--popo-current-surface:var(--popo-gradient-blue);}",
  ".popo-page-queue[data-status='downloading']{--popo-current-surface:var(--popo-gradient-download);}",
  ".popo-page-queue[data-status='paused'],.popo-page-queue[data-status='draining'],.popo-page-queue[data-status='draining_paused'],.popo-page-queue[data-status='cancelled']{--popo-current-surface:var(--popo-gradient-paused);}",
  ".popo-page-queue[data-status='complete']{--popo-current-surface:var(--popo-gradient-success);}",
  ".popo-page-queue[data-status='failed']{--popo-current-surface:var(--popo-gradient-failed);}",
  ".popo-page-queue[data-status='scanning'],.popo-page-queue[data-status='downloading']{background-image:var(--popo-gradient-highlight),var(--popo-current-surface);background-size:220% 100%,100% 100%;animation:popo-shadow-surface-flow 5.2s ease-in-out infinite;}",
  ".popo-page-queue[data-collapsed='true']{width:min(330px,calc(100vw - 40px));}",
  ".popo-page-queue-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));}",
  ".popo-page-queue[data-collapsed='false'] .popo-page-queue-header{border-bottom:1px solid rgba(151,174,201,.16);}",
  ".popo-page-queue-heading{min-width:0;overflow:hidden;color:var(--popo-ink);font-size:13px;font-weight:700;text-overflow:ellipsis;white-space:nowrap;}",
  ".popo-page-queue-summary{color:var(--popo-muted);font-size:11px;font-weight:500;}",
  ".popo-page-queue-toggle,.popo-page-action,.popo-toast-action{min-width:0;height:27px;padding:0 9px;border:1px solid #46566a;border-radius:7px;color:#a8cdff;background-color:#1a2430;background-image:var(--popo-control);box-shadow:inset 0 1px 0 rgba(255,255,255,.045);cursor:pointer;}",
  ".popo-page-queue-toggle:disabled,.popo-page-action:disabled,.popo-toast-action:disabled{cursor:wait;opacity:.6;}",
  ".popo-page-queue-body{max-height:min(52vh,470px);overflow:auto;padding:11px 13px 13px;}",
  ".popo-page-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}",
  ".popo-page-job-name{overflow:hidden;color:var(--popo-ink);font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap;}",
  ".popo-page-job-state{flex:none;color:#8bc4ff;font-size:11px;font-weight:650;}",
  ".popo-page-queue[data-status='queued'] .popo-page-job-state,.popo-page-queue[data-status='waiting_worker'] .popo-page-job-state{color:#bac6d5;}",
  ".popo-page-queue[data-status='paused'] .popo-page-job-state,.popo-page-queue[data-status='draining'] .popo-page-job-state,.popo-page-queue[data-status='draining_paused'] .popo-page-job-state,.popo-page-queue[data-status='cancelled'] .popo-page-job-state{color:#d5cdc2;}",
  ".popo-page-queue[data-status='complete'] .popo-page-job-state{color:#82ddc0;}",
  ".popo-page-queue[data-status='failed'] .popo-page-job-state{color:#ffadb7;}",
  ".popo-page-job-detail{margin-top:5px;color:var(--popo-muted);font-size:11px;line-height:1.45;}",
  ".popo-network-notice{margin-top:9px;padding:9px;border:1px solid #756039;border-radius:8px;color:#f1d17f;background:var(--popo-gradient-warning);font-size:11px;line-height:1.45;}",
  ".popo-network-notice strong{display:block;margin-bottom:3px;color:#ffe2a0;font-size:11px;}",
  ".popo-network-notice .popo-page-actions{margin-top:7px;}",
  ".popo-page-queue-more{margin-top:7px;color:var(--popo-muted);font-size:11px;line-height:1.45;}",
  ".popo-page-progress{overflow:hidden;height:7px;margin-top:8px;border-radius:999px;background:rgba(7,14,23,.44);box-shadow:inset 0 0 0 1px rgba(148,178,210,.1);}",
  ".popo-page-progress i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#1268e8,#0aa17a);transition:width .2s ease;}",
  ".popo-page-progress[data-indeterminate='true'] i{width:38%;animation:popo-react-progress 1.2s ease-in-out infinite alternate;}",
  "@keyframes popo-react-progress{from{transform:translateX(-25%)}to{transform:translateX(190%)}}",
  ".popo-page-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin-top:9px;}",
  ".popo-page-action[data-kind='danger']{color:#ffafb7;border-color:#774750;background-image:var(--popo-gradient-failed);}",
  ".popo-page-confirm{margin-top:9px;padding:8px;border:1px solid #58534d;border-radius:8px;background-image:var(--popo-gradient-paused);}",
  ".popo-page-confirm p{margin:0;color:#c7c0b7;font-size:11px;line-height:1.5;}",
  ".popo-toast-viewport{position:fixed;right:24px;bottom:24px;z-index:2147483646;display:grid;width:min(340px,calc(100vw - 48px));gap:8px;font-family:'Segoe UI','Microsoft YaHei',sans-serif;}",
  ".popo-toast{padding:13px 15px;border:1px solid #3f6f62;border-radius:11px;color:var(--popo-ink);background-color:#10241f;background-image:var(--popo-gradient-success);box-shadow:0 14px 38px rgba(2,7,13,.4),inset 0 1px 0 rgba(255,255,255,.05);}",
  ".popo-toast[data-kind='error']{border-color:#7d4a53;background-color:#29191e;background-image:var(--popo-gradient-failed);}",
  ".popo-toast strong{display:block;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap;}",
  ".popo-toast[data-kind='warning']{border-color:#756039;background-image:var(--popo-gradient-warning);}",
  ".popo-toast[data-kind='warning'] strong{color:#ffe2a0;}",
  ".popo-toast p{margin:4px 0 0;color:var(--popo-muted);font-size:12px;line-height:1.45;}",
  ".popo-toast-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px;}",
  ".popo-toast-action[data-kind='quiet']{color:#aab6c6;border-color:#465365;}",
  "@keyframes popo-shadow-surface-flow{0%,100%{background-position:-130% 0,0 0}50%{background-position:130% 0,0 0}}",
  "@media(prefers-reduced-motion:reduce){.popo-page-queue[data-status='scanning'],.popo-page-queue[data-status='downloading']{animation:none;background-position:50% 0,0 0}.popo-page-progress[data-indeterminate='true'] i{animation:none;transform:translateX(80%)}.popo-page-progress i{transition:none}}",
  "@media(prefers-color-scheme:dark){:host{color-scheme:dark}.popo-page-queue,.popo-toast{box-shadow:0 16px 44px rgba(0,0,0,.46),inset 0 1px 0 rgba(255,255,255,.05)}}",
  "@media(max-width:620px){.popo-page-queue{left:12px;bottom:12px;width:calc(100vw - 24px)}.popo-toast-viewport{right:12px;bottom:12px;width:calc(100vw - 24px)}}",
].join("\n");
