/*
File: src/03h-aim.js
Created At: 2026-09-10 18:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — di chuot qua mot muc bat ky: ve mui ten tu muc do len dung vi tri cua no tren minimap
//
// Van de: moi hang trong moi tab deu co gio va so dong, nhung do la CON SO. Nguoi doc phai tu dich
// "10:02:50" ra "khoang giua log" moi biet no nam o dau trong ca phien. Minimap ngay tren dau da la
// truc thoi gian roi — chi thieu mot duong noi giua hai cai.
//
// Ve bang MOT lop SVG phu len ca panel (pointer-events:none) chu khong chen the vao tung hang: nhu vay
// khong renderer nao phai biet den chuyen nay, va tab moi them sau nay tu dong co luon.

const AIM_SELECTOR = '[data-aim],[data-jump],[data-bucket],[data-group],[data-call],[data-saw],' +
  '[data-apifail],[data-jscreen],[data-jtap],[data-jload],[data-tracefail]';
// Mot nhom loi co the co hang tram dong. Ve het thi minimap thanh mot mang do dac, nhin khong ra gi;
// 60 vach da du day de thay "rai deu" hay "dom mot cho".
const AIM_MAX_TICKS = 60;

// Cung mot cach doc nhu handleLensClick — mot hang tro toi nhung dong nao thi mui ten chi toi dung
// nhung dong do. Tach ra ham rieng de test goi duoc ma khong can DOM that.
function aimIndicesFor(el) {
  const view = getView();
  const data = el.dataset;
  // data-aim di truoc data-jump: co nhung hang tro toi mot KHOANG (khoang lang co dau va cuoi) trong
  // khi cu bam thi chi nhay toi mot dong. Mui ten phai danh dau ca khoang do.
  if (data.aim != null) return data.aim.split(',').map(Number).filter((index) => !Number.isNaN(index));
  if (data.jump != null) return [Number(data.jump)];
  if (data.bucket != null) return Number(data.bucket) >= 0 ? [Number(data.bucket)] : [];
  if (data.group != null) {
    const group = view.groups[Number(data.group)];
    return group ? group.indices : [];
  }
  if (data.call != null) {
    const call = view.httpCalls[Number(data.call)];
    return call ? [call.reqIndex, call.resIndex].filter((index) => index != null) : [];
  }
  if (data.saw != null) {
    const row = view.journey.saw[Number(data.saw)];
    return row ? row.indices : [];
  }
  if (data.apifail != null) {
    const row = view.journey.fails[Number(data.apifail)];
    return row ? row.indices : [];
  }
  if (data.tracefail != null) {
    const row = view.traceIssues.fails[Number(data.tracefail)];
    return row ? row.indices : [];
  }
  if (data.jscreen != null) {
    const row = view.journey.screens.find((item) => item.key === data.jscreen);
    return row ? row.indices : [];
  }
  if (data.jtap != null) {
    const row = view.journey.taps.find((item) => item.key === data.jtap);
    return row ? row.indices : [];
  }
  if (data.jload != null) {
    const row = view.journey.screenLoads.find((item) => item.key === data.jload);
    return row ? row.indices : [];
  }
  return [];
}

function ensureAimLayer() {
  const panel = lensState.el.panel;
  if (!panel) return null;
  if (lensState.el.aim && lensState.el.aim.parentNode === panel) return lensState.el.aim;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fll-aim');
  // Khong dat viewBox: khong co viewBox thi mot don vi cua SVG = mot px CSS, nen toa do lay tu
  // getBoundingClientRect dung thang duoc, khong phai quy doi.
  svg.innerHTML = '<g class="fll-aim-ticks"></g><path class="fll-aim-line"></path>' +
    '<polygon class="fll-aim-head"></polygon>';
  panel.appendChild(svg);
  lensState.el.aim = svg;
  return svg;
}

function hideAim() {
  const previous = lensState.aimEl;
  lensState.aimEl = null;
  if (previous && previous.classList) previous.classList.remove('fll-aimed');
  if (lensState.el.aim) lensState.el.aim.classList.remove('on');
  if (lensState.el.mapText) lensState.el.mapText.classList.remove('aiming');
  // Tra dong chu giua nhan minimap ve dung trang thai bo loc hien tai.
  if (lensState.data && lensState.el.mapText) updateMinimapRange();
}

function drawAim(el) {
  const panel = lensState.el.panel;
  const map = lensState.el.map;
  if (!panel || !map || !lensState.data || !el.isConnected) return;
  const entries = lensState.data.entries;
  const timed = aimIndicesFor(el)
    .map((index) => entries[index])
    .filter((entry) => entry && entry.ts);
  if (!timed.length) return;

  const svg = ensureAimLayer();
  if (!svg) return;
  const panelRect = panel.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const itemRect = el.getBoundingClientRect();
  // Hang bi cuon khuat len tren minimap thi mui ten se dam nguoc — thoi khong ve.
  if (itemRect.top < mapRect.bottom + 4 || itemRect.bottom > panelRect.bottom) {
    svg.classList.remove('on');
    return;
  }

  const mapTop = mapRect.top - panelRect.top;
  const endX = minimapClientXFromTs(timed[0].ts) - panelRect.left;
  const endY = mapRect.bottom - panelRect.top;
  // Bat dau tu mep TRAI cua hang chu khong phai tam: hang rong ca panel, lay tam thi duong ke moc ra
  // tu giua mot dong chu, nhin nhu khong dinh vao dau ca.
  const startX = Math.min(itemRect.left + 18, itemRect.right - 8) - panelRect.left;
  const startY = itemRect.top - panelRect.top;
  const lift = Math.max(16, (startY - endY) * 0.45);

  svg.querySelector('.fll-aim-line').setAttribute('d',
    'M' + startX.toFixed(1) + ' ' + startY.toFixed(1) +
    ' C' + startX.toFixed(1) + ' ' + (startY - lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + (endY + lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + endY.toFixed(1));
  // Mui ten quay len va nam BEN TRONG minimap. Truoc do no cham o mep duoi minimap nen de len dong
  // nhan gio ngay ben duoi (dong nhan chi cao ~14px) — thay khi chup man hinh.
  svg.querySelector('.fll-aim-head').setAttribute('points',
    endX.toFixed(1) + ',' + (endY - 9).toFixed(1) + ' ' +
    (endX - 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1) + ' ' +
    (endX + 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1));
  svg.querySelector('.fll-aim-ticks').innerHTML = timed.slice(0, AIM_MAX_TICKS)
    .map((entry, index) => {
      const x = minimapClientXFromTs(entry.ts) - panelRect.left;
      // Vach dau tien la cai mui ten dang chi toi: to va dam hon nhung vach con lai.
      const width = index === 0 ? 3 : 2;
      return '<rect class="' + (index === 0 ? 'fll-aim-first' : '') + '" x="' +
        (x - width / 2).toFixed(1) + '" y="' + mapTop.toFixed(1) +
        '" width="' + width + '" height="' + mapRect.height.toFixed(1) + '"></rect>';
    })
    .join('');
  svg.classList.add('on');

  if (lensState.el.mapText) {
    lensState.el.mapText.textContent = formatClock(timed[0].ts) +
      (timed.length > 1 ? ' · ' + timed.length + ' dòng' : ' · dòng ' + timed[0].lineNo);
    lensState.el.mapText.classList.add('aiming');
  }
}

function handleLensHover(event) {
  const target = event.target;
  const hit = target && target.closest ? target.closest(AIM_SELECTOR) : null;
  if (hit === lensState.aimEl) return;
  hideAim();
  if (!hit) return;
  lensState.aimEl = hit;
  hit.classList.add('fll-aimed');
  drawAim(hit);
}

// Cuon thi hang di chuyen ma chuot khong doi -> mouseover khong ban lai. Ve lai theo su kien cuon
// (bat o pha capture vi 'scroll' khong noi bot len).
function handleAimScroll() {
  if (lensState.aimEl) drawAim(lensState.aimEl);
}
// AI-GENERATED END
