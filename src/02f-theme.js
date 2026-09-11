// @ts-check
// CSS của panel Log Lens
//
// Về độ ưu tiên (specificity): trang admin dùng antd nên phải reset, nhưng reset KHÔNG được mạnh hơn
// các rule .fll-* của mình. Vì vậy reset dùng ":where(#fll-root) <tag>" = (0,0,1): đủ để thắng rule
// element của trang, nhưng vẫn thua mọi rule class (0,1,0) bên dưới. Nếu viết "#fll-root *" (1,0,1)
// thì padding:0 sẽ đè chết toàn bộ padding của các thẻ -> giao diện dính sát mép.

const PANEL_CSS = [
  ':where(#fll-root) *,:where(#fll-root) *::before,:where(#fll-root) *::after{box-sizing:border-box}',
  ':where(#fll-root) div,:where(#fll-root) span,:where(#fll-root) header,:where(#fll-root) footer,',
  ':where(#fll-root) nav,:where(#fll-root) button,:where(#fll-root) input,:where(#fll-root) i,',
  ':where(#fll-root) u,:where(#fll-root) b,:where(#fll-root) em{margin:0;padding:0;border:0;',
  'background:none;color:inherit;font:inherit;line-height:1.45;letter-spacing:normal;text-transform:none;',
  'text-align:left;vertical-align:baseline;box-shadow:none;text-shadow:none;min-width:0;height:auto}',
  '#fll-root button,#fll-root input{outline:0;-webkit-appearance:none;appearance:none}',
  /* Thuộc tính hidden mặc định là display:none của trình duyệt, nhưng MỌI rule .fll-* có display đều
     đè lên nó (class thắng selector thuộc tính của UA). Trước đây chỉ khai riêng cho .fll-bar và
     .fll-ft nên ô tìm trong từng mục đặt node.hidden=true mà hàng vẫn hiện nguyên — .fll-rk,
     .fll-call, .fll-slow, .fll-chip đều là display:flex/inline-flex. Khai một lần ở đây cho cả panel. */
  '#fll-root [hidden]{display:none!important}',

  '#fll-root{position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14.5px;font-weight:400;',
  '--bg:#16141d;--bg2:#1e1b27;--bg3:#2a2436;--line:rgba(255,255,255,.09);--txt:#ece9f5;--mut:#9b93ad;',
  '--acc:#ff2e88;--err:#ff5f6d;--warn:#ffb648;--info:#58c4ff;--dbg:#7d8590;--ok:#3ddc97;',
  '--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;',
  /* Padding của .fll-body: .fll-sec phải biết đúng hai số này để dính sát mép và tràn hết bề ngang.
     Mọi chỗ dùng đều kèm giá trị dự phòng: biến khai ở #fll-root, nếu panel bị dùng ngoài root đó
     thì var() không giải được và CẢ declaration hỏng — padding sẽ sập về 0 chứ không quay về mặc định. */
  '--pad-y:14px;--pad-x:16px}',

  /* ---------- khung panel ---------- */
  /* Kích thước bị chặn bằng JS (clampValue) chứ không bằng max-width, để kéo góc không bị kẹt ở 880px. */
  '.fll-panel{position:fixed;top:14px;right:14px;bottom:14px;width:480px;min-width:360px;max-width:none;',
  'display:flex;flex-direction:column;background:var(--bg);color:var(--txt);border:1px solid var(--line);',
  'border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);overflow:hidden;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-in{from{opacity:0;transform:translateX(16px) scale(.99)}to{opacity:1;transform:none}}',

  /* Đọc xuyên qua panel trong lúc chuột đang ở trên bảng log. KHÔNG đặt opacity lên chính .fll-panel:
     opacity gộp cả cây con thành một lớp nên con không bao giờ sáng hơn cha — minimap sẽ mờ theo, mà
     minimap lại đúng là thứ cần nhìn rõ lúc đó. Nền chuyển sang màu có alpha, rồi mờ từng đứa con và
     chừa minimap (.fll-map) cùng nhãn của nó (.fll-maplbl) ra.
     Bỏ luôn bóng mờ 70px: để lại thì vùng tối quanh panel vẫn che chữ của bảng log. */
  '.fll-panel{transition:background .14s,box-shadow .14s,border-color .14s}',
  '.fll-panel > *{transition:opacity .14s}',
  '.fll-panel.fll-xray{background:rgba(22,20,29,.10);box-shadow:none;border-color:rgba(255,255,255,.05)}',
  '.fll-panel.fll-xray > *:not(.fll-map):not(.fll-maplbl){opacity:.10}',

  /* ---------- hai tay nắm thay đổi kích thước ---------- */
  /* Trong lúc kéo: bỏ bóng mờ bán kính 70px (thứ tốn nhất để vẽ lại mỗi khung hình),
     báo trước cho trình duyệt chuẩn bị lớp riêng, và tắt hover bên trong cho khỏi tính vô ích. */
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
  '.fll-tt{font-size:15px;font-weight:650;letter-spacing:.2px}',
  '.fll-sub{font-size:12.5px;color:var(--mut);margin-top:2px}',
  '.fll-hd-sp{flex:1}',
  '.fll-ico{width:28px;height:28px;border:1px solid transparent;border-radius:8px;color:var(--mut);',
  'cursor:pointer;font-size:15.5px;display:flex;align-items:center;justify-content:center;transition:.14s;',
  'flex:0 0 auto}',
  '.fll-ico:hover{background:var(--bg3);color:var(--txt);border-color:var(--line)}',

  /* ---------- thanh tab ---------- */
  /* Đo đếm trên panel 480px: với gap 3px + padding ngang 7px, bảy tab cần 507px trong khi chỗ chỉ có
     478px — tab cuối ("Diễn biến") bị cắt mất chữ mà không có dấu hiệu gì là còn cuộn được.
     Gap 2px + padding 5px lại còn 473px. overflow-x vẫn giữ cho trường hợp kéo panel hẹp hơn. */
  '.fll-tabs{display:flex;gap:2px;padding:10px 12px 0;flex:0 0 auto;overflow-x:auto;scrollbar-width:none}',
  '.fll-tabs::-webkit-scrollbar{display:none}',
  '.fll-tab{flex:1 0 auto;padding:8px 5px 10px;border-bottom:2px solid transparent;color:var(--mut);font-size:12.5px;',
  'font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;',
  'transition:.14s;white-space:nowrap}',
  '.fll-tab:hover{color:var(--txt)}',
  '.fll-tab.on{color:var(--txt);border-bottom-color:var(--acc)}',
  '.fll-bdg{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--bg3);',
  'color:var(--mut);line-height:1.6}',
  '.fll-tab.on .fll-bdg{background:var(--acc);color:#fff}',
  '.fll-bdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-tab.on .fll-bdg.err{background:var(--err);color:#fff}',

  /* ---------- thanh bộ lọc thường trú ---------- */
  '.fll-bar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 16px 0;padding:8px 11px;',
  'border:1px solid rgba(255,46,136,.3);background:rgba(255,46,136,.05);border-radius:10px;flex:0 0 auto}',
  '.fll-bar[hidden]{display:none}',
  '.fll-bar-t{font-size:11px;font-weight:700;color:var(--acc);letter-spacing:.5px;text-transform:uppercase}',
  '.fll-bar-n{font-size:12px;color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}',
  '.fll-fchips{display:flex;flex-wrap:wrap;gap:5px;width:100%}',
  '.fll-fchip{display:inline-flex;align-items:center;gap:6px;padding:3px 5px 3px 10px;border-radius:20px;',
  'font-size:12px;background:var(--bg);border:1px solid var(--line);color:var(--txt);max-width:100%}',
  '.fll-fchip b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}',
  '.fll-fchip button{width:16px;height:16px;border-radius:50%;background:var(--bg3);color:var(--mut);',
  'font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;',
  'transition:.14s}',
  '.fll-fchip button:hover{background:var(--err);color:#fff}',
  /* Chip mẫu bộ lọc: nửa trái bấm để áp, nửa phải bấm để xoá. */
  '.fll-tpl{cursor:default}',
  '.fll-tpl b{cursor:pointer;font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap}',
  '.fll-tpl:hover{border-color:var(--acc)}',
  '.fll-tpl b:hover{color:var(--acc)}',
  '.fll-in:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled{opacity:.5;cursor:not-allowed}',
  '.fll-btn:disabled:hover{border-color:var(--line);background:var(--bg2)}',
  '.fll-fclear{padding:3px 11px;border-radius:20px;font-size:12px;font-weight:650;background:var(--acc);',
  'color:#fff;cursor:pointer;transition:.14s}',
  '.fll-fclear:hover{filter:brightness(1.14)}',
  '.fll-bdg.act{background:rgba(255,46,136,.22);color:var(--acc)}',
  '.fll-tab.on .fll-bdg.act{background:var(--acc);color:#fff}',

  /* ---------- minimap mật độ log theo thời gian ---------- */
  '.fll-map{position:relative;height:36px;margin:12px 16px 0;padding:0 2px;border:1px solid var(--line);',
  'border-radius:8px;background:linear-gradient(180deg,#120f19,#191522);display:flex;align-items:flex-end;',
  'overflow:hidden;cursor:crosshair;flex:0 0 auto}',
  '.fll-map i{flex:1;min-width:1px;display:block;transition:.1s}',
  '.fll-map i:hover{filter:brightness(1.8)}',
  '.fll-shade{position:absolute;top:0;bottom:0;width:0;background:rgba(14,11,20,.74);pointer-events:none}',
  '.fll-shade-l{left:0}',
  '.fll-shade-r{right:0}',
  /* Khi có khoảng đang chọn thì vẽ vạch mép để biết chỗ nào nắm được để co giãn. */
  '.fll-map-ranged .fll-shade-l{border-right:2px solid var(--acc);box-shadow:2px 0 8px rgba(255,46,136,.4)}',
  '.fll-map-ranged .fll-shade-r{border-left:2px solid var(--acc);box-shadow:-2px 0 8px rgba(255,46,136,.4)}',
  '.fll-maptext{font-variant-numeric:tabular-nums;opacity:.75}',
  '.fll-map-ranged + .fll-maplbl .fll-maptext{opacity:1;color:var(--acc);font-weight:650}',
  '.fll-maptext.aiming{opacity:1;color:#fff;font-weight:700;font-variant-numeric:tabular-nums}',
  '.fll-cursor{position:absolute;top:0;bottom:0;width:2px;background:var(--acc);pointer-events:none;',
  'box-shadow:0 0 10px var(--acc);opacity:0;transition:.12s}',
  /* Tooltip tự vẽ. position:fixed và nằm trong #fll-root (không phải .fll-panel, panel có
     overflow:hidden sẽ cắt mất nó). z-index trên cả tấm trượt lẫn lớp mũi tên. */
  '.fll-tip{position:fixed;z-index:2147483001;max-width:300px;padding:7px 10px;border-radius:8px;',
  'background:#0d0b12;border:1px solid var(--line);color:var(--txt);font-size:12px;line-height:1.5;',
  'box-shadow:0 8px 26px rgba(0,0,0,.6);pointer-events:none;white-space:normal;word-break:break-word;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',

  /* Nút phóng to nằm ngay trong dòng nhãn dưới minimap — chỗ duy nhất vừa liên quan vừa không ăn
     mất chỗ của chính minimap. */
  '.fll-maprow{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}',
  /* Chiều cao của nút PHẢI cố định, đừng để nó suy ra từ line-height thừa hưởng: nút này hiện/ẩn theo
     việc có khoảng đang chọn hay không, mà đo trong Chrome thì dòng nhãn cao 15.22px khi không có nút
     và 18.50px khi có — mỗi lần bấm là cả phần dưới panel bị đẩy lên rồi tụt xuống 3.28px. Nay nút
     cao đúng 18.5px và .fll-maplbl chừa sẵn từng ấy, nên hiện/ẩn không đụng vào layout.
     Đổi cỡ chữ cả bộ thì đo lại hai số này. */
  '.fll-mapzoom{font-size:10px;font-weight:700;height:18.5px;padding:0 7px;border-radius:20px;',
  'display:inline-flex;align-items:center;cursor:pointer;',
  'background:var(--bg3);color:var(--txt);border:1px solid var(--line)!important;white-space:nowrap}',
  '.fll-mapzoom:hover{border-color:var(--acc)!important;color:var(--acc)}',
  '.fll-mapzoom.on{background:var(--acc);color:#fff;border-color:var(--acc)!important}',
  '.fll-map-zoomed{border-color:var(--acc)}',
  '.fll-maplbl{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 17px 0;',
  'min-height:18.5px;font-size:10.5px;',
  'color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- thân panel ---------- */
  '.fll-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--pad-y,14px) var(--pad-x,16px) 18px}',
  '.fll-body::-webkit-scrollbar{width:10px}',
  '.fll-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-body::-webkit-scrollbar-thumb:hover{background:#4c4360}',

  /* ---------- thẻ thống kê ---------- */
  '.fll-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px}',
  '.fll-stat{background:var(--bg2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;',
  'cursor:pointer;transition:.14s}',
  '.fll-stat:hover{border-color:var(--acc);transform:translateY(-1px)}',
  '.fll-stat b{display:block;font-size:23.5px;font-weight:700;font-variant-numeric:tabular-nums;',
  'letter-spacing:-.5px;line-height:1.15}',
  '.fll-stat b em{font-style:normal;font-size:13.5px;font-weight:600;color:var(--mut);letter-spacing:0}',
  '.fll-stat span{display:block;font-size:12px;color:var(--mut);margin-top:4px}',

  /* ---------- khối lấy nét theo feedback ----------
     Cố ý KHÔNG tô hồng: thanh bộ lọc phía trên đã là màu accent rồi. Để ba khối hồng chồng nhau
     thì accent mất hết ý nghĩa, không còn gì nổi bật hơn gì. */
  '.fll-focus{border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:12px 13px;',
  'margin-bottom:14px}',
  '.fll-focus-t{font-size:14px;line-height:1.5}',
  '.fll-focus-t b{font-weight:700;color:var(--acc)}',
  '.fll-focus-d{font-size:12px;color:var(--mut);margin-top:4px;font-family:var(--mono);',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-focus-hint{font-size:12px;color:var(--mut);margin:11px 0 7px}',

  /* ---------- bảng thời lượng ---------- */
  '.fll-slow{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;margin-bottom:4px;cursor:pointer;overflow:hidden;',
  'transition:.14s}',
  '.fll-slow:hover{border-color:var(--acc)}',
  '.fll-slow u{position:absolute;left:0;top:0;bottom:0;text-decoration:none}',
  '.fll-slow-ms{position:relative;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;',
  'flex:0 0 auto;width:52px;text-align:right}',
  '.fll-slow-txt{position:relative;flex:1;min-width:0;font-family:var(--mono);font-size:12px;color:#cfc8dd;',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- bảng cấu hình ---------- */
  /* Hàng có thể chứa một khối JSON dài; .fll-cfg-v giới hạn 3 dòng rồi cắt, còn bản đầy đủ thì
     xem qua nút JSON. Không dùng white-space:nowrap như các bảng khác vì giá trị cấu hình đọc
     theo chiều ngang thì mất nghĩa. */
  '.fll-cfg{position:relative;padding:9px 12px 9px;margin-bottom:5px;border-radius:9px;',
  'background:var(--bg2);border:1px solid var(--line);transition:.14s}',
  '.fll-cfg.chg{border-left:2px solid var(--warn)}',
  '.fll-cfg-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px;font-weight:600}',
  '.fll-cfg-hd b{font-weight:700;word-break:break-word}',
  '.fll-cfg-hd em{margin-left:auto;font-style:normal;font-size:11px;color:var(--mut);',
  'font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-cfg-chg{font-style:normal;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:20px;',
  'background:rgba(255,182,72,.18);color:var(--warn)}',
  '.fll-cfg-note{font-style:normal;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:20px;',
  'background:var(--bg3);color:var(--mut)}',
  '.fll-cfg-val{margin-top:6px;padding:6px 9px;border-radius:7px;background:var(--bg);',
  'border:1px solid transparent;cursor:pointer;transition:.14s}',
  '.fll-cfg-val:hover{border-color:var(--acc)}',
  '.fll-cfg-val.last{background:var(--bg3)}',
  '.fll-cfg-vm{font-size:10.5px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-cfg-v{margin-top:3px;font-family:var(--mono);font-size:12px;line-height:1.5;color:#cfc8dd;',
  'word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-cfg-js{margin-top:6px;padding:4px 10px;font-size:11px}',

  /* ---------- mũi tên từ mục đang di chuột lên minimap ---------- */
  /* Một lớp SVG phủ lên cả panel. pointer-events:none để không chặn chuột; z-index cao hơn .fll-sheet
     (8) vì đường kẻ phải đi TỪ trong tấm trượt RA đến minimap nằm ngoài nó. */
  /* Mũi tên từng tô accent — cùng hệ hồng với cột ERROR của minimap (#ff5f6d) và với chính
     .fll-cursor (vạch vị trí cuộn, cũng accent), nên đặt lên minimap là chìm nghỉm. Nay tô TRẮNG kèm
     viền màu nền panel: trên cột hồng, cột vàng hay chỗ trống đều nổi, và không lẫn với vạch cuộn. */
  '.fll-aim{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9;',
  'opacity:0;transition:opacity .12s}',
  '.fll-aim.on{opacity:1}',
  /* Đường kẻ vẫn để accent: nó chạy trên các thẻ tối trong thân panel, ở đó accent đọc tốt mà không
     đè lên chữ nhiều như nét trắng. Chỉ cái ĐẦU MŨI TÊN và vạch trên minimap mới đổi sang trắng. */
  '.fll-aim-line{fill:none;stroke:var(--acc);stroke-width:1.6;stroke-dasharray:4 3;opacity:.9}',
  '.fll-aim-head{fill:#fff;stroke:var(--bg);stroke-width:1;paint-order:stroke}',
  '.fll-aim-ticks rect{fill:#fff;stroke:var(--bg);stroke-width:1;paint-order:stroke;opacity:.75}',
  '.fll-aim-ticks rect.fll-aim-first{opacity:1}',
  '.fll-aimed{outline:1px solid var(--acc);outline-offset:1px;border-radius:8px}',

  /* ---------- nút nhỏ trong hàng, và nút tắt tiếng ---------- */
  '.fll-ico.fll-mini{width:24px;height:24px;font-size:11px;border-radius:6px;background:var(--bg3);flex:0 0 auto}',
  '.fll-ico.fll-mute{width:22px;height:22px;font-size:12.5px;opacity:.4;flex:0 0 auto;margin-left:2px}',
  '.fll-grp:hover .fll-ico.fll-mute{opacity:.9}',
  '.fll-grp.muted{opacity:.42}',
  '.fll-grp.muted:hover{opacity:.8}',

  /* ---------- tấm trượt chi tiết ---------- */
  '.fll-sheet{position:absolute;left:0;right:0;bottom:0;top:52px;background:var(--bg);display:flex;',
  'flex-direction:column;z-index:8;animation:fll-up .16s cubic-bezier(.2,.9,.3,1)}',
  '@keyframes fll-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
  '.fll-sheet-hd{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);',
  'background:linear-gradient(180deg,#241f31,#1a1723);flex:0 0 auto}',
  '.fll-sheet-tt{font-size:14px;font-weight:650;word-break:break-all}',
  '.fll-sheet-sub{font-size:12px;color:var(--mut);margin-top:2px}',
  '.fll-sheet-body{flex:1;overflow:auto;padding:14px 16px 18px}',
  '.fll-sheet-body::-webkit-scrollbar{width:10px;height:10px}',
  '.fll-sheet-body::-webkit-scrollbar-thumb{background:#3a3348;border-radius:10px;border:3px solid var(--bg)}',
  '.fll-code{font-family:var(--mono);font-size:12.5px;line-height:1.55;color:#cfc8dd;background:var(--bg2);',
  'border:1px solid var(--line);border-radius:9px;padding:12px 14px;white-space:pre;overflow-x:auto;',
  'display:block;tab-size:2}',
  '.fll-code.fll-wrap{white-space:pre-wrap;overflow-wrap:anywhere}',

  /* ---------- từng trường trong payload ---------- */
  /* Một dòng HTTP có thể có 5 trường (--encrypted / --body / --header / --exception ...),
     nên mỗi trường là một khối riêng có nhãn trạng thái parse và nút copy riêng. */
  /* Tô màu JSON: màu khoá/chuỗi/số tách nhau đủ để lướt mắt tìm field, không rực đến mức nhức mắt. */
  '.fll-code i{font-style:normal}',
  '.fll-jk{color:#7fd0ff}',
  '.fll-js{color:#a9e6b8}',
  '.fll-jn{color:var(--warn)}',
  '.fll-jb{color:#c79bff}',
  /* Thanh đổi Request / Response: dùng lại dạng tab của panel cho nhất quán, size nằm trong badge. */
  /* Thanh công cụ của tấm trượt dính lại khi cuộn: payload JSON dài tới 10KB, cuộn giữa chừng vẫn
     phải bấm được "Tới dòng" và đổi Request/Response. Cùng ba điều kiện như .fll-sec — nền đục,
     tràn hết bề ngang bằng margin ngang âm, và top âm đúng bằng padding của vùng cuộn. */
  '.fll-paytop{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:4;background:var(--bg);',
  'margin:calc(var(--pad-y,14px) * -1) calc(var(--pad-x,16px) * -1) 12px;',
  'padding:var(--pad-y,14px) var(--pad-x,16px) 8px;border-bottom:1px solid var(--line)}',
  '.fll-stabs{display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid var(--line);margin-bottom:8px}',
  '.fll-stabs .fll-tab{flex:0 0 auto;padding:5px 12px 8px}',
  '.fll-stabs .fll-chip,.fll-paybar .fll-chip{margin-bottom:6px}',
  '.fll-paybar{margin:0;gap:6px}',
  '.fll-paybar .fll-btn.fll-mini{flex:0 0 auto}',
  '.fll-paybar .fll-chip{margin:0}',
  '.fll-pay{margin-bottom:14px}',
  '.fll-pay:last-child{margin-bottom:0}',
  '.fll-pay-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px;min-height:24px;flex-wrap:wrap}',
  '.fll-pay-hd b{font-family:var(--mono);font-size:12.5px;font-weight:700;color:#e8e2f2}',
  '.fll-pay-v{font-family:var(--mono);font-size:12.5px;color:var(--mut);word-break:break-all}',
  '.fll-pay-tag{font-size:10.5px;font-weight:700;letter-spacing:.3px;padding:3px 7px;border-radius:6px;',
  'background:rgba(61,220,151,.11);color:var(--ok);border:1px solid rgba(61,220,151,.24)}',
  '.fll-pay-tag.warn{background:rgba(255,182,72,.11);color:var(--warn);border-color:rgba(255,182,72,.28)}',
  '.fll-btn.fll-mini{padding:5px 10px;font-size:12px;border-radius:7px}',

  /* ---------- tiêu đề mục ---------- */
  /* Dính lại ở mép trên khi cuộn. Tab Lọc có 8 mục, tab Diễn biến vẽ 80 mốc một lô — cuộn một lát là
     không còn biết đang đọc mục nào; sticky giữ cái nhãn đó luôn nằm trong tầm mắt.
     Ba điều kiện để sticky không vỡ:
     - Nền phải ĐỤC và TRÀN HẾT CHIỀU RỘNG, nếu không nội dung sẽ trôi qua ngay bên dưới chữ. Kéo bằng
       margin ngang âm 16px (đúng bằng padding của .fll-body) rồi padding bù lại.
     - top phải là ÂM đúng bằng padding-top của .fll-body. Đo thật trong Chrome trên trang test dùng chính
       bộ CSS này: với top:0 tiêu đề dính cách mép trên 13.9px (đúng bằng padding-top 14px) và nội dung
       vẫn trôi qua bên trên nó — tức offset tính từ CONTENT box chứ không phải padding box. Với
       top:calc(var(--pad-y) * -1) thì hở còn 0px, và KHÔNG bị overflow cắt: nó chỉ nhô đúng tới mép
       padding box, là đúng chỗ overflow bắt đầu clip.
     - z-index:3 đủ để đè lên nội dung, vẫn nằm dưới .fll-sheet (z-index:8) nên tấm trượt không bị đâm xuyên.
     Màu chữ từng là #7f7793: chỉ 4.31:1 trên nền panel, dưới ngưỡng WCAG AA 4.5:1, lại ở cỡ 10px in hoa
     nên đọc được mà không "nhảy ra" được. Nay #d5cfe2 trên dải nền đậm nhất vẫn đạt 10.53:1.
     Dải nền dùng đúng gradient của .fll-sheet-hd cho thống nhất với phần còn lại của panel. */
  '.fll-sec{position:sticky;top:calc(var(--pad-y,14px) * -1);z-index:3;',
  'margin:22px calc(var(--pad-x,16px) * -1) 10px;padding:10px var(--pad-x,16px) 9px;',
  'background:linear-gradient(180deg,#241f31,#1a1723);border-bottom:1px solid var(--line);',
  'font-size:12.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;',
  'color:#d5cfe2;display:flex;align-items:center;gap:8px}',
  '.fll-sec:before{content:"";width:3px;height:13px;border-radius:2px;background:var(--acc);flex:0 0 auto}',
  '.fll-sec:first-child{margin-top:0}',

  /* ---------- mục đóng/mở được ---------- */
  /* Khối .fll-secw do collapsifySections() dựng sau khi vẽ, không renderer nào sinh ra nó.
     Lề trên 22px chuyển từ .fll-sec sang khối bao ngoài: sau khi bọc, .fll-sec luôn là con đầu tiên
     của khối nên ".fll-sec:first-child{margin-top:0}" sẽ ăn hết lề của MỌI mục. Hai rule dưới đây
     cùng độ đặc hiệu (0,2,0) với rule đó nhưng viết sau nên thắng. */
  '.fll-secw{margin-top:22px}',
  '.fll-secw:first-child{margin-top:0}',
  /* Mục đang thu lại thì không còn nội dung để tách khỏi mục trước, 22px chỉ làm danh sách tiêu đề
     dài ra vô ích — tab Tổng quan có chín mục. */
  '.fll-secw:not(.open) + .fll-secw:not(.open){margin-top:8px}',
  '.fll-secw > .fll-sec{margin-top:0;cursor:pointer;user-select:none;transition:.14s}',
  '.fll-secw > .fll-sec:hover{color:#fff;background:linear-gradient(180deg,#2d2740,#211c2e)}',
  '.fll-secb{display:none}',
  '.fll-secq{margin-bottom:8px;font-size:12px;padding:6px 10px}',
  /* Nút "Hiện thêm" của một mục: capSectionRows() cắt bớt hàng thừa sau khi vẽ, nút này bung phần còn lại. */
  '.fll-secmore{width:100%;margin-top:8px}',
  '.fll-secq-note{margin:-4px 0 8px}',
  '.fll-secw.open > .fll-secb{display:block}',
  /* Mục đang đóng thì thanh tiêu đề không cần dính lại: không có gì trôi qua dưới nó cả. */
  '.fll-secw:not(.open) > .fll-sec{position:relative;top:0}',
  /* Badge là thứ DUY NHẤT nhìn thấy khi mục đang thu lại, nên nó phải đọc được ngay: đẩy sang phải
     bằng margin-left:auto, và cắt bớt nếu quá dài (chuỗi đang tìm có thể dài bao nhiêu cũng được). */
  '.fll-secbdg{margin-left:auto;flex:0 1 auto;max-width:52%;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;font-style:normal;font-size:10.5px;font-weight:700;letter-spacing:.2px;',
  'text-transform:none;padding:2px 7px;border-radius:20px;background:var(--bg3);color:var(--mut)}',
  '.fll-secbdg.err{background:rgba(255,95,109,.18);color:var(--err)}',
  '.fll-secbdg.warn{background:rgba(255,182,72,.18);color:var(--warn)}',
  '.fll-secbdg.ok{background:rgba(61,220,151,.16);color:var(--ok)}',
  '.fll-secbdg.act{background:var(--acc);color:#fff}',
  '.fll-caret{flex:0 0 auto;font-size:10px;color:var(--mut);transition:transform .15s,color .15s;',
  'display:inline-block;width:9px;text-align:center}',
  '.fll-secw.open > .fll-sec .fll-caret{transform:rotate(90deg);color:var(--acc)}',
  '.fll-note{display:flex;gap:10px;padding:12px 13px;border-radius:11px;font-size:13px;line-height:1.55;',
  'background:rgba(255,182,72,.09);border:1px solid rgba(255,182,72,.28);color:#ffd79a;margin-bottom:6px}',
  '.fll-note b{color:#fff;font-weight:650}',
  '.fll-note.ok{background:rgba(61,220,151,.09);border-color:rgba(61,220,151,.28);color:#a9f0cf}',

  /* ---------- thanh tỷ lệ mức độ ---------- */
  '.fll-lvbar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px;background:var(--bg3)}',
  '.fll-lvbar i{display:block;transition:.2s}',
  '.fll-lvkey{display:flex;flex-wrap:wrap;gap:6px}',
  '.fll-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:12px;',
  'font-weight:600;background:var(--bg2);border:1px solid var(--line);color:var(--mut);cursor:pointer;',
  'transition:.14s}',
  '.fll-chip:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-chip.on{background:var(--acc);border-color:var(--acc);color:#fff}',
  /* Chip không còn dòng nào khớp trong ngữ cảnh hiện tại: vẫn bấm được nhưng không đòi nhìn. */
  '.fll-chip.dim{opacity:.42}',
  /* Phiên không thấy điểm bắt đầu: viền đứt ở mép trái, đọc ra là "đoạn này bị cắt cụt đầu". Cố ý
     KHÔNG tô accent — accent để dành riêng cho thanh bộ lọc. */
  '.fll-chip-orphan{border-left-style:dashed;border-left-width:2px;border-left-color:var(--mut)}',
  '.fll-chip.dim:hover{opacity:1}',
  '.fll-chip em{font-style:normal;opacity:.75;font-variant-numeric:tabular-nums}',
  '.fll-sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto}',

  /* ---------- bảng xếp hạng có thanh ngang ---------- */
  '.fll-rank{display:flex;flex-direction:column;gap:4px}',
  '.fll-rk{position:relative;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;',
  'background:var(--bg2);border:1px solid transparent;cursor:pointer;overflow:hidden;transition:.14s}',
  '.fll-rk:hover{border-color:var(--acc)}',
  '.fll-rk u{position:absolute;left:0;top:0;bottom:0;background:rgba(255,46,136,.16);text-decoration:none}',
  '.fll-rk span{position:relative;flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-rk b{position:relative;font-size:12.5px;color:var(--mut);font-variant-numeric:tabular-nums}',

  /* ---------- thẻ nhóm vấn đề ---------- */
  '.fll-grp{border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:11px;',
  'background:var(--bg2);padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:.14s}',
  '.fll-grp:hover{border-color:var(--acc);border-left-color:var(--acc);background:var(--bg3)}',
  '.fll-grp.err{border-left-color:var(--err)}',
  '.fll-grp-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.fll-cnt{font-size:12.5px;font-weight:800;padding:2px 9px;border-radius:20px;background:rgba(255,182,72,.16);',
  'color:var(--warn);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-grp.err .fll-cnt{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-mod{font-size:11px;font-weight:650;color:var(--info);background:rgba(88,196,255,.12);padding:2px 8px;',
  'border-radius:6px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-when{margin-left:auto;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-msg{font-family:var(--mono);font-size:12.5px;line-height:1.55;color:#cfc8dd;word-break:break-word;',
  'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  '.fll-spark{display:flex;align-items:flex-end;gap:1px;height:15px;margin-top:9px}',
  '.fll-spark i{flex:1;min-width:1px;background:var(--bg3);border-radius:1px}',

  /* ---------- HTTP ---------- */
  '.fll-call{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;background:var(--bg2);',
  'border:1px solid transparent;margin-bottom:5px;cursor:pointer;transition:.14s}',
  '.fll-call:hover{border-color:var(--acc)}',
  '.fll-verb{font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 6px;border-radius:5px;',
  'background:var(--bg3);color:var(--mut);flex:0 0 auto;width:50px;text-align:center}',
  '.fll-st{font-size:11px;font-weight:700;padding:3px 7px;border-radius:5px;flex:0 0 auto;',
  'background:rgba(61,220,151,.14);color:var(--ok);font-variant-numeric:tabular-nums}',
  '.fll-st.bad{background:rgba(255,95,109,.16);color:var(--err)}',
  '.fll-st.wait{background:rgba(255,182,72,.16);color:var(--warn)}',
  '.fll-path{flex:1;min-width:0;font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;',
  'white-space:nowrap;direction:rtl}',
  '.fll-dur{font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- đường thời gian ---------- */
  '.fll-tl{position:relative;padding-left:26px}',
  '.fll-tl:before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:1px;background:var(--line)}',
  '.fll-ev{position:relative;padding:9px 12px;margin-bottom:6px;border-radius:9px;background:var(--bg2);',
  'cursor:pointer;border:1px solid transparent;transition:.14s}',
  '.fll-ev:hover{border-color:var(--acc)}',
  /* Chấm tròn màu ở lề trái đã bỏ: màu không tự nói ra nghĩa, người đọc phải nhớ "hồng là chạm, xanh
     là màn hình" — không ai nhớ. Nay biểu tượng nằm trong thẻ, kèm title và một hàng chú giải ở trên. */
  '.fll-ev:before{content:"";position:absolute;left:-18px;top:17px;width:5px;height:5px;border-radius:50%;',
  'background:var(--line)}',
  /* Biểu tượng nằm THẲNG TRÊN đường thời gian chứ không trong thẻ: nhìn dọc một cột là quét được cả
     chuỗi sự kiện. Vẫn là một thẻ thật (không phải :before) nên mang được title = tên loại mốc.
     Nền đục để nó đè lên nét kẻ của đường thời gian chạy bên dưới. */
  '.fll-ev-ic{position:absolute;left:-28px;top:6px;width:21px;height:21px;text-align:center;',
  'font-size:15.5px;line-height:21px;border-radius:50%;background:var(--bg);',
  'font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
  '.fll-chip-ic{font-style:normal;font-size:14.5px;line-height:1;',
  'font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
  '.fll-ev-t{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600}',
  '.fll-ev-t em{margin-left:auto;font-style:normal;font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}',
  '.fll-ev-d{font-size:12px;color:var(--mut);margin-top:4px;font-family:var(--mono);overflow:hidden;',
  'text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- hành trình ---------- */
  /* Dùng lại khung .fll-tl/.fll-ev của Timeline, chỉ đổi màu chấm theo loại thao tác. */
  '.fll-ev.jr-saw{border-left:2px solid var(--warn)}',
  '.fll-ev.jr-fail{border-left:2px solid var(--err)}',
  '.fll-jms{font-size:10.5px;font-weight:700;color:var(--warn);background:rgba(255,182,72,.14);',
  'padding:1px 6px;border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
  '.fll-jn{font-size:10.5px;font-weight:800;color:var(--mut);background:var(--bg3);padding:1px 6px;',
  'border-radius:20px;font-variant-numeric:tabular-nums;flex:0 0 auto}',

  /* ---------- form lọc ---------- */
  '.fll-in{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);',
  'color:var(--txt);font-size:13.5px;font-family:var(--mono);transition:.14s}',
  '.fll-in::placeholder{color:#6d6580}',
  '.fll-in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,46,136,.14)}',
  '.fll-in.bad{border-color:var(--err)}',
  '.fll-hint{font-size:12px;line-height:1.55;color:var(--mut)}',
  '.fll-hint b{font-weight:650}',
  '.fll-btn{padding:9px 15px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);',
  'font-size:13px;font-weight:650;cursor:pointer;transition:.14s}',
  '.fll-btn:hover{border-color:var(--acc);background:var(--bg3)}',
  '.fll-btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}',
  '.fll-btn.pri:hover{filter:brightness(1.12)}',
  '.fll-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.fll-empty{text-align:center;padding:40px 16px;color:var(--mut);font-size:13.5px}',

  /* ---------- thanh điều hướng dưới cùng ---------- */
  /* Chừa padding-right rộng hơn để nút ">" không nằm dưới tay nắm kéo góc. */
  /* Thanh này nằm dưới cùng nên dễ bị bỏ qua, mà luôn hiển thị lại tốn chỗ khi không có việc.
     Nay chỉ hiện khi thật sự có danh sách dòng để duyệt — việc nó XUẤT HIỆN chính là lời giới thiệu.
     [hidden] phải ghi rõ vì display:flex bên dưới sẽ đè lên mặc định của thuộc tính hidden. */
  '.fll-ft[hidden]{display:none}',
  '.fll-ft{display:flex;align-items:center;gap:6px;padding:9px 30px 9px 8px;',
  'border-top:1px solid var(--line);background:linear-gradient(0deg,#241f31,#1a1723);flex:0 0 auto;',
  'transition:background .18s,border-color .18s}',
  '.fll-ft{border-top:2px solid var(--acc);background:linear-gradient(0deg,#2c2235,#221b2c)}',
  '.fll-ft .fll-info{flex:1;min-width:0;font-size:12.5px;color:var(--mut);display:flex;align-items:center;',
  'gap:6px;overflow:hidden}',
  '.fll-ft .fll-info b{color:var(--txt);font-weight:650;font-variant-numeric:tabular-nums}',
  '.fll-ft-tag{flex:0 0 auto;font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;',
  'color:var(--acc);background:rgba(255,46,136,.14);padding:2px 5px;border-radius:20px}',
  '.fll-ft-pos{flex:0 0 auto;font-size:13.5px}',
  '.fll-ft-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fll-ft-line{flex:0 0 auto;color:var(--mut)}',

  /* Nút duyệt: trước chỉ là mũi tên 28px không nhãn, người dùng không biết có phím tắt.
     Nay đeo luôn chữ phím ngay trên nút. */
  '.fll-nav{display:flex;align-items:center;gap:3px;padding:5px 7px;border-radius:8px;',
  'border:1px solid var(--line);background:var(--bg2);color:var(--mut);font-size:11px;cursor:pointer;',
  'transition:.14s;flex:0 0 auto}',
  '.fll-nav em{font-style:normal;font-size:10.5px;font-weight:800;background:var(--bg3);color:var(--mut);',
  'padding:1px 5px;border-radius:4px}',
  '.fll-nav{color:var(--txt);border-color:rgba(255,46,136,.4)}',
  '.fll-nav em{background:rgba(255,46,136,.18);color:var(--acc)}',
  '.fll-nav:hover{border-color:var(--acc);color:var(--txt)}',
  '.fll-ft-flash{animation:fll-ftflash .55s ease-out}',
  '@keyframes fll-ftflash{0%{background:rgba(255,46,136,.32)}100%{background:linear-gradient(0deg,#2c2235,#221b2c)}}',

  /* ---------- pill khi thu nhỏ ---------- */
  '.fll-pill{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:9px;padding:11px 18px;',
  'border-radius:24px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:13.5px;',
  'font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.42);transition:.16s;',
  'animation:fll-in .18s cubic-bezier(.2,.9,.3,1)}',
  '.fll-pill:hover{transform:translateY(-2px);border-color:var(--acc)}',
  '.fll-pill b{color:var(--err);font-weight:750;font-variant-numeric:tabular-nums}',

  /* ---------- style bơm vào bảng log của trang ---------- */
  /* Lọc bằng một class trên container + đánh dấu dòng được giữ, thay vì ẩn từng dòng bị loại. */
  '.fll-filtering > [class*="logRow"]:not(.fll-keep){display:none!important}',
  /* Chế độ đảo: lọc rộng thì đánh dấu dòng BỊ LOẠI cho ít thao tác hơn. */
  '.fll-dropping > [class*="logRow"].fll-drop{display:none!important}',
  '.fll-hit{background:rgba(255,46,136,.22)!important;outline:2px solid #ff2e88!important;outline-offset:-2px;',
  'border-radius:3px;animation:fll-flash .9s ease-out}',
  '@keyframes fll-flash{0%{background:rgba(255,46,136,.6)!important}100%{background:rgba(255,46,136,.22)!important}}',
].join('');
