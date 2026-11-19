import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import type { StudentRecord } from '../../types/grading';
import {
  buildStudentRosterFromRows,
  parseCsvTable,
  parseXlsxFirstSheetRows,
} from '../../core/grading/rosterParser';
import { triggerBlobDownload } from '../../core/grading/omrBrowserBridge';

interface StudentRosterPanelProps {
  classNameLabel: string;
  students: StudentRecord[];
  onChangeStudents: (next: StudentRecord[]) => void;
  onNotify: (tone: 'success' | 'info' | 'error', message: string) => void;
}

export function StudentRosterPanel({
  classNameLabel,
  students,
  onChangeStudents,
  onNotify,
}: StudentRosterPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState(classNameLabel || '');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const handleAddStudent = () => {
    setFormError(null);
    const cleanId = newId.trim();
    const cleanName = newName.trim();
    const cleanClass = (newClass.trim() || classNameLabel || 'Chưa gắn lớp').trim();

    if (!cleanId) {
      setFormError('Vui lòng nhập Mã học sinh (khóa chính duy nhất).');
      return;
    }
    if (!cleanName) {
      setFormError('Vui lòng nhập Họ và tên học sinh.');
      return;
    }
    if (
      students.some(
        (s) => s.studentId.trim().toUpperCase() === cleanId.toUpperCase()
      )
    ) {
      setFormError(
        `Mã học sinh "${cleanId}" đã tồn tại trong danh sách lớp. Mỗi học sinh cần 1 mã duy nhất.`
      );
      return;
    }

    const next: StudentRecord[] = [
      ...students,
      {
        studentId: cleanId,
        fullName: cleanName,
        className: cleanClass,
        orderNumber: students.length + 1,
      },
    ];
    onChangeStudents(next);
    setNewId('');
    setNewName('');
    onNotify('success', `Đã thêm học sinh ${cleanId} · ${cleanName}.`);
  };

  const handleRemoveStudent = (studentId: string) => {
    const next = students
      .filter((s) => s.studentId !== studentId)
      .map((s, idx) => ({ ...s, orderNumber: idx + 1 }));
    onChangeStudents(next);
  };

  const handleImportFile = async (file: File) => {
    setImportWarnings([]);
    setFormError(null);
    try {
      const lower = file.name.toLowerCase();
      let rows: string[][] = [];
      if (lower.endsWith('.xlsx')) {
        const buf = await file.arrayBuffer();
        rows = await parseXlsxFirstSheetRows(buf);
      } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        rows = parseCsvTable(text);
      } else {
        setFormError('Vui lòng chọn tệp danh sách định dạng .CSV hoặc .XLSX.');
        return;
      }

      const result = buildStudentRosterFromRows(
        rows,
        classNameLabel || 'Lớp mặc định'
      );
      if (result.errors.length > 0) {
        setFormError(result.errors[0]);
        return;
      }

      // Gộp an toàn theo khóa chính studentId (không ghi đè âm thầm mã đã tồn tại)
      const existingIds = new Set(
        students.map((s) => s.studentId.trim().toUpperCase())
      );
      const merged = [...students];
      const warnings = [...result.warnings];
      let addedCount = 0;

      for (const st of result.students) {
        const key = st.studentId.trim().toUpperCase();
        if (existingIds.has(key)) {
          warnings.push(
            `Mã học sinh "${st.studentId}" đã có sẵn trong lớp — giữ bản ghi hiện có.`
          );
          continue;
        }
        existingIds.add(key);
        merged.push({
          ...st,
          orderNumber: merged.length + 1,
        });
        addedCount += 1;
      }

      onChangeStudents(merged);
      setImportWarnings(warnings);
      onNotify(
        'success',
        `Đã nhập ${addedCount} học sinh từ "${file.name}"${warnings.length > 0 ? ` (${warnings.length} lưu ý)` : ''}.`
      );
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc tệp danh sách học sinh.'
      );
    }
  };

  const handleDownloadCsvTemplate = () => {
    const csv = [
      'STT,Mã học sinh,Họ và tên,Lớp',
      `1,HS001,Nguyễn Minh Anh,${classNameLabel || '12A1'}`,
      `2,HS002,Nguyễn Minh Anh,${classNameLabel || '12A1'}`,
      `3,HS003,Trần Quốc Bảo,${classNameLabel || '12A1'}`,
    ].join('\n');
    triggerBlobDownload(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
      `Mau_danh_sach_lop_${(classNameLabel || 'lop').replace(/\s+/g, '_')}.csv`
    );
  };

  return (
    <div className="space-y-5">
      {/* Header & Import Controls */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-50 flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Danh sách học sinh lớp {classNameLabel || 'chưa đặt tên'}</span>
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Mã học sinh (<span className="font-mono-num font-semibold">studentId</span>) là khóa chính duy nhất. Cho phép nhiều học sinh trùng họ tên khi có Mã học sinh khác nhau.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tải mẫu CSV</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nhập CSV / XLSX</span>
            </button>
          </div>
        </div>

        {/* Manual add form */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="sm:col-span-3">
            <label htmlFor="roster-student-id" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Mã học sinh *
            </label>
            <input
              id="roster-student-id"
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="Ví dụ: HS001"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 px-3 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-5">
            <label htmlFor="roster-student-name" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Họ và tên *
            </label>
            <input
              id="roster-student-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddStudent();
              }}
              placeholder="Ví dụ: Nguyễn Minh Anh"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="roster-student-class" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Lớp
            </label>
            <input
              id="roster-student-class"
              type="text"
              value={newClass}
              onChange={(e) => setNewClass(e.target.value)}
              placeholder={classNameLabel || '12A1'}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <button
              type="button"
              onClick={handleAddStudent}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Thêm</span>
            </button>
          </div>
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        {importWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <div className="font-semibold">Lưu ý khi nhập danh sách:</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {importWarnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Roster Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Tổng số học sinh:{' '}
            <span className="font-mono-num text-slate-950 dark:text-white">
              {students.length}
            </span>
          </span>
          {students.length > 0 && (
            <button
              type="button"
              onClick={() => onChangeStudents([])}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              Xóa toàn bộ danh sách
            </button>
          )}
        </div>

        {students.length === 0 ? (
          <div className="px-6 py-10 text-center space-y-2">
            <FileSpreadsheet className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-700" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Chưa có học sinh trong phiên chấm này
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Thêm thủ công từng học sinh hoặc nhập nhanh từ tệp CSV / Excel (.xlsx).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5 font-semibold w-14">STT</th>
                  <th className="px-4 py-2.5 font-semibold w-36">Mã học sinh</th>
                  <th className="px-4 py-2.5 font-semibold">Họ và tên</th>
                  <th className="px-4 py-2.5 font-semibold w-28">Lớp</th>
                  <th className="px-4 py-2.5 font-semibold w-20 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {students.map((st, idx) => (
                  <tr
                    key={st.studentId}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5 font-mono-num text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                      {st.studentId}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {st.fullName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {st.className}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveStudent(st.studentId)}
                        aria-label={`Xóa học sinh ${st.fullName}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
