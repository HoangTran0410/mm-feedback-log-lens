/*
File: src/02h-duplicate.js
Created At: 2026-09-11 00:30:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// @ts-check
// AI-GENERATED START — phat hien mot khoi dong bi lap lai nguyen xi trong log
//
// Vi sao can: mot log feedback production that (autoId 45490371) dai 4222 dong hoa ra la 2111 dong dau
// LAP LAI Y HET — md5 hai nua bang nhau, cho noi nam ngay sau mot dong "LOGGER: END OF BATCH". Tool
// khong biet chuyen do nen dem gap doi MOI THU: moi nhom loi, moi call HTTP, moi event tracker. Doc
// "loi nay xay ra 4 lan" trong khi that ra 2 lan la doc sai han van de.
//
// Cach tim: moi dong trung nhau sinh ra mot "phieu" cho do lech giua hai lan xuat hien. Log bi noi doi
// se do don gan het phieu vao DUNG MOT do lech (2111). Sau do xac minh bang cach dem chuoi lien tiep
// dai nhat khop theo do lech do — trung ngau nhien vai dong le te thi khong tao duoc chuoi dai.
//
// Co y KHONG tu dong bo khoi lap: bao truoc, de nguoi doc bam. Khu nham mot khoi khong lap thi so lieu
// cung sai, chi la sai theo huong khac — ma luc do khong con dau hieu nao de nhan ra.

// Duoi nguong nay coi nhu trung ngau nhien: log sach nhat trong ba log that co chuoi lap dai nhat
// 8 dong (cac dong dinh ky nhu heartbeat, "END OF BATCH"). 40 la cach xa nguong do.
const DUPLICATE_MIN_RUN = 40;
// Dong qua ngan (dau phan cach, dong trong) trung nhau la chuyen binh thuong, khong tinh phieu.
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

// Do lech duoc nhieu phieu nhat moi la ung vien; con lai la trung le te.
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

// Chuoi lien tiep dai nhat ma entries[i] giong het entries[i - offset].
//
// Dong ngan (dong trong, dong phan cach) la TRUNG TINH: khong tinh la khop, nhung cung khong cat dut
// chuoi. Do that: coi chung la cat dut thi khoi lap 2111 dong cua log production chi nhan ra duoc 491
// dong, vi cu vai chuc dong lai co mot dong trong xen vao.
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
    // length = ca doan bi lap (ke ca dong trong xen giua); matched = so dong that su khop tung ky tu.
    length: to - from + 1,
    matched: run.count,
    // Khoi goc ma khoi tren lap lai — de nguoi doc nhay toi doi chieu.
    sourceFrom: from - offset,
    lineFrom: entries[from].lineNo,
    lineTo: entries[to].lineNo,
    sourceLineFrom: entries[from - offset].lineNo,
  };
}

// Danh dau tren tung entry de bo loc va thong ke doc duoc. Tra ve chinh thong tin khoi de gan vao data.
function markDuplicateEntries(entries) {
  const block = findDuplicateBlock(entries);
  if (!block) return null;
  for (let index = block.from; index <= block.to; index += 1) entries[index].isDuplicate = true;
  return block;
}
// AI-GENERATED END
