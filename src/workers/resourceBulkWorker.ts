import {
  analyzeFileContentSafe,
  classifyResourceFromAnalysis,
} from '../core/resourceClassifier';
import {
  ExtractedFileAnalysis,
  ResourceClassificationSuggestion,
  SupportedResourceFormat,
} from '../types/resourceBulk';

export interface WorkerAnalyzeRequestItem {
  tempId: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  file: File;
}

export interface WorkerAnalyzeRequest {
  requestId: string;
  items: WorkerAnalyzeRequestItem[];
}

export interface WorkerAnalyzeResultItem {
  tempId: string;
  sizeBytes: number;
  sha256: string;
  format: SupportedResourceFormat;
  safeToStore: boolean;
  blockedReason?: string;
  analysis: ExtractedFileAnalysis;
  suggestion: ResourceClassificationSuggestion;
}

export interface WorkerAnalyzeResponse {
  requestId: string;
  results: WorkerAnalyzeResultItem[];
  error?: string;
}

async function computeSha256HexInWorker(buffer: ArrayBuffer): Promise<string> {
  const digest = await self.crypto.subtle.digest('SHA-256', buffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

self.onmessage = async (event: MessageEvent<WorkerAnalyzeRequest>) => {
  const { requestId, items } = event.data;
  try {
    const results: WorkerAnalyzeResultItem[] = [];
    for (const item of items) {
      const buffer = await item.file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const sha256 = await computeSha256HexInWorker(buffer);
      const analysis = await analyzeFileContentSafe(
        item.fileName,
        bytes,
        item.mimeType
      );
      const suggestion = classifyResourceFromAnalysis(
        item.fileName,
        item.relativePath,
        analysis
      );
      results.push({
        tempId: item.tempId,
        sizeBytes: bytes.byteLength,
        sha256,
        format: analysis.format,
        safeToStore: analysis.safeToStore,
        blockedReason: analysis.blockedReason,
        analysis,
        suggestion,
      });
    }
    const response: WorkerAnalyzeResponse = { requestId, results };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerAnalyzeResponse = {
      requestId,
      results: [],
      error: err instanceof Error ? err.message : 'Lỗi xử lý lô trong Web Worker.',
    };
    self.postMessage(response);
  }
};
