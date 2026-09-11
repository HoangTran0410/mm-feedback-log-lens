// @ts-check
// di chuột qua một mục bất kỳ: vẽ mũi tên từ mục đó lên đúng vị trí của nó trên minimap
//
// Vấn đề: mỗi hàng trong mỗi tab đều có giờ và số dòng, nhưng đó là CON SỐ. Người đọc phải tự dịch
// "10:02:50" ra "khoảng giữa log" mới biết nó nằm ở đâu trong cả phiên. Minimap ngay trên đầu đã là
// trục thời gian rồi — chỉ thiếu một đường nối giữa hai cái.
//
// Vẽ bằng MỘT lớp SVG phủ lên cả panel (pointer-events:none) chứ không chèn thẻ vào từng hàng: như vậy
// không renderer nào phải biết đến chuyện này, và tab mới thêm sau này tự động có luôn.

const AIM_SELECTOR = '[data-aim],[data-lines],[data-jump],[data-bucket],[data-group],[data-call],' +
  '[data-saw],[data-apifail],[data-jscreen],[data-jtap],[data-jload],[data-tracefail]';
// Một nhóm lỗi có thể có hàng trăm dòng. Vẽ hết thì minimap thành một mảng đỏ đặc, nhìn không ra gì;
// 60 vạch đã đủ dày để thấy "rải đều" hay "dồn một chỗ".
const AIM_MAX_TICKS = 60;

// Cùng một cách đọc như handleLensClick — một hàng trỏ tới những dòng nào thì mũi tên chỉ tới đúng
// những dòng đó. Tách ra hàm riêng để test gọi được mà không cần DOM thật.
function aimIndicesFor(el) {
  const view = getView();
  const data = el.dataset;
  // data-aim = "phần tử này trỏ tới những dòng này, nhưng BẤM vào nó lại làm việc khác". Chip phiên app
  // là ca duy nhất đang dùng: bấm vào là lọc theo phiên, còn rê chuột thì vẫn phải chỉ được ra chỗ
  // phiên đó bắt đầu trên minimap. Vì vậy nó KHÔNG nằm trong danh sách của handleLensClick — thêm vào
  // đó là cú bấm biến thành lệnh nhảy dòng và mất luôn bộ lọc.
  if (data.aim != null) return data.aim.split(',').map(Number).filter((index) => !Number.isNaN(index));
  // data-lines đi trước data-jump: hàng ứng với nhiều dòng (nhóm lỗi, hai đầu một khoảng lặng) thì mũi
  // tên phải đánh dấu hết, không chỉ dòng đầu.
  if (data.lines != null) return data.lines.split(',').map(Number).filter((index) => !Number.isNaN(index));
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
  // Không đặt viewBox: không có viewBox thì một đơn vị của SVG = một px CSS, nên toạ độ lấy từ
  // getBoundingClientRect dùng thẳng được, không phải quy đổi.
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
  // Trả dòng chữ giữa nhãn minimap về đúng trạng thái bộ lọc hiện tại.
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
  // Hàng bị cuộn khuất lên trên minimap thì mũi tên sẽ đâm ngược — thôi không vẽ.
  if (itemRect.top < mapRect.bottom + 4 || itemRect.bottom > panelRect.bottom) {
    svg.classList.remove('on');
    return;
  }

  const mapTop = mapRect.top - panelRect.top;
  const endX = minimapClientXFromTs(timed[0].ts) - panelRect.left;
  const endY = mapRect.bottom - panelRect.top;
  // Bắt đầu từ mép TRÁI của hàng chứ không phải tâm: hàng rộng cả panel, lấy tâm thì đường kẻ mọc ra
  // từ giữa một dòng chữ, nhìn như không dính vào đâu cả.
  const startX = Math.min(itemRect.left + 18, itemRect.right - 8) - panelRect.left;
  const startY = itemRect.top - panelRect.top;
  const lift = Math.max(16, (startY - endY) * 0.45);

  svg.querySelector('.fll-aim-line').setAttribute('d',
    'M' + startX.toFixed(1) + ' ' + startY.toFixed(1) +
    ' C' + startX.toFixed(1) + ' ' + (startY - lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + (endY + lift).toFixed(1) +
    ',' + endX.toFixed(1) + ' ' + endY.toFixed(1));
  // Mũi tên quay lên và nằm BÊN TRONG minimap. Trước đó nó chạm ở mép dưới minimap nên đè lên dòng
  // nhãn giờ ngay bên dưới (dòng nhãn chỉ cao ~14px) — thấy khi chụp màn hình.
  svg.querySelector('.fll-aim-head').setAttribute('points',
    endX.toFixed(1) + ',' + (endY - 9).toFixed(1) + ' ' +
    (endX - 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1) + ' ' +
    (endX + 4.5).toFixed(1) + ',' + (endY - 1).toFixed(1));
  svg.querySelector('.fll-aim-ticks').innerHTML = timed.slice(0, AIM_MAX_TICKS)
    .map((entry, index) => {
      const x = minimapClientXFromTs(entry.ts) - panelRect.left;
      // Vạch đầu tiên là cái mũi tên đang chỉ tới: to và đậm hơn những vạch còn lại.
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

// Cuộn thì hàng di chuyển mà chuột không đổi -> mouseover không bắn lại. Vẽ lại theo sự kiện cuộn
// (bắt ở pha capture vì 'scroll' không nổi bọt lên).
function handleAimScroll() {
  if (lensState.aimEl) drawAim(lensState.aimEl);
}
