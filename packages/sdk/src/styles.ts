/**
 * Minimal styling with the Curtain tokens (handoff §7): coral #FF5A3C, cream #F5EFE7, ink #1A1612.
 * The button inherits the merchant's font; the modal uses the system UI stack. No font requests.
 */
export const STYLE_ID = 'curtain-sdk-style';

export const CSS = `
.pk-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:.5em;padding:.75em 1.4em;border:0;border-radius:999px;background:#FF5A3C;color:#F5EFE7;font:inherit;font-weight:600;line-height:1.2;cursor:pointer;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}
.pk-btn:hover{box-shadow:0 4px 14px rgba(255,90,60,.35);transform:translateY(-1px)}
.pk-btn:focus-visible{outline:3px solid #1A1612;outline-offset:2px}
.pk-btn[data-curtain-state=loading]{opacity:.7;cursor:progress}
.pk-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1A1612;line-height:1.4}
.pk-overlay{position:absolute;inset:0;background:rgba(26,22,18,.55);animation:pk-fade .2s ease}
.pk-dialog{position:relative;background:#F5EFE7;border-radius:20px;padding:28px 28px 20px;max-width:360px;width:100%;box-sizing:border-box;box-shadow:0 20px 60px rgba(26,22,18,.3);animation:pk-pop .25s cubic-bezier(.2,.8,.2,1);text-align:center;outline:0}
.pk-dialog:focus-visible{outline:3px solid #FF5A3C;outline-offset:2px}
.pk-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:#1A1612;font:inherit;font-size:22px;line-height:1;cursor:pointer}
.pk-close:hover{background:rgba(26,22,18,.08)}
.pk-close:focus-visible{outline:3px solid #FF5A3C;outline-offset:1px}
.pk-title{margin:0 0 16px;font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:600;line-height:1.2}
.pk-qr{width:220px;max-width:70vw;margin:0 auto 16px;padding:10px;background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(26,22,18,.08)}
.pk-qr img{display:block;width:100%;height:auto;image-rendering:pixelated}
.pk-desc{margin:0 0 10px;font-size:15px}
.pk-note{margin:0 0 10px;font-size:13px;color:#FF5A3C}
.pk-meta{margin:0 0 14px;font-size:13px;opacity:.8}
.pk-meta a{color:#1A1612;text-decoration:underline}
.pk-meta a:focus-visible{outline:3px solid #FF5A3C;outline-offset:2px}
.pk-disclaimer{margin:0;padding-top:12px;border-top:1px solid rgba(26,22,18,.12);font-size:12px;opacity:.75}
.pk-full{display:flex;flex-direction:column;max-width:1040px;height:100%;padding:0;text-align:left;overflow:hidden}
.pk-full .pk-title{margin:0;padding:16px 56px 14px 20px;font-size:18px}
.pk-app{position:absolute;top:19px;right:56px;font-size:13px;color:#1A1612}
.pk-load{position:absolute;top:50%;left:0;right:0;margin:0;text-align:center;font-size:15px}
.pk-frame{flex:1;width:100%;border:0;background:#fff}
.pk-sentinel{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;padding:10px 18px;border-radius:999px;background:#1A1612;color:#F5EFE7;font:600 15px/1.3 Inter,system-ui,sans-serif;box-shadow:0 6px 24px rgba(26,22,18,.3);animation:pk-fade .2s ease}
@media (max-width:767px){.pk-fs{padding:0}.pk-full{border-radius:0;box-shadow:none}.pk-app{position:static;padding:0 20px 10px}}
@keyframes pk-fade{from{opacity:0}}
@keyframes pk-pop{from{opacity:0;transform:translateY(12px) scale(.98)}}
@media (prefers-reduced-motion:reduce){.pk-overlay,.pk-dialog,.pk-toast{animation:none}.pk-btn{transition:none}.pk-btn:hover{transform:none}}
`;

/** Inject the stylesheet once. Safe to call repeatedly. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}
