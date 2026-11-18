import {
  JournalEntry,
  LessonPack,
  ResourceItem,
  TIER_LABELS,
} from '../types/lesson';
import { APP_REGISTRY, AppDefinition, AppId } from './appRegistry';

export type SearchResultKind =
  | 'app'
  | 'lesson-pack'
  | 'question'
  | 'resource'
  | 'journal'
  | 'action';

export type SearchScopeFilter =
  | 'all'
  | 'app'
  | 'lesson-pack'
  | 'question'
  | 'resource-journal'
  | 'action';

export type PaletteActionId =
  | 'create-lesson-pack'
  | 'toggle-theme'
  | 'export-json-backup'
  | 'open-library';

export interface LocalSearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  badgeText: string;
  appId?: AppId;
  packId?: string;
  actionId?: PaletteActionId;
}

export interface QuickActionDefinition {
  id: PaletteActionId;
  title: string;
  subtitle: string;
  badgeText: string;
  keywords: string[];
}

export const QUICK_ACTIONS: QuickActionDefinition[] = [
  {
    id: 'create-lesson-pack',
    title: 'Tạo bộ tiết dạy mới',
    subtitle: 'Mở Lesson Studio ở bước 1 để soạn bộ tiết dạy mới',
    badgeText: 'Thao tác nhanh',
    keywords: ['tao moi', 'bo tiet day', 'new lesson', 'soan bai'],
  },
  {
    id: 'open-library',
    title: 'Mở Kho bộ tiết dạy trong Lesson Studio',
    subtitle: 'Tìm kiếm, nhân bản hoặc quản lý toàn bộ bộ tiết dạy đã lưu',
    badgeText: 'Điều hướng',
    keywords: ['kho', 'library', 'danh sach', 'bo tiet day'],
  },
  {
    id: 'toggle-theme',
    title: 'Chuyển giao diện Sáng / Tối',
    subtitle: 'Thay đổi nền sáng hoặc tối cho TeacherOS Shell',
    badgeText: 'Giao diện',
    keywords: ['sang', 'toi', 'dark', 'light', 'theme', 'giao dien'],
  },
  {
    id: 'export-json-backup',
    title: 'Tải bản sao lưu JSON ngay',
    subtitle: 'Xuất toàn bộ bộ tiết dạy và cài đặt in A4 ra tệp .json',
    badgeText: 'Sao lưu',
    keywords: ['sao luu', 'backup', 'json', 'export', 'xuat du lieu'],
  },
];

/**
 * Chuẩn hóa chuỗi tiếng Việt để tìm kiếm không phân biệt dấu và chữ hoa/thường.
 */
export function normalizeVietnameseSearchText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function matchesQuery(haystack: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return normalizeVietnameseSearchText(haystack).includes(normalizedQuery);
}

/**
 * Tìm kiếm toàn hệ thống cục bộ (Universal Search 2.0) trên ứng dụng, bộ tiết dạy,
 * từng câu hỏi phân hóa, kho học liệu Resource Vault, nhật ký giảng dạy và thao tác nhanh.
 */
export function searchWorkspaceLocally(
  rawQuery: string,
  packs: LessonPack[],
  apps: AppDefinition[] = APP_REGISTRY,
  options?: {
    scope?: SearchScopeFilter;
    resources?: ResourceItem[];
    journals?: JournalEntry[];
  }
): LocalSearchResult[] {
  const q = normalizeVietnameseSearchText(rawQuery);
  const scope = options?.scope ?? 'all';
  const resources = options?.resources ?? [];
  const journals = options?.journals ?? [];
  const results: LocalSearchResult[] = [];

  if (scope === 'all' || scope === 'app') {
    for (const app of apps) {
      const searchable = `${app.name} ${app.shortName} ${app.description} ${app.keywords.join(' ')}`;
      if (matchesQuery(searchable, q)) {
        results.push({
          id: `app:${app.id}`,
          kind: 'app',
          title: app.name,
          subtitle: app.description,
          badgeText: app.statusLabel,
          appId: app.id,
        });
      }
    }
  }

  if (scope === 'all' || scope === 'action') {
    for (const action of QUICK_ACTIONS) {
      const searchable = `${action.title} ${action.subtitle} ${action.keywords.join(' ')}`;
      if (matchesQuery(searchable, q)) {
        results.push({
          id: `action:${action.id}`,
          kind: 'action',
          title: action.title,
          subtitle: action.subtitle,
          badgeText: action.badgeText,
          actionId: action.id,
        });
      }
    }
  }

  if (scope === 'all' || scope === 'lesson-pack') {
    const packLimit = q ? 20 : 6;
    let matchedPacks = 0;
    for (const pack of packs) {
      if (matchedPacks >= packLimit) break;
      const activityTitles = pack.activities.map((a) => a.title).join(' ');
      const questionTexts = pack.questions
        .map((item) => `${item.code} ${item.prompt}`)
        .join(' ');
      const searchable = `${pack.title} ${pack.subject} ${pack.grade} ${activityTitles} ${questionTexts}`;
      if (matchesQuery(searchable, q)) {
        matchedPacks += 1;
        results.push({
          id: `pack:${pack.id}`,
          kind: 'lesson-pack',
          title: pack.title || '(Bộ tiết dạy chưa đặt tên)',
          subtitle: `${pack.subject} · ${pack.grade} · ${pack.duration} phút · ${pack.questions.length} câu hỏi`,
          badgeText: pack.isDemo
            ? 'DEMO'
            : pack.status === 'completed'
            ? 'Hoàn thành'
            : `Bản nháp ${pack.lastStep}/5`,
          packId: pack.id,
        });
      }
    }
  }

  if (scope === 'question' || (scope === 'all' && q.length > 0)) {
    let matchedQuestions = 0;
    for (const pack of packs) {
      for (const question of pack.questions) {
        if (matchedQuestions >= 12) break;
        const tierLabel = TIER_LABELS[question.tier];
        const searchable = `${question.code} ${tierLabel} ${question.prompt} ${question.answerGuide} ${pack.title} ${pack.subject}`;
        if (matchesQuery(searchable, q)) {
          matchedQuestions += 1;
          results.push({
            id: `question:${pack.id}:${question.id}`,
            kind: 'question',
            title: `[${question.code}] ${question.prompt}`,
            subtitle: `${tierLabel} · ${question.points}đ · Thuộc bài: ${pack.title || 'Chưa đặt tên'}`,
            badgeText: `Câu hỏi ${tierLabel}`,
            packId: pack.id,
          });
        }
      }
    }
  }

  if (scope === 'resource-journal' || (scope === 'all' && q.length > 0)) {
    for (const res of resources.slice(0, 12)) {
      const searchable = `${res.title} ${res.subject} ${res.grade} ${res.tags.join(' ')} ${res.content}`;
      if (matchesQuery(searchable, q)) {
        results.push({
          id: `resource:${res.id}`,
          kind: 'resource',
          title: res.title,
          subtitle: `${res.subject} · ${res.grade} · Thẻ: ${res.tags.join(', ') || 'Chung'}`,
          badgeText: 'Resource Vault',
          appId: 'resource-vault',
        });
      }
    }

    for (const jrn of journals.slice(0, 10)) {
      const searchable = `${jrn.classLabel} ${jrn.taughtDate} ${jrn.whatWorked} ${jrn.bottlenecks} ${jrn.nextAdjustment}`;
      if (matchesQuery(searchable, q)) {
        results.push({
          id: `journal:${jrn.id}`,
          kind: 'journal',
          title: `Nhật ký lớp ${jrn.classLabel} (${jrn.taughtDate})`,
          subtitle: jrn.nextAdjustment || jrn.whatWorked,
          badgeText: 'Teaching Journal',
          appId: 'teaching-journal',
        });
      }
    }
  }

  return results;
}
