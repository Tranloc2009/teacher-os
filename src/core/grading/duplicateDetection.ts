import type {
  DuplicateGroup,
  DuplicateReason,
  DuplicateResolutionAction,
  DuplicateResolutionEntry,
  GradedSheetRecord,
} from '../../types/grading';
import { hammingDistanceHex64 } from './cameraFrameAssist';

export const DEFAULT_DHASH_DUPLICATE_THRESHOLD = 8;

function getOpticalPayloadKey(sheet: GradedSheetRecord): string | null {
  const payload = sheet.alignment.opticalCodePayload;
  if (!payload || sheet.alignment.opticalCodeStatus !== 'decoded') return null;
  if (!payload.st && !payload.sh) return null;
  return `${payload.sid}|${payload.ec}|${payload.st ?? ''}|${payload.sh ?? ''}|${payload.p}`;
}

export function getDuplicateReasonLabelVi(reason: DuplicateReason): string {
  switch (reason) {
    case 'same-sheet-id':
      return 'Trùng mã phiếu (Sheet ID)';
    case 'same-optical-code':
      return 'Trùng mã định danh quang học (QR/2D)';
    case 'same-student-id':
      return 'Cùng học sinh có nhiều bài trong phiên';
    case 'similar-image-hash':
      return 'Ảnh chụp gần giống hệt nhau';
  }
}

/**
 * Phát hiện tất cả nhóm phiếu trùng trong các phiếu đang hoạt động (chưa lưu trữ ẩn):
 * 1. Trùng mã quang học (QR/2D có cùng mã phiếu/học sinh)
 * 2. Cùng một học sinh (studentId) xuất hiện nhiều hơn 1 phiếu trong phiên
 * 3. Ảnh chụp gần giống hệt nhau (khoảng cách Hamming dHash <= ngưỡng)
 * TUYỆT ĐỐI không tự động xóa phiếu nào.
 */
export function detectDuplicateGroups(
  sheets: GradedSheetRecord[],
  dHashThreshold = DEFAULT_DHASH_DUPLICATE_THRESHOLD
): DuplicateGroup[] {
  const activeSheets = sheets.filter((s) => !s.archivedByDuplicateResolution);
  if (activeSheets.length < 2) return [];

  const groups: DuplicateGroup[] = [];
  const coveredPairs = new Set<string>();

  const pairKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`);
  const markGroupPairs = (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        coveredPairs.add(pairKey(ids[i], ids[j]));
      }
    }
  };

  // 1. Duplicate optical QR/2D payload
  const byOptical = new Map<string, GradedSheetRecord[]>();
  for (const s of activeSheets) {
    const key = getOpticalPayloadKey(s);
    if (!key) continue;
    const list = byOptical.get(key) ?? [];
    list.push(s);
    byOptical.set(key, list);
  }
  byOptical.forEach((list, opticalKey) => {
    if (list.length > 1) {
      const ids = list.map((s) => s.id);
      markGroupPairs(ids);
      groups.push({
        id: `dup-qr-${opticalKey}`,
        reason: 'same-optical-code',
        reasonLabel: getDuplicateReasonLabelVi('same-optical-code'),
        sheetIds: ids,
        studentId: list[0].studentId || undefined,
        opticalKey,
      });
    }
  });

  // 2. Same studentId in same session
  const byStudent = new Map<string, GradedSheetRecord[]>();
  for (const s of activeSheets) {
    const sid = s.studentId.trim().toUpperCase();
    if (!sid) continue;
    const list = byStudent.get(sid) ?? [];
    list.push(s);
    byStudent.set(sid, list);
  }
  byStudent.forEach((list, sid) => {
    if (list.length > 1) {
      const ids = list.map((s) => s.id);
      const allAlreadyCovered = ids.every((idA, idx) =>
        ids.slice(idx + 1).every((idB) => coveredPairs.has(pairKey(idA, idB)))
      );
      if (!allAlreadyCovered) {
        markGroupPairs(ids);
        groups.push({
          id: `dup-student-${sid}`,
          reason: 'same-student-id',
          reasonLabel: getDuplicateReasonLabelVi('same-student-id'),
          sheetIds: ids,
          studentId: sid,
        });
      }
    }
  });

  // 3. Near-identical image content via perceptual dHash
  const visitedHashIds = new Set<string>();
  for (let i = 0; i < activeSheets.length; i += 1) {
    const a = activeSheets[i];
    if (!a.imageDHash || visitedHashIds.has(a.id)) continue;
    const cluster: GradedSheetRecord[] = [a];
    let minDist = 64;
    for (let j = i + 1; j < activeSheets.length; j += 1) {
      const b = activeSheets[j];
      if (!b.imageDHash || coveredPairs.has(pairKey(a.id, b.id))) continue;
      const dist = hammingDistanceHex64(a.imageDHash, b.imageDHash);
      if (dist <= dHashThreshold) {
        cluster.push(b);
        visitedHashIds.add(b.id);
        minDist = Math.min(minDist, dist);
      }
    }
    if (cluster.length > 1) {
      visitedHashIds.add(a.id);
      const ids = cluster.map((s) => s.id);
      markGroupPairs(ids);
      groups.push({
        id: `dup-img-${ids.join('_')}`,
        reason: 'similar-image-hash',
        reasonLabel: getDuplicateReasonLabelVi('similar-image-hash'),
        sheetIds: ids,
        studentId: cluster[0].studentId || undefined,
        hammingDistance: minDist,
      });
    }
  }

  return groups;
}

/**
 * Áp dụng lựa chọn xử lý phiếu trùng của giáo viên.
 * TUYỆT ĐỐI không xóa cứng dữ liệu; chỉ đánh dấu lưu trữ ẩn hoặc cần chụp lại và ghi lịch sử thay thế.
 */
export function applyDuplicateResolution(
  sheets: GradedSheetRecord[],
  group: DuplicateGroup,
  action: DuplicateResolutionAction,
  note?: string
): {
  sheets: GradedSheetRecord[];
  historyEntry: DuplicateResolutionEntry;
} {
  const now = new Date().toISOString();
  const groupSet = new Set(group.sheetIds);
  const groupSheets = sheets
    .filter((s) => groupSet.has(s.id))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

  const oldest = groupSheets[0];
  const newest = groupSheets[groupSheets.length - 1];

  let keptSheetId: string | undefined;
  let nextSheets: GradedSheetRecord[];

  if (action === 'keep-new' && newest) {
    keptSheetId = newest.id;
    nextSheets = sheets.map((s) => {
      if (!groupSet.has(s.id)) return s;
      if (s.id === newest.id) {
        return {
          ...s,
          archivedByDuplicateResolution: false,
          retakeRequested: false,
          duplicateStudentWarning: undefined,
          updatedAt: now,
        };
      }
      return {
        ...s,
        archivedByDuplicateResolution: true,
        replacedBySheetId: newest.id,
        updatedAt: now,
      };
    });
  } else if (action === 'keep-old' && oldest) {
    keptSheetId = oldest.id;
    nextSheets = sheets.map((s) => {
      if (!groupSet.has(s.id)) return s;
      if (s.id === oldest.id) {
        return {
          ...s,
          archivedByDuplicateResolution: false,
          retakeRequested: false,
          duplicateStudentWarning: undefined,
          updatedAt: now,
        };
      }
      return {
        ...s,
        archivedByDuplicateResolution: true,
        replacedBySheetId: oldest.id,
        updatedAt: now,
      };
    });
  } else if (action === 'mark-retake') {
    nextSheets = sheets.map((s) => {
      if (!groupSet.has(s.id)) return s;
      return {
        ...s,
        retakeRequested: true,
        status: s.status === 'error' ? 'error' : 'review-required',
        confirmedByTeacher: false,
        updatedAt: now,
      };
    });
  } else {
    // 'keep-both': giáo viên xác nhận giữ cả hai để tự đối chiếu
    nextSheets = sheets.map((s) =>
      groupSet.has(s.id) ? { ...s, updatedAt: now } : s
    );
  }

  const historyEntry: DuplicateResolutionEntry = {
    id: `dupres_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now,
    reason: group.reason,
    action,
    keptSheetId,
    affectedSheetIds: [...group.sheetIds],
    studentId: group.studentId,
    note: note?.trim() || undefined,
  };

  return {
    sheets: nextSheets,
    historyEntry,
  };
}
