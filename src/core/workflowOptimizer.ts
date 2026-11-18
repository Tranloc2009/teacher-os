import { normalizeVietnamese } from './smartWorkflowParserV2';
import {
  AnalyzedTask,
  DuplicateGroup,
  MergeSuggestion,
  NextRecommendedAction,
  OptimizedWorkflowPlan,
  ParallelTaskLayer,
  ParsedWorkflowPlan,
  TaskChecklistBlueprint,
  TaskDependency,
  TreeBlueprintEdge,
  TreeBlueprintNode,
  WorkCategoryV2,
  WorkflowGroupKey,
  WorkflowTaskGroup,
  WorkflowTreeBlueprint,
} from './workflowTypes';
import { CanvasColorKey, CanvasNodeType } from '../types/canvas';

export interface OptimizeWorkflowOptions {
  /** Danh sách ID tác vụ đã hoàn thành (hoặc trạng thái trong plan) để tính bước tiếp theo */
  completedTaskIds?: ReadonlySet<string> | string[];
  /** Tự động gộp các tác vụ tương đương ngữ nghĩa (ví dụ "Soạn đề" + "Chuẩn bị đề kiểm tra") */
  autoApplyMerge?: boolean;
  /** Ngưỡng tương đồng để đề xuất gộp (mặc định 0.8) */
  mergeSimilarityThreshold?: number;
}

const TOKEN_SYNONYM_MAP: Record<string, string> = {
  soan: 'create',
  chuan: 'prepare',
  bi: 'prepare',
  tao: 'create',
  viet: 'create',
  lap: 'create',
  xay: 'create',
  dung: 'create',
  de: 'exam',
  thi: 'exam',
  kiem: 'check',
  tra: 'check',
  ra: 'review',
  soat: 'review',
  doi: 'review',
  chieu: 'review',
  duyet: 'review',
  tron: 'mix',
  sinh: 'mix',
  ma: 'code',
  in: 'print',
  xuat: 'print',
  pdf: 'print',
  ngu: 'resource',
  hoc: 'resource',
  tai: 'resource',
  lieu: 'resource',
  phieu: 'worksheet',
  dap: 'answer',
  an: 'answer',
};

const STOP_WORDS = new Set([
  'va',
  'voi',
  'cho',
  'cua',
  'cac',
  'mot',
  'nhung',
  'viec',
  'buoc',
  'bai',
  'tap',
  'kiem',
  'tra',
]);

function normalizeSynonymTokens(text: string): string[] {
  const norm = normalizeVietnamese(text);
  const rawTokens = norm.split(/\s+/).filter(Boolean);
  const mapped: string[] = [];
  for (const tok of rawTokens) {
    if (STOP_WORDS.has(tok) && norm !== 'kiem tra dap an') continue;
    mapped.push(TOKEN_SYNONYM_MAP[tok] ?? tok);
  }
  return Array.from(new Set(mapped));
}

export function computeTaskSimilarity(a: AnalyzedTask, b: AnalyzedTask): {
  score: number;
  reason: string;
} {
  // Exact normalized title match
  if (a.normalizedTitle === b.normalizedTitle) {
    return { score: 1.0, reason: 'Trùng hoàn toàn tiêu đề công việc' };
  }

  // Same semantic verb:object concept (e.g. "soạn đề" vs "chuẩn bị đề kiểm tra" -> both prepare_create:exam)
  if (
    a.canonicalConcept === b.canonicalConcept &&
    a.verbAction !== 'general' &&
    a.objectTarget !== 'generic'
  ) {
    return {
      score: 0.91,
      reason: `Cùng hành động và đối tượng (${a.verbAction} → ${a.objectTarget})`,
    };
  }

  const tokensA = new Set(normalizeSynonymTokens(a.title));
  const tokensB = new Set(normalizeSynonymTokens(b.title));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return { score: 0, reason: '' };
  }

  let intersection = 0;
  for (const tok of tokensA) {
    if (tokensB.has(tok)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  if (jaccard >= 0.78) {
    return {
      score: Number(jaccard.toFixed(2)),
      reason: 'Từ khóa cốt lõi trùng lặp cao theo từ điển đồng nghĩa giáo dục',
    };
  }

  return { score: Number(jaccard.toFixed(2)), reason: '' };
}

function chooseMergedTitle(tasks: AnalyzedTask[]): string {
  // Prefer the most descriptive title, or combine cleanly if short
  const sorted = [...tasks].sort((a, b) => b.title.length - a.title.length);
  return sorted[0].title;
}

export function detectDuplicatesAndMergeSuggestions(
  tasks: AnalyzedTask[],
  threshold = 0.8
): {
  duplicateGroups: DuplicateGroup[];
  mergeSuggestions: MergeSuggestion[];
} {
  if (tasks.length < 2) {
    return { duplicateGroups: [], mergeSuggestions: [] };
  }

  const visited = new Set<string>();
  const duplicateGroups: DuplicateGroup[] = [];
  const mergeSuggestions: MergeSuggestion[] = [];
  let seq = 1;

  for (let i = 0; i < tasks.length; i++) {
    const base = tasks[i];
    if (visited.has(base.id)) continue;

    const cluster: AnalyzedTask[] = [base];
    let bestScore = 0;
    let bestReason = '';

    for (let j = i + 1; j < tasks.length; j++) {
      const candidate = tasks[j];
      if (visited.has(candidate.id)) continue;
      const sim = computeTaskSimilarity(base, candidate);
      if (sim.score >= threshold) {
        cluster.push(candidate);
        if (sim.score > bestScore) {
          bestScore = sim.score;
          bestReason = sim.reason;
        }
      }
    }

    if (cluster.length >= 2) {
      for (const item of cluster) visited.add(item.id);

      const groupId = `dup-grp-${seq}`;
      const mergeId = `merge-${seq}`;
      seq++;

      const mergedSubSteps = Array.from(
        new Set(cluster.flatMap((t) => t.subSteps))
      );
      const mergedQuantities = cluster.flatMap((t) => t.quantities).filter(
        (q, idx, arr) =>
          arr.findIndex(
            (other) =>
              normalizeVietnamese(other.raw) === normalizeVietnamese(q.raw)
          ) === idx
      );
      const mergedSourceTexts = Array.from(
        new Set(cluster.map((t) => t.sourceText))
      );

      duplicateGroups.push({
        id: groupId,
        taskIds: cluster.map((t) => t.id),
        canonicalConcept: base.canonicalConcept,
        similarityScore: Number(bestScore.toFixed(2)),
        reason: bestReason,
      });

      mergeSuggestions.push({
        id: mergeId,
        sourceTaskIds: cluster.map((t) => t.id),
        sourceTitles: cluster.map((t) => t.title),
        canonicalTitle: chooseMergedTitle(cluster),
        canonicalConcept: base.canonicalConcept,
        similarityScore: Number(bestScore.toFixed(2)),
        reason: bestReason,
        mergedSubSteps,
        mergedQuantities,
        mergedSourceTexts,
      });
    }
  }

  return { duplicateGroups, mergeSuggestions };
}

/**
 * Gộp các node trùng lặp một cách lossless (không mất chi tiết hay quan hệ phụ thuộc).
 * Hàm thuần, không mutate mảng hoặc phần tử đầu vào.
 */
export function applyMergeSuggestions(
  tasks: AnalyzedTask[],
  dependencies: TaskDependency[],
  suggestionsToApply: MergeSuggestion[]
): {
  tasks: AnalyzedTask[];
  dependencies: TaskDependency[];
} {
  if (suggestionsToApply.length === 0) {
    return {
      tasks: tasks.map((t) => ({
        ...t,
        subSteps: [...t.subSteps],
        quantities: [...t.quantities],
      })),
      dependencies: dependencies.map((d) => ({ ...d })),
    };
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const redirectMap = new Map<string, string>();
  const mergedReplacementMap = new Map<string, AnalyzedTask>();

  for (const sug of suggestionsToApply) {
    const members = sug.sourceTaskIds
      .map((id) => taskMap.get(id))
      .filter((t): t is AnalyzedTask => Boolean(t));
    if (members.length < 2) continue;

    const primary = members[0];
    for (const member of members) {
      redirectMap.set(member.id, primary.id);
    }

    const bestAppMember = members.find((m) => Boolean(m.linkedAppId));
    const maxConfidence = Math.max(...members.map((m) => m.confidence));
    const priorityRank = { high: 3, medium: 2, low: 1 } as const;
    const highestPriority = [...members].sort(
      (a, b) => priorityRank[b.priority] - priorityRank[a.priority]
    )[0].priority;

    // Preserve unique distinguishing details from source titles as subSteps if needed
    const extraSubSteps = new Set<string>(sug.mergedSubSteps);
    for (const m of members) {
      if (m.title !== sug.canonicalTitle) {
        extraSubSteps.add(`Bao gồm ý: "${m.title}"`);
      }
    }

    mergedReplacementMap.set(primary.id, {
      ...primary,
      title: sug.canonicalTitle,
      normalizedTitle: normalizeVietnamese(sug.canonicalTitle),
      subSteps: Array.from(extraSubSteps),
      quantities: [...sug.mergedQuantities],
      linkedAppId: bestAppMember?.linkedAppId ?? primary.linkedAppId,
      linkedAppName: bestAppMember?.linkedAppName ?? primary.linkedAppName,
      confidence: maxConfidence,
      priority: highestPriority,
      sourceText: sug.mergedSourceTexts.join(' + '),
      mergedFromTitles: members.map((m) => m.title),
    });
  }

  const emittedIds = new Set<string>();
  const nextTasks: AnalyzedTask[] = [];
  for (const task of tasks) {
    const targetId = redirectMap.get(task.id) ?? task.id;
    if (emittedIds.has(targetId)) continue;
    emittedIds.add(targetId);

    const replacement = mergedReplacementMap.get(targetId);
    if (replacement) {
      nextTasks.push(replacement);
    } else {
      nextTasks.push({
        ...task,
        subSteps: [...task.subSteps],
        quantities: [...task.quantities],
      });
    }
  }

  const edgeKeys = new Set<string>();
  const nextDependencies: TaskDependency[] = [];
  for (const dep of dependencies) {
    const mappedFrom = redirectMap.get(dep.fromTaskId) ?? dep.fromTaskId;
    const mappedTo = redirectMap.get(dep.toTaskId) ?? dep.toTaskId;
    if (mappedFrom === mappedTo) continue;
    const key = `${mappedFrom}->${mappedTo}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    nextDependencies.push({
      ...dep,
      fromTaskId: mappedFrom,
      toTaskId: mappedTo,
    });
  }

  return { tasks: nextTasks, dependencies: nextDependencies };
}

function wouldAddEdgeCreateCycle(
  taskIds: string[],
  edges: TaskDependency[],
  fromId: string,
  toId: string
): boolean {
  if (fromId === toId) return true;
  const adj = new Map<string, string[]>();
  for (const id of taskIds) adj.set(id, []);
  for (const e of edges) {
    adj.get(e.fromTaskId)?.push(e.toTaskId);
  }
  // Check if fromId is reachable from toId
  const stack = [toId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === fromId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const nxt of adj.get(curr) ?? []) {
      stack.push(nxt);
    }
  }
  return false;
}

function inferLogicalDependencies(
  tasks: AnalyzedTask[],
  explicitDependencies: TaskDependency[]
): TaskDependency[] {
  const taskIds = tasks.map((t) => t.id);
  const taskIdSet = new Set(taskIds);
  const result: TaskDependency[] = explicitDependencies
    .filter((d) => taskIdSet.has(d.fromTaskId) && taskIdSet.has(d.toTaskId))
    .map((d) => ({ ...d }));

  const existingPairs = new Set(
    result.map((d) => `${d.fromTaskId}->${d.toTaskId}`)
  );
  let seq = 1;

  const tryAddLogicalEdge = (
    from: AnalyzedTask,
    to: AnalyzedTask,
    reason: string,
    confidence = 0.86
  ) => {
    const key = `${from.id}->${to.id}`;
    if (existingPairs.has(key)) return;
    if (wouldAddEdgeCreateCycle(taskIds, result, from.id, to.id)) return;
    existingPairs.add(key);
    result.push({
      id: `dep-log-${seq++}`,
      fromTaskId: from.id,
      toTaskId: to.id,
      kind: 'logical',
      reason,
      confidence,
    });
  };

  // Rule 1: Exam preparation lifecycle
  const examPrepTasks = tasks.filter(
    (t) => t.canonicalConcept === 'prepare_create:exam'
  );
  const answerReviewTasks = tasks.filter(
    (t) => t.canonicalConcept === 'review_check:answer_key'
  );
  const mixTasks = tasks.filter(
    (t) => t.canonicalConcept === 'mix_shuffle:exam'
  );
  const printTasks = tasks.filter(
    (t) => t.verbAction === 'print_publish' || t.category === 'complete'
  );

  for (const prep of examPrepTasks) {
    for (const rev of answerReviewTasks) {
      tryAddLogicalEdge(prep, rev, 'Phải có đề gốc trước khi kiểm tra đáp án');
    }
    for (const mix of mixTasks) {
      tryAddLogicalEdge(prep, mix, 'Phải soạn đề hoàn chỉnh trước khi trộn mã đề');
    }
  }

  for (const rev of answerReviewTasks) {
    for (const mix of mixTasks) {
      // If teacher stated review before mix (or neutral), checking answer key before mixing prevents bad shuffled codes
      if (rev.sourceOrder < mix.sourceOrder) {
        tryAddLogicalEdge(
          rev,
          mix,
          'Kiểm tra chuẩn đáp án trước khi sinh các mã đề'
        );
      }
    }
  }

  // Rule 2: Lesson preparation lifecycle (resource collection -> design/worksheet -> print)
  const resourceTasks = tasks.filter(
    (t) => t.verbAction === 'find_collect' && t.objectTarget === 'resource_material'
  );
  const buildLessonTasks = tasks.filter(
    (t) =>
      t.objectTarget === 'activity' ||
      t.objectTarget === 'worksheet' ||
      t.objectTarget === 'lesson_plan' ||
      t.objectTarget === 'rubric'
  );

  for (const res of resourceTasks) {
    for (const build of buildLessonTasks) {
      tryAddLogicalEdge(
        res,
        build,
        'Tìm ngữ liệu làm đầu vào trước khi thiết kế hoạt động / phiếu học tập'
      );
    }
  }

  // Rule 3: Any print/publish/complete task succeeds upstream preparation, review, and mixing tasks
  for (const pub of printTasks) {
    for (const upstream of tasks) {
      if (upstream.id === pub.id) continue;
      if (upstream.category === 'complete') continue;
      if (upstream.sourceOrder < pub.sourceOrder || tasks.length <= 6) {
        // Avoid redundant transitive edge if pub already has direct incoming path from upstream
        tryAddLogicalEdge(
          upstream,
          pub,
          'Hoàn tất công việc chuẩn bị/xử lý trước khi in ấn hoặc xuất bản',
          0.84
        );
      }
    }
  }

  // Simplify redundant transitive print edges when explicit/logical chains already exist
  return pruneRedundantTransitiveEdges(result);
}

function pruneRedundantTransitiveEdges(edges: TaskDependency[]): TaskDependency[] {
  // Keep all explicit edges; only prune logical edges that are strictly redundant via another path
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.fromTaskId)) adj.set(e.fromTaskId, []);
    adj.get(e.fromTaskId)!.push(e.toTaskId);
  }

  const hasIndirectPath = (start: string, target: string): boolean => {
    const queue = (adj.get(start) ?? []).filter((n) => n !== target);
    const visited = new Set<string>();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === target) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const nxt of adj.get(curr) ?? []) {
        queue.push(nxt);
      }
    }
    return false;
  };

  return edges.filter((e) => {
    if (e.kind === 'explicit') return true;
    return !hasIndirectPath(e.fromTaskId, e.toTaskId);
  });
}

function runKahnTopologicalSort(
  tasks: AnalyzedTask[],
  dependencies: TaskDependency[]
): {
  topologicalOrder: string[];
  orderedTasks: AnalyzedTask[];
  hasCycle: boolean;
} {
  if (tasks.length === 0) {
    return { topologicalOrder: [], orderedTasks: [], hasCycle: false };
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    outgoing.set(t.id, []);
  }
  for (const d of dependencies) {
    if (!taskById.has(d.fromTaskId) || !taskById.has(d.toTaskId)) continue;
    outgoing.get(d.fromTaskId)!.push(d.toTaskId);
    inDegree.set(d.toTaskId, (inDegree.get(d.toTaskId) ?? 0) + 1);
  }

  const compareTieBreak = (idA: string, idB: string): number => {
    const tA = taskById.get(idA)!;
    const tB = taskById.get(idB)!;
    return tA.sourceOrder - tB.sourceOrder;
  };

  const readyQueue = tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id)
    .sort(compareTieBreak);

  const order: string[] = [];
  while (readyQueue.length > 0) {
    const currId = readyQueue.shift()!;
    order.push(currId);

    for (const nxtId of outgoing.get(currId) ?? []) {
      const nextDeg = (inDegree.get(nxtId) ?? 0) - 1;
      inDegree.set(nxtId, nextDeg);
      if (nextDeg === 0) {
        readyQueue.push(nxtId);
        readyQueue.sort(compareTieBreak);
      }
    }
  }

  const hasCycle = order.length < tasks.length;
  if (hasCycle) {
    const inOrder = new Set(order);
    for (const t of tasks) {
      if (!inOrder.has(t.id)) order.push(t.id);
    }
  }

  return {
    topologicalOrder: order,
    orderedTasks: order.map((id) => taskById.get(id)!),
    hasCycle,
  };
}

function computeParallelLayers(
  orderedTasks: AnalyzedTask[],
  dependencies: TaskDependency[]
): ParallelTaskLayer[] {
  if (orderedTasks.length === 0) return [];
  const taskById = new Map(orderedTasks.map((t) => [t.id, t]));
  const incoming = new Map<string, string[]>();
  for (const t of orderedTasks) incoming.set(t.id, []);
  for (const d of dependencies) {
    if (taskById.has(d.fromTaskId) && taskById.has(d.toTaskId)) {
      incoming.get(d.toTaskId)!.push(d.fromTaskId);
    }
  }

  const levelMap = new Map<string, number>();
  for (const t of orderedTasks) {
    const preds = incoming.get(t.id) ?? [];
    const level =
      preds.length === 0
        ? 0
        : Math.max(...preds.map((pId) => levelMap.get(pId) ?? 0)) + 1;
    levelMap.set(t.id, level);
  }

  const layersByLevel = new Map<number, AnalyzedTask[]>();
  for (const t of orderedTasks) {
    const lvl = levelMap.get(t.id) ?? 0;
    if (!layersByLevel.has(lvl)) layersByLevel.set(lvl, []);
    layersByLevel.get(lvl)!.push(t);
  }

  return Array.from(layersByLevel.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([level, layerTasks]) => ({
      level,
      taskIds: layerTasks.map((t) => t.id),
      taskTitles: layerTasks.map((t) => t.title),
      canRunInParallel: layerTasks.length >= 2,
    }));
}

function buildWorkflowGroups(orderedTasks: AnalyzedTask[]): WorkflowTaskGroup[] {
  const metaMap: Record<
    WorkflowGroupKey,
    { title: string; category: WorkCategoryV2; order: number }
  > = {
    preparation: { title: 'Chuẩn bị & Thiết kế', category: 'prepare', order: 1 },
    verification: { title: 'Kiểm tra & Rà soát', category: 'review', order: 2 },
    execution: { title: 'Thực hiện & Triển khai', category: 'execute', order: 3 },
    completion: { title: 'Hoàn tất & Xuất bản', category: 'complete', order: 4 },
    general: { title: 'Công việc chung', category: 'unclassified', order: 5 },
  };

  const buckets = new Map<WorkflowGroupKey, AnalyzedTask[]>();
  for (const t of orderedTasks) {
    if (!buckets.has(t.groupKey)) buckets.set(t.groupKey, []);
    buckets.get(t.groupKey)!.push(t);
  }

  return Array.from(buckets.entries())
    .map(([key, items]) => ({
      id: `grp-${key}`,
      key,
      title: metaMap[key].title,
      category: metaMap[key].category,
      taskIds: items.map((t) => t.id),
      order: metaMap[key].order,
    }))
    .sort((a, b) => a.order - b.order);
}

function buildChecklists(tasks: AnalyzedTask[]): TaskChecklistBlueprint[] {
  const blueprints: TaskChecklistBlueprint[] = [];

  for (const task of tasks) {
    let labels = [...task.subSteps];

    if (labels.length === 0) {
      if (task.canonicalConcept === 'review_check:answer_key') {
        labels = [
          'Đối chiếu đáp án chuẩn với từng câu hỏi',
          'Kiểm tra dấu, phân số và đơn vị kết quả',
        ];
      } else if (task.canonicalConcept === 'mix_shuffle:exam') {
        const qty = task.quantities[0]?.raw ?? 'các mã đề';
        labels = [
          'Khóa thứ tự câu hỏi phụ thuộc (nếu có)',
          `Sinh đủ ${qty} và xuất bảng đáp án đối chiếu`,
        ];
      } else if (task.verbAction === 'print_publish') {
        labels = [
          'Kiểm tra bố cục A4, lề in và trang ngắt',
          'In bản chính và kiểm tra chất lượng bản in',
        ];
      } else if (task.objectTarget === 'worksheet') {
        labels = [
          'Xác định mức độ câu hỏi/bài tập cho học sinh',
          'Kiểm tra không gian làm bài trên phiếu',
        ];
      }
    }

    if (labels.length > 0) {
      blueprints.push({
        taskId: task.id,
        taskTitle: task.title,
        items: labels.map((label, idx) => ({
          id: `${task.id}-chk-${idx + 1}`,
          label,
          done: false,
        })),
      });
    }
  }

  return blueprints;
}

export function recommendNextActions(
  orderedTasks: AnalyzedTask[],
  dependencies: TaskDependency[],
  completedTaskIds?: ReadonlySet<string> | string[]
): NextRecommendedAction[] {
  const doneSet = new Set<string>(
    completedTaskIds ? Array.from(completedTaskIds) : []
  );
  for (const t of orderedTasks) {
    if (t.status === 'done') doneSet.add(t.id);
  }

  const taskById = new Map(orderedTasks.map((t) => [t.id, t]));
  const prereqsMap = new Map<string, string[]>();
  const unlocksMap = new Map<string, string[]>();
  for (const t of orderedTasks) {
    prereqsMap.set(t.id, []);
    unlocksMap.set(t.id, []);
  }
  for (const d of dependencies) {
    if (!taskById.has(d.fromTaskId) || !taskById.has(d.toTaskId)) continue;
    prereqsMap.get(d.toTaskId)!.push(d.fromTaskId);
    unlocksMap.get(d.fromTaskId)!.push(d.toTaskId);
  }

  const readyTasks: NextRecommendedAction[] = [];

  for (const task of orderedTasks) {
    if (doneSet.has(task.id)) continue;
    const unfinishedPrereqs = (prereqsMap.get(task.id) ?? []).filter(
      (pId) => !doneSet.has(pId)
    );
    if (unfinishedPrereqs.length === 0) {
      const unlocksCount = (unlocksMap.get(task.id) ?? []).filter(
        (uId) => !doneSet.has(uId)
      ).length;

      readyTasks.push({
        taskId: task.id,
        title: task.title,
        category: task.category,
        priority: task.priority,
        reason:
          unlocksCount > 0
            ? `Sẵn sàng thực hiện ngay · mở khóa ${unlocksCount} bước tiếp theo`
            : 'Sẵn sàng thực hiện ngay (không có bước chặn trước)',
        linkedAppId: task.linkedAppId,
        linkedAppName: task.linkedAppName,
        blockedByCount: 0,
        unlocksCount,
      });
    }
  }

  const priorityRank = { high: 3, medium: 2, low: 1 } as const;
  return readyTasks.sort((a, b) => {
    if (b.unlocksCount !== a.unlocksCount) return b.unlocksCount - a.unlocksCount;
    return priorityRank[b.priority] - priorityRank[a.priority];
  });
}

function categoryColor(category: WorkCategoryV2): CanvasColorKey {
  switch (category) {
    case 'prepare':
      return 'blue';
    case 'review':
      return 'amber';
    case 'execute':
      return 'indigo';
    case 'complete':
      return 'emerald';
    default:
      return 'slate';
  }
}

export function buildWorkflowTreeBlueprint(params: {
  plan: ParsedWorkflowPlan;
  orderedTasks: AnalyzedTask[];
  groups: WorkflowTaskGroup[];
  dependencies: TaskDependency[];
  checklists: TaskChecklistBlueprint[];
}): WorkflowTreeBlueprint {
  const { plan, orderedTasks, groups, dependencies, checklists } = params;
  const checklistByTaskId = new Map(checklists.map((c) => [c.taskId, c.items]));
  const nodes: TreeBlueprintNode[] = [];
  const edges: TreeBlueprintEdge[] = [];

  const rootId = 'bp-root-1';
  const metaSubtitle = [
    plan.subject.value ? `Môn: ${plan.subject.value}` : null,
    plan.grade.label,
    plan.deadline.text
      ? plan.deadline.isoDate
        ? `Hạn: ${plan.deadline.text} (${plan.deadline.isoDate})`
        : `Mốc nêu: ${plan.deadline.text} (cần xác nhận)`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  nodes.push({
    id: rootId,
    kind: 'root',
    canvasType: 'root',
    title: plan.goal.value || 'Kế hoạch công việc',
    description: plan.isLowDetail
      ? 'Mục tiêu chung (thiếu chi tiết — giữ 1 node để thầy/cô xác nhận, không tự bịa công việc).'
      : metaSubtitle,
    parentId: null,
    color: 'blue',
    category: 'prepare',
    priority: 'medium',
    confidence: plan.goal.confidence,
    orderIndex: 0,
  });

  if (orderedTasks.length === 0) {
    return { rootNodeId: rootId, nodes, edges };
  }

  const taskById = new Map(orderedTasks.map((t) => [t.id, t]));
  const taskNodeIdMap = new Map<string, string>();
  let orderCursor = 1;
  let edgeSeq = 1;

  for (const grp of groups) {
    const branchId = `bp-branch-${grp.key}`;
    nodes.push({
      id: branchId,
      kind: 'branch',
      canvasType: 'workflow',
      title: grp.title,
      description: `Nhóm ${grp.taskIds.length} đầu việc`,
      parentId: rootId,
      color: categoryColor(grp.category),
      category: grp.category,
      priority: 'medium',
      confidence: 0.9,
      orderIndex: orderCursor++,
    });

    edges.push({
      id: `bp-edge-${edgeSeq++}`,
      source: rootId,
      target: branchId,
      edgeType: 'parent',
    });

    for (const tId of grp.taskIds) {
      const task = taskById.get(tId);
      if (!task) continue;
      const bpTaskId = `bp-${task.id}`;
      taskNodeIdMap.set(task.id, bpTaskId);

      const items = checklistByTaskId.get(task.id);
      const canvasType: CanvasNodeType =
        items && items.length > 0 && task.subSteps.length > 0
          ? 'checklist'
          : task.category === 'complete'
          ? 'milestone'
          : 'task';

      nodes.push({
        id: bpTaskId,
        kind: 'task',
        canvasType,
        title: task.title,
        description: task.linkedAppName
          ? `Ứng dụng gợi ý: ${task.linkedAppName}`
          : '',
        parentId: branchId,
        color: categoryColor(task.category),
        category: task.category,
        priority: task.priority,
        status: task.status,
        linkedAppId: task.linkedAppId,
        linkedAppName: task.linkedAppName,
        quantityLabel: task.quantities[0]?.raw,
        checklist: items,
        confidence: task.confidence,
        orderIndex: orderCursor++,
      });

      edges.push({
        id: `bp-edge-${edgeSeq++}`,
        source: branchId,
        target: bpTaskId,
        edgeType: 'parent',
      });
    }
  }

  for (const dep of dependencies) {
    const src = taskNodeIdMap.get(dep.fromTaskId);
    const dst = taskNodeIdMap.get(dep.toTaskId);
    if (!src || !dst || src === dst) continue;
    edges.push({
      id: `bp-edge-${edgeSeq++}`,
      source: src,
      target: dst,
      edgeType: 'dependency',
      label: dep.kind === 'explicit' ? 'Theo trình tự' : 'Phụ thuộc logic',
      kind: dep.kind,
    });
  }

  return { rootNodeId: rootId, nodes, edges };
}

export function optimizeWorkflowPlan(
  plan: ParsedWorkflowPlan,
  options?: OptimizeWorkflowOptions
): OptimizedWorkflowPlan {
  const threshold = options?.mergeSimilarityThreshold ?? 0.8;

  // Clone defensively so sourcePlan is never mutated
  let workingTasks: AnalyzedTask[] = plan.tasks.map((t) => ({
    ...t,
    subSteps: [...t.subSteps],
    quantities: [...t.quantities],
  }));
  let workingDependencies: TaskDependency[] = plan.dependencies.map((d) => ({
    ...d,
  }));

  const { duplicateGroups, mergeSuggestions } = detectDuplicatesAndMergeSuggestions(
    workingTasks,
    threshold
  );

  if (options?.autoApplyMerge && mergeSuggestions.length > 0) {
    const merged = applyMergeSuggestions(
      workingTasks,
      workingDependencies,
      mergeSuggestions
    );
    workingTasks = merged.tasks;
    workingDependencies = merged.dependencies;
  }

  const allDependencies = inferLogicalDependencies(
    workingTasks,
    workingDependencies
  );
  const { topologicalOrder, orderedTasks, hasCycle } = runKahnTopologicalSort(
    workingTasks,
    allDependencies
  );
  const groups = buildWorkflowGroups(orderedTasks);
  const parallelGroups = computeParallelLayers(orderedTasks, allDependencies);
  const checklists = buildChecklists(orderedTasks);
  const nextRecommendedActions = recommendNextActions(
    orderedTasks,
    allDependencies,
    options?.completedTaskIds
  );
  const treeBlueprint = buildWorkflowTreeBlueprint({
    plan,
    orderedTasks,
    groups,
    dependencies: allDependencies,
    checklists,
  });

  return {
    sourcePlan: plan,
    tasks: workingTasks,
    groups,
    dependencies: allDependencies,
    topologicalOrder,
    orderedTasks,
    parallelGroups,
    duplicateGroups,
    mergeSuggestions,
    checklists,
    nextRecommendedActions,
    treeBlueprint,
    hasCycle,
    optimizationSummary: {
      originalTaskCount: plan.tasks.length,
      optimizedTaskCount: orderedTasks.length,
      mergedGroupCount: mergeSuggestions.length,
      dependencyCount: allDependencies.length,
      parallelLayerCount: parallelGroups.filter((l) => l.canRunInParallel).length,
      negatedExclusionCount: plan.negations.length,
    },
  };
}
