// @ts-check
// phát hiện một khối dòng bị lặp lại nguyên xi trong log
//
// Vì sao cần: một log feedback production thật (autoId 45490371) dài 4222 dòng hoá ra là 2111 dòng đầu
// LẶP LẠI Y HỆT — md5 hai nửa bằng nhau, chỗ nối nằm ngay sau một dòng "LOGGER: END OF BATCH". Tool
// không biết chuyện đó nên đếm gấp đôi MỌI THỨ: mọi nhóm lỗi, mọi call HTTP, mọi event tracker. Đọc
// "lỗi này xảy ra 4 lần" trong khi thật ra 2 lần là đọc sai hẳn vấn đề.
//
// Cách tìm: mỗi dòng trùng nhau sinh ra một "phiếu" cho độ lệch giữa hai lần xuất hiện. Log bị nối đôi
// sẽ dồn gần hết phiếu vào ĐÚNG MỘT độ lệch (2111). Sau đó xác minh bằng cách đếm chuỗi liên tiếp
// dài nhất khớp theo độ lệch đó — trùng ngẫu nhiên vài dòng lẻ tẻ thì không tạo được chuỗi dài.
//
// Cố ý KHÔNG tự động bỏ khối lặp: báo trước, để người đọc bấm. Khử nhầm một khối không lặp thì số liệu
// cũng sai, chỉ là sai theo hướng khác — mà lúc đó không còn dấu hiệu nào để nhận ra.

// Dưới ngưỡng này coi như trùng ngẫu nhiên: log sạch nhất trong ba log thật có chuỗi lặp dài nhất
// 8 dòng (các dòng định kỳ như heartbeat, "END OF BATCH"). 40 là cách xa ngưỡng đó.
const DUPLICATE_MIN_RUN = 40;
// Dòng quá ngắn (dấu phân cách, dòng trống) trùng nhau là chuyện bình thường, không tính phiếu.
const DUPLICATE_MIN_LINE = 24;

function tallyDuplicateOffsets(entries) {
  const firstSeen = new Map();
  const offsets = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const raw = entries[index].raw;
    if (!raw || raw.length < DUPLICATE_MIN_LINE) continue;
    const first = firstSeen.get(raw);
    if (first === undefined) {
      firstSeen.set(raw, index);
      continue;
    }
    const offset = index - first;
    offsets.set(offset, (offsets.get(offset) || 0) + 1);
  }
  return offsets;
}

// Độ lệch được nhiều phiếu nhất mới là ứng viên; còn lại là trùng lẻ tẻ.
function bestDuplicateOffset(offsets) {
  let best = 0;
  let bestVotes = 0;
  offsets.forEach((votes, offset) => {
    if (votes > bestVotes) {
      bestVotes = votes;
      best = offset;
    }
  });
  return { offset: best, votes: bestVotes };
}

// Chuỗi liên tiếp dài nhất mà entries[i] giống hệt entries[i - offset].
//
// Dòng ngắn (dòng trống, dòng phân cách) là TRUNG TÍNH: không tính là khớp, nhưng cũng không cắt đứt
// chuỗi. Đo thật: coi chúng là cắt đứt thì khối lặp 2111 dòng của log production chỉ nhận ra được 491
// dòng, vì cứ vài chục dòng lại có một dòng trống xen vào.
function longestRunAtOffset(entries, offset) {
  let runStart = -1;
  let runCount = 0;
  let best = { count: 0, start: -1, end: -1 };
  for (let index = offset; index < entries.length; index += 1) {
    const raw = entries[index].raw;
    if (!raw || raw.length < DUPLICATE_MIN_LINE) continue;
    if (raw !== entries[index - offset].raw) {
      runStart = -1;
      runCount = 0;
      continue;
    }
    if (runStart < 0) runStart = index;
    runCount += 1;
    if (runCount > best.count) best = { count: runCount, start: runStart, end: index };
  }
  return best;
}

function findDuplicateBlock(entries) {
  if (!entries || entries.length < DUPLICATE_MIN_RUN * 2) return null;
  const { offset, votes } = bestDuplicateOffset(tallyDuplicateOffsets(entries));
  if (!offset || votes < DUPLICATE_MIN_RUN) return null;
  const run = longestRunAtOffset(entries, offset);
  if (run.count < DUPLICATE_MIN_RUN) return null;
  const from = run.start;
  const to = run.end;
  return {
    offset,
    from,
    to,
    // length = cả đoạn bị lặp (kể cả dòng trống xen giữa); matched = số dòng thật sự khớp từng ký tự.
    length: to - from + 1,
    matched: run.count,
    lineFrom: entries[from].lineNo,
    lineTo: entries[to].lineNo,
    sourceLineFrom: entries[from - offset].lineNo,
  };
}

// Đánh dấu trên từng entry để bộ lọc và thống kê đọc được. Trả về chính thông tin khối để gắn vào data.
function markDuplicateEntries(entries) {
  const block = findDuplicateBlock(entries);
  if (!block) return null;
  for (let index = block.from; index <= block.to; index += 1) entries[index].isDuplicate = true;
  return block;
}
