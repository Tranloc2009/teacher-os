/// <reference lib="webworker" />

import type {
  OmrThresholdsConfig,
  RgbaImageBuffer,
} from '../../types/grading';
import { computeImageDHash } from './cameraFrameAssist';
import {
  runLocalOmrVisionPipeline,
  type OmrRecognitionResult,
} from './omrVisionEngine';

export interface OmrWorkerRequest {
  id: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  questionCount: number;
  thresholds: OmrThresholdsConfig;
}

export interface OmrWorkerResponse {
  id: string;
  ok: boolean;
  recognition?: OmrRecognitionResult;
  imageDHash?: string;
  error?: string;
}

self.onmessage = (event: MessageEvent<OmrWorkerRequest>) => {
  const { id, width, height, buffer, questionCount, thresholds } = event.data;
  try {
    const rgba: RgbaImageBuffer = {
      width,
      height,
      data: new Uint8ClampedArray(buffer),
    };
    const imageDHash = computeImageDHash(rgba);
    const recognition = runLocalOmrVisionPipeline(
      rgba,
      questionCount,
      thresholds
    );
    const response: OmrWorkerResponse = {
      id,
      ok: true,
      recognition,
      imageDHash,
    };
    self.postMessage(response);
  } catch (err) {
    const response: OmrWorkerResponse = {
      id,
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Lỗi không xác định trong Web Worker nhận diện OMR.',
    };
    self.postMessage(response);
  }
};
