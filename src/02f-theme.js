/*
File: src/02f-theme.js
Created At: 2026-09-08 16:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — CSS cua panel Log Lens
//
// Ve do uu tien (specificity): trang admin dung antd nen phai reset, nhung reset KHONG duoc manh hon
// cac rule .fll-* cua minh. Vi vay reset dung ":where(#fll-root) <tag>" = (0,0,1): du de thang rule
// element cua trang, nhung van thua moi rule class (0,1,0) ben duoi. Neu viet "#fll-root *" (1,0,1)
// thi padding:0 se de chet toan bo padding cua cac the -> giao dien dinh sat mep.

const PANEL_CSS = [
  ':where(#fll-root) *,:where(#fll-root) *::before,:where(#fll-root) *::after{box-sizing:border-box}',
  ':where(#fll-root) div,:where(#fll-root) span,:where(#fll-root) header,:where(#fll-root) footer,',
  ':where(#fll-root) nav,:where(#fll-root) button,:where(#fll-root) input,:where(#fll-root) i,',
  ':where(#fll-root) u,:where(#fll-root) b,:where(#fll-root) em{margin:0;padding:0;border:0;',
  'background:none;color:inherit;font:inherit;line-height:1.45;letter-spacing:normal;text-transform:none;',
  'text-align:left;vertical-align:baseline;box-shadow:none;text-shadow:none;min-width:0;height:auto}',
  '#fll-root button,#fll-root input{outline:0;-webkit-appearance:none;appearance:none}',

  '#fll-root{position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:400;',
  '--bg:#16141d;--bg2:#1e1b27;--bg3:#2a2436;--line:rgba(255,255,255,.09);--txt:#ece9f5;--mut:#9b93ad;',
  '--acc:#ff2e88;--err:#ff5f6d;--warn:#ffb648;--info:#58c4ff;--dbg:#7d8590;--ok:#3ddc97;',
  '--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;',
  /* Padding cua .fll-body: .fll-sec phai biet dung hai so nay de dinh sat mep va tran het be ngang.
     Moi cho dung deu kem gia tri du phong: bien khai o #fll-root, neu panel bi dung ngoai root do
     thi var() khong giai duoc va CA declaration hong — padding se sap ve 0 chu khong quay ve mac dinh. */
  '--pad-y:14px;--pad-x:16px}',

  /* ---------- khung panel ---------- */
  /* Kich thuoc bi chan bang JS (clampValue) chu khong bang max-width, de keo goc khong bi ket o 880px. */
  '.fll-panel{position:fixed;top:14px;right:14px;bottom:14px;width:480px;min-width:360px;max-width:none;',
  'display:flex;flex-direction:column;background:var(--bg);color:var(--txt);border:1px solid var(--line);',
  'border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);overflow:hidden;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-in{from{opacity:0;transform:translateX(16px) scale(.99)}to{opacity:1;transform:none}}',

  /* ---------- hai tay nam thay doi kich thuoc ---------- */
  /* Trong luc keo: bo bong mo ban kinh 70px (thu tot nhat de ve lai moi khung hinh),
     bao truoc cho trinh duyet chuan bi lop rieng, va tat hover ben trong cho khoi tinh vo ich. */
  '.fll-panel.fll-dragging{box-shadow:0 6px 20px rgba(0,0,0,.45);will-change:transform}',
  '.fll-panel.fll-dragging .fll-body,.fll-panel.fll-dragging .fll-map{pointer-events:none}',
  '.fll-grip{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:5}',
  '.fll-grip:hover{background:linear-gradient(90deg,rgba(255,46,136,.55),transparent)}',
  '.fll-corner{position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;z-index:6}',
  '.fll-corner:before{content:"";position:absolute;right:7px;bottom:7px;width:11px;height:11px;opacity:.5;',
  'transition:.14s;background:linear-gradient(135deg,transparent 0 44%,var(--mut) 44% 57%,',
  'transparent 57% 71%,var(--mut) 71% 84%,transparent 84%)}',
  '.fll-corner:hover:before{opacity:1;background:linear-gradient(135deg,transparent 0 44%,var(--acc) 44% 57%,',
  'transparent 57% 71%,var(--acc) 71% 84%,transparent 84%)}',

  /* ---------- header ---------- */
  '.fll-hd{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:grab;user-select:none;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);flex:0 0 auto}',
  '.fll-hd:active{cursor:grabbing}',
  '.fll-dot{width:9px;height:9px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc);',
  'flex:0 0 auto}',
  '.fll-tt{font-size:13.5px;font-weight:650;letter-spacing:.2px}',
  '.fll-sub{font-size:11px;color:var(--mut);margin-top:2px}',
  '.fll-hd-sp{flex:1}',
  '.fll-ico{width:28px;height:28px;border:1px solid transparent;border-radius:8px;color:var(--mut);',
  'cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:.14s;',
  'flex:0 0 auto}',
  '.fll-ico:hover{background:var(--bg3);color:var(--txt);border-color:var(--line)}',

  /* ---------- tabs ---------- */
  '.fll-tabs{display:flex;gap:3px;padding:10px 12px 0;flex:0 0 auto;overflow-x:auto;scrollbar-width:none}',
  '.fll-tabs::-webkit-scrollbar{display:none}',
  '.fll-tab{flex:1 0 auto;padding:8px 7px 10px;border-bottom:2px solid transparent;color:var(--mut);font-size:11px;',
  'font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;',
  'transition:.14s;white-space:nowrap}',
  '.fll-tab:hover{color:var(--txt)}',
  '.fll-tab.on{color:var(--txt);border-bottom-color:var(--acc)}',
  '.fll-bdg{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--bg3);',
  'color:var(--mut);line-height:1.6}',
  '.fll-tab.on .fll-bdg{background:var(--acc);color:#fff}',
  '.fll-bdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-tab.on .fll-bdg.err{background:var(--err);color:#fff}',

  /* ---------- thanh bo loc thuong tru ---------- */
  '.fll-bar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 16px 0;padding:8px 11px;',
  'border:1px solid rgba(255,46,136,.3);background:rgba(255,46,136,.05);border-radius:10px;flex:0 0 auto}',
  '.fll-bar[hidden]{display:none}',
  '.fll-bar-t{font-size:10px;font-weight:700;color:var(--acc);letter-spacing:.5px;text-transform:uppercase}',
  '.fll-bar-n{font-size:10.5px;color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}',
  '.fll-fchips{display:flex;flex-wrap:wrap;gap:5px;width:100%}',
  '.fll-fchip{display:inline-flex;align-items:center;gap:6px;padding:3px 5px 3px 10px;border-radius:20px;',
  'font-size:10.5px;background:var(--bg);border:1px solid var(--line);color:var(--txt);max-width:100%}',
  '.fll-fchip b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}',
  '.fll-fchip button{width:16px;height:16px;border-radius:50%;background:var(--bg3);color:var(--mut);',
  'font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;',
  'transition:.14s}',
  '.fll-fchip button:hover{background:var(--err);color:#fff}',
  /* Chip mau bo loc: nua trai bam de ap, nua phai bam de xoa. */
  '.fll-tpl{cursor:default}',
  '.fll-tpl b{cursor:pointer;font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-tpl:hover{border-color:var(--acc)}',
  '.fll-tpl b:hover{color:var(--acc)}',
  '.fll-in:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled:hover{border-color:var(--line);background:var(--bg2)}',
  '.fll-fclear{padding:3px 11px;border-radius:20px;font-size:10.5px;font-weight:650;background:var(--acc);',
  'color:#fff;cursor:pointer;transition:.14s}',
  '.fll-fclear:hover{filter:brightness(1.14)}',
  '.fll-bdg.act{background:rgba(255,46,136,.22);color:var(--acc)}',
  '.fll-tab.on .fll-bdg.act{background:var(--acc);color:#fff}',

  /* ---------- minimap mat do log theo thoi gian ---------- */
  '.fll-map{position:relative;height:36px;margin:12px 16px 0;padding:0 2px;border:1px solid var(--line);',
  'border-radius:8px;background:linear-gradient(180deg,#120f19,#191522);display:flex;align-items:flex-end;',
  'overflow:hidden;cursor:crosshair;flex:0 0 auto}',
  '.fll-map i{flex:1;min-width:1px;display:block;transition:.1s}',
  '.fll-map i:hover{filter:brightness(1.8)}',
  '.fll-shade{position:absolute;top:0;bottom:0;width:0;background:rgba(14,11,20,.74);pointer-events:none}',
  '.fll-shade-l{left:0}',
  '.fll-shade-r{right:0}',
  /* Khi co khoang dang chon thi ve vach mep de biet cho nao nam duoc de co gian. */
  '.fll-map-ranged .fll-shade-l{border-right:2px solid var(--acc);box-shadow:2px 0 8px rgba(255,46,136,.4)}',
  '.fll-map-ranged .fll-shade-r{border-left:2px solid var(--acc);box-shadow:-2px 0 8px rgba(255,46,136,.4)}',
  '.fll-maptext{font-variant-numeric:tabular-nums;opacity:.75}',
  '.fll-map-ranged + .fll-maplbl .fll-maptext{opacity:1;color:var(--acc);font-weight:650}',
  '.fll-cursor{position:absolute;top:0;bottom:0;width:2px;background:var(--acc);pointer-events:none;',
  'box-shadow:0 0 10px var(--acc);opacity:0;transition:.12s}',
  '.fll-maplbl{display:flex;justify-content:space-between;gap:8px;margin:5px 17px 0;font-size:9.5px;',
  'color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- body ---------- */
  '.fll-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--pad-y,14px) var(--pad-x,16px) 18px}',
  '.fll-body::-webkit-scrollbar{width:10px}',
  '.fll-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-body::-webkit-scrollbar-thumb:hover{background:#4c4360}',

  /* ---------- stat cards ---------- */
  '.fll-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px}',
  '.fll-stat{background:var(--bg2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;',
  'cursor:pointer;transition:.14s}',
  '.fll-stat:hover{border-color:var(--acc);transform:translateY(-1px)}',
  '.fll-stat b{display:block;font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;',
  'letter-spacing:-.5px;line-height:1.15}',
  '.fll-stat b em{font-style:normal;font-size:12px;font-weight:600;color:var(--mut);letter-spacing:0}',
  '.fll-stat span{display:block;font-size:10.5px;color:var(--mut);margin-top:4px}',

  /* ---------- khoi lay net theo feedback ----------
     Co y KHONG to hong: thanh bo loc phia tren da la mau accent roi. De ba khoi hong chong nhau
     thi accent mat het y nghia, khong con gi noi bat hon gi. */
  '.fll-focus{border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:12px 13px;',
  'margin-bottom:14px}',
  '.fll-focus-t{font-size:12.5px;line-height:1.5}',
  '.fll-focus-t b{font-weight:700;color:var(--acc)}',
  '.fll-focus-d{font-size:10.5px;color:var(--mut);margin-top:4px;font-family:var(--mono);',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-focus-hint{font-size:10.5px;color:var(--mut);margin:11px 0 7px}',

  /* ---------- bang thoi luong ---------- */
  '.fll-slow{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;margin-bottom:4px;cursor:pointer;overflow:hidden;',
  'transition:.14s}',
  '.fll-slow:hover{border-color:var(--acc)}',
  '.fll-slow u{position:absolute;left:0;top:0;bottom:0;text-decoration:none}',
  '.fll-slow-ms{position:relative;font-size:11.5px;font-weight:750;font-variant-numeric:tabular-nums;',
  'flex:0 0 auto;width:52px;text-align:right}',
  '.fll-slow-txt{position:relative;flex:1;min-width:0;font-family:var(--mono);font-size:10.5px;color:#cfc8dd;',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- nut nho trong hang, va nut tat tieng ---------- */
  '.fll-ico.fll-mini{width:24px;height:24px;font-size:10px;border-radius:6px;background:var(--bg3);flex:0 0 auto}',
  '.fll-ico.fll-mute{width:22px;height:22px;font-size:11px;opacity:.4;flex:0 0 auto;margin-left:2px}',
  '.fll-grp:hover .fll-ico.fll-mute{opacity:.9}',
  '.fll-grp.muted{opacity:.42}',
  '.fll-grp.muted:hover{opacity:.8}',

  /* ---------- tam truot chi tiet ---------- */
  '.fll-sheet{position:absolute;left:0;right:0;bottom:0;top:52px;background:var(--bg);display:flex;',
  'flex-direction:column;z-index:8;animation:fll-up .16s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
  '.fll-sheet-hd{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);',
  'background:linear-gradient(180deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-sheet-tt{font-size:12.5px;font-weight:650;word-break:break-all}',
  '.fll-sheet-sub{font-size:10.5px;color:var(--mut);margin-top:2px}',
  '.fll-sheet-body{flex:1;overflow:auto;padding:14px 16px 18px}',
  '.fll-sheet-body::-webkit-scrollbar{width:10px;height:10px}',
  '.fll-sheet-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-code{font-family:var(--mono);font-size:11px;line-height:1.55;color:#cfc8dd;background:var(--bg2);',
  'border:1px solid var(--line);border-radius:9px;padding:12px 14px;white-space:pre;overflow-x:auto;',
  'display:block;tab-size:2}',
  '.fll-code.fll-wrap{white-space:pre-wrap;overflow-wrap:anywhere}',

  /* ---------- tung truong trong payload ---------- */
  /* Mot dong HTTP co the co 5 truong (--encrypted / --body / --header / --exception ...),
     nen moi truong la mot khoi rieng co nhan trang thai parse va nut copy rieng. */
  /* To mau JSON: mau khoa/chuoi/so tach nhau du de luot mat tim field, khong ruc den muc nhuc mat. */
  '.fll-code i{font-style:normal}',
  '.fll-jk{color:#7fd0ff}',
  '.fll-js{color:#a9e6b8}',
  '.fll-jn{color:var(--warn)}',
  '.fll-jb{color:#c79bff}',
  /* Thanh doi Request / Response: dung lai dang tab cua panel de nhat quan, size nam trong badge. */
  '.fll-stabs{display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid var(--line);margin-bottom:13px}',
  '.fll-stabs .fll-tab{flex:0 0 auto;padding:5px 12px 8px}',
  '.fll-stabs .fll-chip,.fll-paybar .fll-chip{margin-bottom:6px}',
  '.fll-paybar{margin-bottom:8px}',
  '.fll-pay{margin-bottom:14px}',
  '.fll-pay:last-child{margin-bottom:0}',
  '.fll-pay-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px;min-height:24px;flex-wrap:wrap}',
  '.fll-pay-hd b{font-family:var(--mono);font-size:11px;font-weight:700;color:#e8e2f2}',
  '.fll-pay-v{font-family:var(--mono);font-size:11px;color:var(--mut);word-break:break-all}',
  '.fll-pay-tag{font-size:9.5px;font-weight:700;letter-spacing:.3px;padding:3px 7px;border-radius:6px;',
  'background:rgba(61,220,151,.11);color:var(--ok);border:1px solid rgba(61,220,151,.24)}',
  '.fll-pay-tag.warn{background:rgba(255,182,72,.11);color:var(--warn);border-color:rgba(255,182,72,.28)}',
  '.fll-btn.fll-mini{padding:5px 10px;font-size:10.5px;border-radius:7px}',

  /* ---------- tieu de section ---------- */
  /* Dinh lai o mep tren khi cuon. Tab Loc co 8 muc, tab Dien bien ve 80 moc mot lo — cuon mot lat la
     khong con biet dang doc muc nao; sticky giu cai nhan do luon nam trong tam mat.
     Ba dieu kien de sticky khong vo:
     - Nen phai DUC va TRAN HET CHIEU RONG, neu khong noi dung se troi qua ngay ben duoi chu. Keo bang
       margin ngang am 16px (dung bang padding cua .fll-body) roi padding bu lai.
     - top phai la AM dung bang padding-top cua .fll-body. Do that trong Chrome tren trang test dung chinh
       bo CSS nay: voi top:0 tieu de dinh cach mep tren 13.9px (dung bang padding-top 14px) va noi dung
       van troi qua ben tren no — tuc offset tinh tu CONTENT box chu khong phai padding box. Voi
       top:calc(var(--pad-y) * -1) thi ho con 0px, va KHONG bi overflow cat: no chi nho dung toi mep
       padding box, la dung cho overflow bat dau clip.
     - z-index:3 du de de len noi dung, van nam duoi .fll-sheet (z-index:8) nen tam truot khong bi dam xuyen.
     Mau chu tung la #7f7793: chi 4.31:1 tren nen panel, duoi nguong WCAG AA 4.5:1, lai o co 10px in hoa
     nen doc duoc ma khong "nhay ra" duoc. Nay #d5cfe2 tren dai nen dam nhat van dat 10.53:1.
     Dai nen dung dung gradient cua .fll-sheet-hd cho thong nhat voi phan con lai cua panel. */
  '.fll-sec{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:3;',
  'margin:22px calc(var(--pad-x,16px) * -1) 10px;padding:10px var(--pad-x,16px) 9px;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);',
  'font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;',
  'color:#d5cfe2;display:flex;align-items:center;gap:8px}',
  '.fll-sec:before{content:"";width:3px;height:13px;border-radius:2px;background:var(--acc);flex:0 0 auto}',
  '.fll-sec:first-child{margin-top:0}',
  '.fll-note{display:flex;gap:10px;padding:12px 13px;border-radius:11px;font-size:11.5px;line-height:1.55;',
  'background:rgba(255,182,72,.09);border:1px solid rgba(255,182,72,.28);color:#ffd79a;margin-bottom:6px}',
  '.fll-note b{color:#fff;font-weight:650}',

  /* ---------- thanh ty le muc do ---------- */
  '.fll-lvbar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px;background:var(--bg3)}',
  '.fll-lvbar i{display:block;transition:.2s}',
  '.fll-lvkey{display:flex;flex-wrap:wrap;gap:6px}',
  '.fll-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:10.5px;',
  'font-weight:600;background:var(--bg2);border:1px solid var(--line);color:var(--mut);cursor:pointer;',
  'transition:.14s}',
  '.fll-chip:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-chip.on{background:var(--acc);border-color:var(--acc);color:#fff}',
  /* Chip khong con dong nao khop trong ngu canh hien tai: van bam duoc nhung khong doi nhin. */
  '.fll-chip.dim{opacity:.42}',
  '.fll-chip.dim:hover{opacity:1}',
  '.fll-chip em{font-style:normal;opacity:.75;font-variant-numeric:tabular-nums}',
  '.fll-sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto}',

  /* ---------- bang xep hang co thanh ngang ---------- */
  '.fll-rank{display:flex;flex-direction:column;gap:4px}',
  '.fll-rk{position:relative;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;cursor:pointer;overflow:hidden;transition:.14s}',
  '.fll-rk:hover{border-color:var(--acc)}',
  '.fll-rk u{position:absolute;left:0;top:0;bottom:0;background:rgba(255,46,136,.16);text-decoration:none}',
  '.fll-rk span{position:relative;flex:1;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-rk b{position:relative;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}',

  /* ---------- the nhom van de ---------- */
  '.fll-grp{border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:11px;',
  'background:var(--bg2);padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:.14s}',
  '.fll-grp:hover{border-color:var(--acc);border-left-color:var(--acc);background:var(--bg3)}',
  '.fll-grp.err{border-left-color:var(--err)}',
  '.fll-grp-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.fll-cnt{font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;background:rgba(255,182,72,.16);',
  'color:var(--warn);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-grp.err .fll-cnt{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-mod{font-size:10px;font-weight:650;color:var(--info);background:rgba(88,196,255,.12);padding:2px 8px;',
  'border-radius:6px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-when{margin-left:auto;font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-msg{font-family:var(--mono);font-size:11px;line-height:1.55;color:#cfc8dd;word-break:break-word;',
  'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-spark{display:flex;align-items:flex-end;gap:1px;height:15px;margin-top:9px}',
  '.fll-spark i{flex:1;min-width:1px;background:var(--bg3);border-radius:1px}',

  /* ---------- HTTP ---------- */
  '.fll-call{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;background:var(--bg2);',
  'border:1px solid transparent;margin-bottom:5px;cursor:pointer;transition:.14s}',
  '.fll-call:hover{border-color:var(--acc)}',
  '.fll-verb{font-size:9px;font-weight:800;letter-spacing:.4px;padding:3px 6px;border-radius:5px;',
  'background:var(--bg3);color:var(--mut);flex:0 0 auto;width:50px;text-align:center}',
  '.fll-st{font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;flex:0 0 auto;',
  'background:rgba(61,220,151,.14);color:var(--ok);font-variant-numeric:tabular-nums}',
  '.fll-st.bad{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-st.wait{background:rgba(255,182,72,.16);color:var(--warn)}',
  '.fll-path{flex:1;min-width:0;font-family:var(--mono);font-size:11px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;direction:rtl}',
  '.fll-dur{font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- timeline ---------- */
  '.fll-tl{position:relative;padding-left:20px}',
  '.fll-tl:before{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:1px;background:var(--line)}',
  '.fll-ev{position:relative;padding:9px 12px;margin-bottom:6px;border-radius:9px;background:var(--bg2);',
  'cursor:pointer;border:1px solid transparent;transition:.14s}',
  '.fll-ev:hover{border-color:var(--acc)}',
  '.fll-ev:before{content:"";position:absolute;left:-18px;top:15px;width:7px;height:7px;border-radius:50%;',
  'background:var(--mut);box-shadow:0 0 0 3px var(--bg)}',
  '.fll-ev.boot:before{background:var(--ok)}',
  '.fll-ev.gap:before{background:var(--warn)}',
  '.fll-ev.err:before{background:var(--err)}',
  '.fll-ev-t{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600}',
  '.fll-ev-t em{margin-left:auto;font-style:normal;font-size:10px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-ev-d{font-size:10.5px;color:var(--mut);margin-top:4px;font-family:var(--mono);overflow:hidden;',
  'text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- hanh trinh ---------- */
  /* Dung lai khung .fll-tl/.fll-ev cua Timeline, chi doi mau cham theo loai thao tac. */
  '.fll-ev.jr-screen:before{background:var(--info)}',
  '.fll-ev.jr-tap:before{background:var(--acc)}',
  '.fll-ev.jr-saw:before{background:var(--warn)}',
  '.fll-ev.jr-move:before{background:var(--ok)}',
  '.fll-ev.jr-fail:before{background:var(--err)}',
  '.fll-ev.jr-saw{border-left:2px solid var(--warn)}',
  '.fll-ev.jr-fail{border-left:2px solid var(--err)}',
  '.fll-jms{font-size:9.5px;font-weight:700;color:var(--warn);background:rgba(255,182,72,.14);',
  'padding:1px 6px;border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-jn{font-size:9.5px;font-weight:800;color:var(--mut);background:var(--bg3);padding:1px 6px;',
  'border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- form loc ---------- */
  '.fll-in{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);',
  'color:var(--txt);font-size:12px;font-family:var(--mono);transition:.14s}',
  '.fll-in::placeholder{color:#6d6580}',
  '.fll-in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,46,136,.14)}',
  '.fll-in.bad{border-color:var(--err)}',
  '.fll-hint{font-size:10.5px;line-height:1.55;color:var(--mut)}',
  '.fll-hint b{font-weight:650}',
  '.fll-btn{padding:9px 15px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);',
  'font-size:11.5px;font-weight:650;cursor:pointer;transition:.14s}',
  '.fll-btn:hover{border-color:var(--acc);background:var(--bg3)}',
  '.fll-btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}',
  '.fll-btn.pri:hover{filter:brightness(1.12)}',
  '.fll-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.fll-empty{text-align:center;padding:40px 16px;color:var(--mut);font-size:12px}',

  /* ---------- footer dieu huong ---------- */
  /* Chua padding-right rong hon de nut ">" khong nam duoi tay nam keo goc. */
  '.fll-ft{display:flex;align-items:center;gap:8px;padding:11px 30px 11px 14px;',
  'border-top:1px solid var(--line);background:linear-gradient(0deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-ft .fll-info{flex:1;font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-ft .fll-info b{color:var(--txt);font-weight:650;font-variant-numeric:tabular-nums}',

  /* ---------- pill khi thu nho ---------- */
  '.fll-pill{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:9px;padding:11px 18px;',
  'border-radius:24px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:12px;',
  'font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.42);transition:.16s;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '.fll-pill:hover{transform:translateY(-2px);border-color:var(--acc)}',
  '.fll-pill b{color:var(--err);font-weight:750;font-variant-numeric:tabular-nums}',

  /* ---------- style bom vao bang log cua trang ---------- */
  /* Loc bang mot class tren container + danh dau dong duoc giu, thay vi an tung dong bi loai. */
  '.fll-filtering > [class*="logRow"]:not(.fll-keep){display:none!important}',
  '.fll-hit{background:rgba(255,46,136,.22)!important;outline:2px solid #ff2e88!important;outline-offset:-2px;',
  'border-radius:3px;animation:fll-flash .9s ease-out}',
  '@keyframes fll-flash{0%{background:rgba(255,46,136,.6)!important}100%{background:rgba(255,46,136,.22)!important}}',
].join('');
// AI-GENERATED END
