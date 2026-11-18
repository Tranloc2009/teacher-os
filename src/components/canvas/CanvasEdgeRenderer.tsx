import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { CanvasEdgeType } from '../../types/canvas';

export interface CanvasFlowEdgeData extends Record<string, unknown> {
  edgeType: CanvasEdgeType;
  label?: string;
}

export type CanvasFlowEdge = Edge<CanvasFlowEdgeData, 'teacherosEdge'>;

export const CanvasEdgeRenderer = memo(function CanvasEdgeRenderer({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  markerEnd,
}: EdgeProps<CanvasFlowEdge>) {
  const edgeType: CanvasEdgeType = data?.edgeType ?? 'parent';

  const [edgePath, labelX, labelY] =
    edgeType === 'dependency'
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 12,
        })
      : getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        });

  const strokeColor = selected
    ? '#2563eb'
    : edgeType === 'dependency'
    ? '#2563eb'
    : edgeType === 'reference'
    ? '#d97706'
    : '#94a3b8';

  const strokeDasharray =
    edgeType === 'dependency'
      ? '6 4'
      : edgeType === 'reference'
      ? '3 3'
      : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : edgeType === 'parent' ? 1.75 : 2,
          strokeDasharray,
        }}
      />
      {(data?.label || edgeType !== 'parent') && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan absolute rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap shadow-2xs ${
              selected
                ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100'
                : edgeType === 'dependency'
                ? 'border-blue-200 bg-white/95 text-blue-700 dark:border-blue-800 dark:bg-slate-900/95 dark:text-blue-300'
                : 'border-amber-200 bg-white/95 text-amber-800 dark:border-amber-800 dark:bg-slate-900/95 dark:text-amber-300'
            }`}
          >
            {data?.label ||
              (edgeType === 'dependency' ? 'Phụ thuộc' : 'Tham khảo')}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
