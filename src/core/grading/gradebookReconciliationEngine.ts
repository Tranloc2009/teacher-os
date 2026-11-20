import type {
  GradeReconciliationStatus,
  GradebookColumnMapping,
  GradingSession,
  IntelligentGradebookEntry,
  IntelligentGradebookStats,
  OcrGradebookRow,
  OcrTableCell,
  OfficialGradeAuditEntry,
  OfficialScoreSource,
  ParsedScoreResult,
  PhotoGradebookImportRecord,
  StudentRecord,
  StudentRowMatchState,
} from '../../types/grading';

const ABSENT_KEYWORDS = new Set([
  'vang',
  'v',
  'nghi',
  'kp',
  'cp',
  'vangthi',
  'nghithi',
  'absent',
]);

function normalizeViToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

/**
 * Phân tích điểm số chính xác từ ô OCR (§7):
 * - Hỗ trợ dấu phẩy (8,5 / 9,25) và dấu chấm (8.5 / 9.25), điểm 0, điểm 10.
 * - Phân biệt rõ: Điểm 0, Ô trống, Học sinh vắng, Không đọc được, Không chắc chắn, Ngoài thang điểm.
 * - Tuyệt đối KHÔNG biến ô trống thành 0 và KHÔNG tự làm tròn điểm.
 */
export function parseGradebookScoreCell(
  rawText: string,
  confidence = 1,
  maxScore = 10,
  minConfidence = 0.72,
  unreadableFlag = false
): ParsedScoreResult {
  const trimmed = rawText.trim();

  if (trimmed.length === 0 || trimmed === '-' || trimmed === '—') {
    return {
      rawText,
      normalizedText: '',
      status: 'empty',
      numericScore: null,
      confidence,
      needsReview: false,
    };
  }

  const normToken = normalizeViToken(trimmed).replace(/[^a-z0-9]/g, '');
  if (ABSENT_KEYWORDS.has(normToken)) {
    return {
      rawText,
      normalizedText: 'Vắng',
      status: 'absent',
      numericScore: null,
      confidence: Math.max(confidence, 0.85),
      needsReview: false,
    };
  }

  if (unreadableFlag || trimmed.includes('?') || confidence < 0.38) {
    return {
      rawText,
      normalizedText: trimmed,
      status: 'unreadable',
      numericScore: null,
      confidence,
      needsReview: true,
      warning: `Ô điểm "${trimmed}" không đọc được rõ ràng — cần giáo viên nhập hoặc xác nhận thủ công.`,
    };
  }

  // Chuẩn hóa dấu phẩy thập phân sang dấu chấm để kiểm tra số thực chính xác
  const decimalNormalized = trimmed.replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(decimalNormalized)) {
    return {
      rawText,
      normalizedText: trimmed,
      status: 'invalid',
      numericScore: null,
      confidence,
      needsReview: true,
      warning: `Giá trị "${trimmed}" không phải định dạng điểm số hợp lệ.`,
    };
  }

  const numericValue = Number(decimalNormalized);
  if (!Number.isFinite(numericValue)) {
    return {
      rawText,
      normalizedText: trimmed,
      status: 'invalid',
      numericScore: null,
      confidence,
      needsReview: true,
      warning: `Giá trị "${trimmed}" không hợp lệ.`,
    };
  }

  if (numericValue < 0 || numericValue > maxScore) {
    return {
      rawText,
      normalizedText: String(numericValue),
      status: 'invalid',
      numericScore: null,
      confidence,
      needsReview: true,
      warning: `Điểm ${numericValue} nằm ngoài thang điểm hợp lệ [0..${maxScore}] — bắt buộc kiểm tra thủ công.`,
    };
  }

  if (confidence < minConfidence) {
    return {
      rawText,
      normalizedText: String(numericValue),
      status: 'uncertain',
      numericScore: numericValue,
      confidence,
      needsReview: true,
      warning: `Độ tin cậy OCR thấp (${Math.round(confidence * 100)}%) ở điểm "${trimmed}" — cần giáo viên xác nhận.`,
    };
  }

  return {
    rawText,
    normalizedText: String(numericValue),
    status: 'valid',
    numericScore: numericValue,
    confidence,
    needsReview: false,
  };
}

function getEffectiveCellText(cell?: OcrTableCell): string {
  if (!cell) return '';
  return (cell.editedText !== undefined ? cell.editedText : cell.rawText).trim();
}

/**
 * Áp dụng Smart Column Mapping & Student Matching Engine (§6, §8):
 * - Hỗ trợ họ và tên ở 1 cột (`fullName`) hoặc tách 2 cột (`lastName` + `firstName`).
 * - Ưu tiên 1: Khóa định danh đã được giáo viên xác nhận cho dòng đó.
 * - Ưu tiên 2: Mã học sinh (`studentId`) trùng chính xác với Student Roster.
 * - Ưu tiên 3: Tên học sinh chỉ dùng để gợi ý ghép (nếu trùng nhiều học sinh cùng tên -> AMBIGUOUS; nếu gợi ý 1 học sinh nhưng thiếu mã HS -> REVIEW_REQUIRED).
 * - Tuyệt đối không ghép theo thứ tự dòng ảnh và không cho nhiều dòng OCR tự động ghi đè cùng 1 học sinh.
 */
export function applyColumnMappingAndMatchRoster(params: {
  rawRows: Array<{
    id?: string;
    rowIndex: number;
    bbox: { x: number; y: number; width: number; height: number };
    cells: OcrTableCell[];
    confirmedByTeacher?: boolean;
    confirmedAt?: string;
    reviewNote?: string;
  }>;
  columnMappings: GradebookColumnMapping[];
  rosterStudents: StudentRecord[];
  maxScore: number;
  defaultClassName: string;
  teacherConfirmedStudentByRowId?: Record<string, string>;
}): OcrGradebookRow[] {
  const {
    rawRows,
    columnMappings,
    rosterStudents,
    maxScore,
    defaultClassName,
    teacherConfirmedStudentByRowId = {},
  } = params;

  const findColIdx = (role: GradebookColumnMapping['role']): number => {
    const found = columnMappings.find((m) => m.role === role);
    return found ? found.columnIndex : -1;
  };

  const sttCol = findColIdx('stt');
  const idCol = findColIdx('studentId');
  const fullNameCol = findColIdx('fullName');
  const lastNameCol = findColIdx('lastName');
  const firstNameCol = findColIdx('firstName');
  const classCol = findColIdx('className');
  const examCodeCol = findColIdx('examCode');
  const scoreCol = findColIdx('score');
  const notesCol = findColIdx('notes');

  // Lập chỉ mục danh sách lớp theo studentId và theo họ tên chuẩn hóa
  const rosterById = new Map<string, StudentRecord>();
  const rosterByName = new Map<string, StudentRecord[]>();
  for (const st of rosterStudents) {
    const idKey = st.studentId.trim().toUpperCase();
    rosterById.set(idKey, st);
    const nameKey = normalizeViToken(st.fullName);
    if (nameKey) {
      const list = rosterByName.get(nameKey) ?? [];
      list.push(st);
      rosterByName.set(nameKey, list);
    }
  }

  // Bước 1: Trích xuất trường và ghép sơ bộ từng dòng
  const preliminaryRows: OcrGradebookRow[] = rawRows.map((row) => {
    const rowId = row.id ?? `ocr-row-${row.rowIndex + 1}`;
    const rawStt = sttCol >= 0 ? getEffectiveCellText(row.cells[sttCol]) : '';
    const parsedStt = Number(rawStt);
    const extractedOrderNumber =
      Number.isInteger(parsedStt) && parsedStt > 0 ? parsedStt : undefined;

    const extractedStudentId =
      idCol >= 0 ? getEffectiveCellText(row.cells[idCol]) : '';

    let extractedFullName = '';
    if (lastNameCol >= 0 || firstNameCol >= 0) {
      const lastPart =
        lastNameCol >= 0 ? getEffectiveCellText(row.cells[lastNameCol]) : '';
      const firstPart =
        firstNameCol >= 0 ? getEffectiveCellText(row.cells[firstNameCol]) : '';
      extractedFullName = `${lastPart} ${firstPart}`.trim();
    }
    if (!extractedFullName && fullNameCol >= 0) {
      extractedFullName = getEffectiveCellText(row.cells[fullNameCol]);
    }

    const extractedClassName =
      (classCol >= 0 ? getEffectiveCellText(row.cells[classCol]) : '') ||
      defaultClassName;
    const extractedExamCode =
      examCodeCol >= 0 ? getEffectiveCellText(row.cells[examCodeCol]) : '';
    const extractedNotes =
      notesCol >= 0 ? getEffectiveCellText(row.cells[notesCol]) : '';

    const scoreCell = scoreCol >= 0 ? row.cells[scoreCol] : undefined;
    const scoreText = getEffectiveCellText(scoreCell);
    const isScoreEdited =
      scoreCell !== undefined && scoreCell.editedText !== undefined;
    const parsedScore = parseGradebookScoreCell(
      scoreText,
      isScoreEdited ? 1 : scoreCell?.confidence ?? 1,
      maxScore,
      0.72,
      isScoreEdited ? false : Boolean(scoreCell?.unreadable)
    );

    // Ghép học sinh theo thứ tự ưu tiên chặt chẽ
    let matchState: StudentRowMatchState = 'UNMATCHED';
    let matchedStudentId: string | null = null;
    let suggestedStudentIds: string[] = [];
    let matchWarning: string | undefined;

    const manualTargetId = teacherConfirmedStudentByRowId[rowId]?.trim();
    if (manualTargetId) {
      const targetRec = rosterById.get(manualTargetId.toUpperCase());
      if (targetRec) {
        matchState = 'MATCHED';
        matchedStudentId = targetRec.studentId;
        suggestedStudentIds = [targetRec.studentId];
      } else {
        matchState = 'UNMATCHED';
        matchWarning = `Mã học sinh "${manualTargetId}" không có trong danh sách lớp.`;
      }
    } else if (extractedStudentId) {
      const exactRec = rosterById.get(extractedStudentId.toUpperCase());
      if (exactRec) {
        // Kiểm tra xem họ tên trên ảnh (nếu có) có khác biệt lớn với danh sách lớp không
        const ocrNameNorm = normalizeViToken(extractedFullName);
        const rosterNameNorm = normalizeViToken(exactRec.fullName);
        if (
          ocrNameNorm &&
          rosterNameNorm &&
          ocrNameNorm !== rosterNameNorm &&
          !rosterNameNorm.includes(ocrNameNorm) &&
          !ocrNameNorm.includes(rosterNameNorm)
        ) {
          matchState = 'REVIEW_REQUIRED';
          matchedStudentId = exactRec.studentId;
          suggestedStudentIds = [exactRec.studentId];
          matchWarning = `Mã HS "${exactRec.studentId}" khớp nhưng họ tên trên ảnh ("${extractedFullName}") khác với danh sách lớp ("${exactRec.fullName}").`;
        } else {
          matchState = 'MATCHED';
          matchedStudentId = exactRec.studentId;
          suggestedStudentIds = [exactRec.studentId];
        }
      } else {
        matchState = 'UNMATCHED';
        const nameCandidates = extractedFullName
          ? rosterByName.get(normalizeViToken(extractedFullName)) ?? []
          : [];
        suggestedStudentIds = nameCandidates.map((c) => c.studentId);
        matchWarning = `Mã học sinh "${extractedStudentId}" không tồn tại trong danh sách lớp.`;
      }
    } else if (extractedFullName) {
      // Không có mã học sinh trên dòng OCR -> chỉ dùng tên để gợi ý, không tự động MATCHED
      const nameCandidates =
        rosterByName.get(normalizeViToken(extractedFullName)) ?? [];
      if (nameCandidates.length > 1) {
        matchState = 'AMBIGUOUS';
        matchedStudentId = null;
        suggestedStudentIds = nameCandidates.map((c) => c.studentId);
        matchWarning = `Có ${nameCandidates.length} học sinh trùng họ tên "${extractedFullName}" (${suggestedStudentIds.join(', ')}) — bắt buộc chọn đúng Mã học sinh.`;
      } else if (nameCandidates.length === 1) {
        matchState = 'REVIEW_REQUIRED';
        matchedStudentId = null;
        suggestedStudentIds = [nameCandidates[0].studentId];
        matchWarning = `Thiếu Mã học sinh trên ảnh. Gợi ý ghép với ${nameCandidates[0].studentId} (${nameCandidates[0].fullName}) — cần giáo viên xác nhận.`;
      } else {
        matchState = 'UNMATCHED';
        matchWarning = `Không tìm thấy học sinh "${extractedFullName}" trong danh sách lớp.`;
      }
    } else {
      matchState = 'UNMATCHED';
      matchWarning = 'Dòng OCR thiếu cả Mã học sinh và Họ tên.';
    }

    // Nếu ô điểm cần kiểm tra thủ công và dòng đang MATCHED chưa được giáo viên duyệt -> chuyển cảnh báo
    if (parsedScore.needsReview && !row.confirmedByTeacher && matchState === 'MATCHED') {
      matchState = 'REVIEW_REQUIRED';
      matchWarning = parsedScore.warning;
    }

    return {
      id: rowId,
      rowIndex: row.rowIndex,
      bbox: row.bbox,
      cells: row.cells,
      extractedOrderNumber,
      extractedStudentId,
      extractedFullName,
      extractedClassName,
      extractedExamCode,
      extractedNotes,
      parsedScore,
      matchState,
      matchedStudentId,
      suggestedStudentIds,
      matchWarning,
      confirmedByTeacher: Boolean(row.confirmedByTeacher),
      confirmedAt: row.confirmedAt,
      reviewNote: row.reviewNote,
    };
  });

  // Bước 2: Chặn nhiều dòng OCR cùng trỏ vào 1 học sinh mà chưa xác nhận tách biệt
  const countByTargetStudent = new Map<string, number>();
  for (const r of preliminaryRows) {
    if (r.matchedStudentId) {
      const key = r.matchedStudentId.toUpperCase();
      countByTargetStudent.set(key, (countByTargetStudent.get(key) ?? 0) + 1);
    }
  }

  return preliminaryRows.map((r) => {
    if (!r.matchedStudentId) return r;
    const key = r.matchedStudentId.toUpperCase();
    const dupCount = countByTargetStudent.get(key) ?? 0;
    if (dupCount > 1) {
      return {
        ...r,
        matchState: 'REVIEW_REQUIRED',
        confirmedByTeacher: false,
        matchWarning: `Có ${dupCount} dòng OCR trong ảnh cùng ghép tới Mã học sinh "${r.matchedStudentId}" — hệ thống chặn ghi đè tự động, vui lòng kiểm tra lại.`,
      };
    }
    return r;
  });
}

/**
 * Hợp nhất và đối chiếu hai nguồn điểm (§9, §12):
 * - Nguồn A: Kết quả chấm phiếu OMR (`session.sheets`).
 * - Nguồn B: Điểm đọc từ ảnh bảng điểm (`session.photoGradebooks`).
 * - Tuyệt đối không mặc định 1 trong 2 nguồn luôn đúng hơn khi có xung đột (`MISMATCH`).
 * - Không tự thay đổi điểm chính thức khi có xung đột; giữ trạng thái chờ giáo viên xác nhận.
 */
export function reconcileIntelligentGradebook(
  session: GradingSession
): IntelligentGradebookEntry[] {
  const now = new Date().toISOString();
  const existingByStudentId = new Map<string, IntelligentGradebookEntry>();
  for (const entry of session.gradebookEntries ?? []) {
    existingByStudentId.set(entry.studentId.trim().toUpperCase(), entry);
  }

  // Nguồn A: OMR Sheets đang hoạt động theo studentId (loại trừ các bản trùng đã lưu trữ)
  const omrByStudentId = new Map<
    string,
    GradingSession['sheets'][number]
  >();
  for (const sheet of session.sheets) {
    if (sheet.archivedByDuplicateResolution) continue;
    const sid = sheet.studentId.trim().toUpperCase();
    if (!sid) continue;
    // Ưu tiên bài đã được giáo viên xác nhận hoặc cập nhật mới nhất
    const prev = omrByStudentId.get(sid);
    if (
      !prev ||
      (sheet.confirmedByTeacher && !prev.confirmedByTeacher) ||
      sheet.updatedAt >= prev.updatedAt
    ) {
      omrByStudentId.set(sid, sheet);
    }
  }

  // Nguồn B: Photo Gradebook OCR rows đã ghép được matchedStudentId
  const photoRowByStudentId = new Map<
    string,
    { importRec: PhotoGradebookImportRecord; row: OcrGradebookRow }
  >();
  for (const imp of session.photoGradebooks ?? []) {
    if (!imp.columnMappingConfirmed) continue;
    for (const row of imp.rows) {
      if (!row.matchedStudentId) continue;
      // Nếu có nhiều dòng trùng mã HS chưa giải quyết (matchState === 'REVIEW_REQUIRED' do trùng), không tự nạp đè
      const sid = row.matchedStudentId.trim().toUpperCase();
      const prev = photoRowByStudentId.get(sid);
      if (
        !prev ||
        (row.confirmedByTeacher && !prev.row.confirmedByTeacher) ||
        imp.updatedAt >= prev.importRec.updatedAt
      ) {
        photoRowByStudentId.set(sid, { importRec: imp, row });
      }
    }
  }

  // Tập hợp danh sách học sinh chuẩn từ Roster + các mã học sinh xuất hiện ở OMR (đang hoạt động)
  const allStudentsMap = new Map<string, StudentRecord>();
  session.students.forEach((st, idx) => {
    allStudentsMap.set(st.studentId.trim().toUpperCase(), {
      ...st,
      orderNumber: st.orderNumber || idx + 1,
    });
  });
  session.sheets.forEach((sh) => {
    if (sh.archivedByDuplicateResolution) return;
    const key = sh.studentId.trim().toUpperCase();
    if (key && !allStudentsMap.has(key)) {
      allStudentsMap.set(key, {
        studentId: sh.studentId.trim(),
        fullName: sh.studentName || `Học sinh ${sh.studentId}`,
        className: sh.className || session.className,
        orderNumber: allStudentsMap.size + 1,
      });
    }
  });

  const orderedStudents = Array.from(allStudentsMap.values()).sort(
    (a, b) => a.orderNumber - b.orderNumber
  );

  return orderedStudents.map((student, idx) => {
    const sidKey = student.studentId.trim().toUpperCase();
    const prevEntry = existingByStudentId.get(sidKey);
    const omrSheet = omrByStudentId.get(sidKey);
    const photoMatch = photoRowByStudentId.get(sidKey);

    const omrScore = omrSheet ? omrSheet.finalScore : null;
    const photoScore =
      photoMatch && photoMatch.row.parsedScore.status === 'valid'
        ? photoMatch.row.parsedScore.numericScore
        : null;
    const photoParseStatus = photoMatch?.row.parsedScore.status;
    const photoRawText = photoMatch
      ? photoMatch.row.parsedScore.normalizedText ||
        photoMatch.row.parsedScore.rawText
      : undefined;

    const hasBothScores = omrScore !== null && photoScore !== null;
    const scoreDelta = hasBothScores
      ? Number(Math.abs(omrScore - photoScore).toFixed(4))
      : null;

    const omrNeedsReview =
      omrSheet !== undefined &&
      (omrSheet.status === 'review-required' ||
        omrSheet.status === 'error' ||
        Boolean(omrSheet.duplicateStudentWarning));

    const photoNeedsReview =
      photoMatch !== undefined &&
      (photoMatch.row.parsedScore.needsReview ||
        photoMatch.row.matchState !== 'MATCHED');

    let reconciliationStatus: GradeReconciliationStatus = 'MISSING';
    let officialScore: number | null = null;
    let officialScoreSource: OfficialScoreSource = 'unassigned';
    let confirmedByTeacher = false;
    let confirmedAt: string | undefined;

    // Kiểm tra xem giáo viên đã xác nhận điểm chính thức trên bản ghi hiện có chưa
    const remainedValidConfirmation =
      prevEntry &&
      prevEntry.confirmedByTeacher &&
      prevEntry.officialScore !== null &&
      prevEntry.omrScore === omrScore &&
      prevEntry.photoScore === photoScore;

    if (remainedValidConfirmation && prevEntry) {
      reconciliationStatus = 'CONFIRMED';
      officialScore = prevEntry.officialScore;
      officialScoreSource = prevEntry.officialScoreSource;
      confirmedByTeacher = true;
      confirmedAt = prevEntry.confirmedAt;
    } else if (hasBothScores) {
      if (scoreDelta !== null && scoreDelta > 1e-6) {
        // Hai nguồn điểm khác nhau -> MISMATCH, tuyệt đối không tự chọn 1 nguồn làm điểm chính thức
        reconciliationStatus = 'MISMATCH';
        officialScore = null;
        officialScoreSource = 'unassigned';
        confirmedByTeacher = false;
      } else if (omrNeedsReview || photoNeedsReview) {
        reconciliationStatus = 'REVIEW_REQUIRED';
        officialScore = omrScore;
        officialScoreSource = 'reconciled-both';
        confirmedByTeacher = false;
      } else {
        const bothTeacherConfirmed =
          Boolean(omrSheet?.confirmedByTeacher) &&
          Boolean(photoMatch?.row.confirmedByTeacher);
        reconciliationStatus = bothTeacherConfirmed ? 'CONFIRMED' : 'MATCHED';
        officialScore = omrScore;
        officialScoreSource = 'reconciled-both';
        confirmedByTeacher = bothTeacherConfirmed;
        confirmedAt = bothTeacherConfirmed ? now : undefined;
      }
    } else if (omrScore !== null) {
      if (omrNeedsReview) {
        reconciliationStatus = 'REVIEW_REQUIRED';
        officialScore = omrScore;
        officialScoreSource = 'omr';
      } else if (omrSheet?.confirmedByTeacher && (session.photoGradebooks ?? []).length === 0) {
        reconciliationStatus = 'CONFIRMED';
        officialScore = omrScore;
        officialScoreSource = 'omr';
        confirmedByTeacher = true;
        confirmedAt = omrSheet.confirmedAt ?? now;
      } else {
        reconciliationStatus = photoNeedsReview ? 'REVIEW_REQUIRED' : 'MISSING';
        officialScore = omrScore;
        officialScoreSource = 'omr';
      }
    } else if (photoScore !== null) {
      if (photoNeedsReview) {
        reconciliationStatus = 'REVIEW_REQUIRED';
        officialScore = null;
        officialScoreSource = 'unassigned';
      } else {
        reconciliationStatus = 'MISSING';
        officialScore = photoScore;
        officialScoreSource = 'photo-ocr';
      }
    } else {
      reconciliationStatus =
        omrNeedsReview || photoNeedsReview ? 'REVIEW_REQUIRED' : 'MISSING';
      officialScore = null;
      officialScoreSource = 'unassigned';
    }

    const defaultNoteParts: string[] = [];
    if (photoParseStatus === 'absent') {
      defaultNoteParts.push('Ảnh bảng điểm ghi: Vắng');
    }
    if (photoMatch?.row.extractedNotes) {
      defaultNoteParts.push(photoMatch.row.extractedNotes);
    }
    if (photoMatch?.row.matchWarning) {
      defaultNoteParts.push(photoMatch.row.matchWarning);
    }

    return {
      id: prevEntry?.id ?? `gb-${session.id}-${student.studentId}`,
      sessionId: session.id,
      orderNumber: student.orderNumber || idx + 1,
      studentId: student.studentId,
      fullName: student.fullName,
      className: student.className || session.className,
      examCode:
        omrSheet?.examCode ||
        photoMatch?.row.extractedExamCode ||
        prevEntry?.examCode ||
        '—',
      omrSheetId: omrSheet?.id,
      omrScore,
      omrStatus: omrSheet?.status,
      photoImportId: photoMatch?.importRec.id,
      photoRowId: photoMatch?.row.id,
      photoScore,
      photoRawText,
      photoParseStatus,
      scoreDelta,
      officialScore,
      officialScoreSource,
      reconciliationStatus,
      confirmedByTeacher,
      confirmedAt,
      notes: prevEntry?.notes || defaultNoteParts.join(' · '),
      hasOmrEvidence: Boolean(omrSheet),
      hasPhotoEvidence: Boolean(photoMatch),
      updatedAt: now,
    };
  });
}

/**
 * Giáo viên xác nhận hoặc chỉnh sửa điểm chính thức kèm ghi nhận Audit Trail bất biến (§11).
 */
export function confirmOrOverrideGradebookEntry(params: {
  session: GradingSession;
  studentId: string;
  chosenScore: number | null;
  source: 'omr' | 'photo-ocr' | 'manual';
  reason: string;
}): GradingSession {
  const { session, studentId, chosenScore, source, reason } = params;
  const maxScore = session.gradingRule.maxScore;

  if (
    chosenScore !== null &&
    (!Number.isFinite(chosenScore) || chosenScore < 0 || chosenScore > maxScore)
  ) {
    throw new Error(
      `Điểm chính thức (${chosenScore}) phải nằm trong thang điểm hợp lệ [0..${maxScore}].`
    );
  }

  const cleanReason =
    reason.trim() ||
    (source === 'omr'
      ? 'Xác nhận lấy điểm chấm phiếu OMR'
      : source === 'photo-ocr'
      ? 'Xác nhận lấy điểm từ ảnh bảng điểm lớp'
      : 'Giáo viên điều chỉnh và xác nhận điểm thủ công');

  const now = new Date().toISOString();
  const currentEntries =
    session.gradebookEntries && session.gradebookEntries.length > 0
      ? session.gradebookEntries
      : reconcileIntelligentGradebook(session);

  const sidKey = studentId.trim().toUpperCase();
  let previousScore: number | null = null;

  const updatedEntries = currentEntries.map((entry) => {
    if (entry.studentId.trim().toUpperCase() !== sidKey) return entry;
    previousScore = entry.officialScore;
    return {
      ...entry,
      officialScore: chosenScore,
      officialScoreSource: source,
      reconciliationStatus: 'CONFIRMED' as const,
      confirmedByTeacher: true,
      confirmedAt: now,
      notes: cleanReason,
      updatedAt: now,
    };
  });

  const auditEntry: OfficialGradeAuditEntry = {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    studentId,
    assessmentId: session.id,
    previousScore,
    newScore: chosenScore,
    source,
    timestamp: now,
    reason: cleanReason,
    confirmedStatus: 'CONFIRMED',
  };

  return {
    ...session,
    gradebookEntries: updatedEntries,
    gradeAuditTrail: [...(session.gradeAuditTrail ?? []), auditEntry],
    updatedAt: now,
  };
}

/**
 * Hoàn tác thay đổi điểm chính thức gần nhất của một học sinh mà KHÔNG xóa lịch sử audit cũ
 * và không làm mất dữ liệu nguồn OMR hay OCR (§11).
 */
export function undoLastOfficialGradeChange(params: {
  session: GradingSession;
  studentId: string;
  reason?: string;
}): GradingSession {
  const { session, studentId, reason } = params;
  const sidKey = studentId.trim().toUpperCase();
  const trail = session.gradeAuditTrail ?? [];
  const studentAudits = trail.filter(
    (a) => a.studentId.trim().toUpperCase() === sidKey
  );
  if (studentAudits.length === 0) return session;

  const lastAudit = studentAudits[studentAudits.length - 1];
  const now = new Date().toISOString();
  const currentEntries =
    session.gradebookEntries && session.gradebookEntries.length > 0
      ? session.gradebookEntries
      : reconcileIntelligentGradebook(session);

  const restoredScore = lastAudit.previousScore;
  const updatedEntries = currentEntries.map((entry) => {
    if (entry.studentId.trim().toUpperCase() !== sidKey) return entry;
    const hasConflict =
      entry.omrScore !== null &&
      entry.photoScore !== null &&
      Math.abs(entry.omrScore - entry.photoScore) > 1e-6;
    const nextStatus: GradeReconciliationStatus =
      restoredScore === null
        ? hasConflict
          ? 'MISMATCH'
          : 'MISSING'
        : 'REVIEW_REQUIRED';
    return {
      ...entry,
      officialScore: restoredScore,
      officialScoreSource:
        restoredScore === null ? ('unassigned' as const) : ('manual' as const),
      reconciliationStatus: nextStatus,
      confirmedByTeacher: false,
      confirmedAt: undefined,
      updatedAt: now,
    };
  });

  const undoAudit: OfficialGradeAuditEntry = {
    id: `audit-undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    studentId,
    assessmentId: session.id,
    previousScore: lastAudit.newScore,
    newScore: restoredScore,
    source: 'undo',
    timestamp: now,
    reason: reason?.trim() || 'Hoàn tác thao tác điều chỉnh điểm trước đó',
    confirmedStatus:
      restoredScore === null ? 'REVIEW_REQUIRED' : 'REVIEW_REQUIRED',
  };

  return {
    ...session,
    gradebookEntries: updatedEntries,
    gradeAuditTrail: [...trail, undoAudit],
    updatedAt: now,
  };
}

/**
 * Tính toán thống kê Sổ điểm thông minh (§12):
 * CHỈ tính điểm trung bình / cao nhất / thấp nhất từ tập dữ liệu hợp lệ và đã được giáo viên xác nhận.
 */
export function computeIntelligentGradebookStats(
  entries: IntelligentGradebookEntry[]
): IntelligentGradebookStats {
  const confirmedScores = entries
    .filter(
      (e) =>
        e.confirmedByTeacher &&
        e.officialScore !== null &&
        Number.isFinite(e.officialScore)
    )
    .map((e) => e.officialScore as number);

  const confirmedValidCount = confirmedScores.length;
  const confirmedAverageScore =
    confirmedValidCount > 0
      ? Number(
          (
            confirmedScores.reduce((a, b) => a + b, 0) / confirmedValidCount
          ).toFixed(2)
        )
      : null;
  const confirmedHighestScore =
    confirmedValidCount > 0 ? Math.max(...confirmedScores) : null;
  const confirmedLowestScore =
    confirmedValidCount > 0 ? Math.min(...confirmedScores) : null;

  return {
    totalEntries: entries.length,
    confirmedValidCount,
    matchedCount: entries.filter((e) => e.reconciliationStatus === 'MATCHED').length,
    mismatchCount: entries.filter((e) => e.reconciliationStatus === 'MISMATCH').length,
    missingCount: entries.filter((e) => e.reconciliationStatus === 'MISSING').length,
    reviewRequiredCount: entries.filter(
      (e) => e.reconciliationStatus === 'REVIEW_REQUIRED'
    ).length,
    confirmedAverageScore,
    confirmedHighestScore,
    confirmedLowestScore,
  };
}
