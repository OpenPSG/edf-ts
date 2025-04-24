// SPDX-License-Identifier: MPL-2.0
//
// Copyright (C) 2025 The OpenPSG Authors.

import { parse as parseDate } from "date-fns";
import { EDFHeader, EDFSignal, EDFAnnotation, EDFVersion } from "./edftypes";
import _ from "lodash";

export class EDFReader {
  private view: DataView;
  private textDecoder: TextDecoder;
  private byteArray: Uint8Array;
  private header?: EDFHeader;
  private recordTimestamps?: number[];

  constructor(byteArray: Uint8Array) {
    this.textDecoder = new TextDecoder("ascii");
    this.view = new DataView(byteArray.buffer, byteArray.byteOffset);
    this.byteArray = byteArray;
  }

  readHeader(): EDFHeader {
    if (this.header) return this.header;

    const headerText = this.textDecoder.decode(this.byteArray.subarray(0, 256));
    const version = headerText.substring(0, 8).trim() as EDFVersion;
    const patientId = headerText.substring(8, 88).trim();
    const recordingId = headerText.substring(88, 168).trim();
    const startDateStr = headerText.substring(168, 176).trim();
    const startTimeStr = headerText.substring(176, 184).trim();
    const startTime = parseDate(
      `${startDateStr} ${startTimeStr}`,
      "dd.MM.yy HH.mm.ss",
      new Date(),
    );
    const headerBytes = parseInt(headerText.substring(184, 192).trim());
    const reserved = headerText.substring(192, 236).trim();
    const dataRecords = parseInt(headerText.substring(236, 244).trim());
    const recordDuration = parseFloat(headerText.substring(244, 252).trim());
    const signalCount = parseInt(headerText.substring(252, 256).trim());

    const signals: EDFSignal[] = [];

    for (let i = 0; i < signalCount; i++) {
      const signal: Partial<EDFSignal> = {};
      signal.label = this.readFieldText(signalCount, 0, 16, i).trim();
      signal.transducerType = this.readFieldText(signalCount, 16, 96, i).trim();
      signal.physicalDimension = this.readFieldText(signalCount, 96, 104, i).trim();
      signal.physicalMin = parseFloat(this.readFieldText(signalCount, 104, 112, i));
      signal.physicalMax = parseFloat(this.readFieldText(signalCount, 112, 120, i));
      signal.digitalMin = parseInt(this.readFieldText(signalCount, 120, 128, i));
      signal.digitalMax = parseInt(this.readFieldText(signalCount, 128, 136, i));
      signal.prefiltering = this.readFieldText(signalCount, 136, 216, i).trim();
      signal.samplesPerRecord = parseInt(this.readFieldText(signalCount, 216, 224, i));
      signal.reserved = this.readFieldText(signalCount, 224, 256, i).trim();
      signals.push(signal as EDFSignal);
    }

    this.header = {
      version,
      patientId,
      recordingId,
      startTime,
      headerBytes,
      reserved,
      dataRecords,
      recordDuration,
      signalCount,
      signals,
    };

    return _.cloneDeep(this.header);
  }

  readSignal(signalIndex: number, recordNumber?: number): number[] {
    const header = this.header ?? this.readHeader();
    const signal = header.signals[signalIndex];
    const samplesPerRecord = signal.samplesPerRecord;
    const samples: number[] = [];

    const offset = header.headerBytes;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );

    const startRecord = recordNumber ?? 0;
    const endRecord =
      recordNumber !== undefined ? recordNumber + 1 : header.dataRecords;

    const signalByteOffset = header.signals
      .slice(0, signalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);

    for (let rec = startRecord; rec < endRecord; rec++) {
      const recOffset = offset + rec * recordSize;

      for (let j = 0; j < samplesPerRecord; j++) {
        const sampleOffset = recOffset + signalByteOffset + j * 2;
        const raw = this.view.getInt16(sampleOffset, true);
        const physical = this.digitalToPhysical(raw, signal);
        samples.push(physical);
      }
    }

    return samples;
  }

  readAnnotations(recordNumber?: number): EDFAnnotation[] {
    const header = this.header ?? this.readHeader();
    const annSignalIndex = header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
    if (annSignalIndex === -1) return [];

    const annotations: EDFAnnotation[] = [];
    const offset = header.headerBytes;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );

    const startRecord = recordNumber ?? 0;
    const endRecord =
      recordNumber !== undefined ? recordNumber + 1 : header.dataRecords;

    const signalByteOffset = header.signals
      .slice(0, annSignalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);

    const annSignal = header.signals[annSignalIndex];
    const bytes = annSignal.samplesPerRecord * 2;

    for (let rec = startRecord; rec < endRecord; rec++) {
      const recOffset = offset + rec * recordSize;
      const start = recOffset + signalByteOffset;
      const end = start + bytes;
      const slice = this.byteArray.subarray(start, end);
      const text = this.textDecoder.decode(slice).replace(/\0/g, "");

      let currentOnset = 0;
      let currentDuration: number | undefined = undefined;

      for (const entry of text.split("\u0014")) {
        if (!entry) continue;

        if (entry.startsWith("+") || /^-?\d+\.?\d*/.test(entry)) {
          const parts = entry.split("\u0015");
          currentOnset = parseFloat(parts[0]) || 0;
          currentDuration =
            parts.length >= 2 ? parseFloat(parts[1]) : undefined;
        } else {
          annotations.push({
            onset: currentOnset,
            duration: currentDuration,
            annotation: entry.trim(),
          });
        }
      }
    }

    return annotations;
  }

  getRecordTimeStamps(): number[] {
    if (this.recordTimestamps) return this.recordTimestamps;

    const header = this.readHeader();

    const timestamps: number[] = new Array(header.dataRecords).fill(0);
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0,
    );
    const annSignalIndex = header.signals.findIndex(sig =>
      sig.label.includes("EDF Annotations")
    );
    const signalByteOffset = header.signals
      .slice(0, annSignalIndex)
      .reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
    const bytes = header.signals[annSignalIndex].samplesPerRecord * 2;

    for (let rec = 0; rec < header.dataRecords; rec++) {
      const recOffset = header.headerBytes + rec * recordSize;
      const start = recOffset + signalByteOffset;
      const end = start + bytes;
      const slice = this.byteArray.subarray(start, end);
      const text = this.textDecoder.decode(slice).replace(/\0/g, "");

      const entries = text.split("\u0014").filter(e => e);
      if (entries.length > 0 && /^[-+]/.test(entries[0])) {
        const parts = entries[0].split("\u0015");
        const offset = parseFloat(parts[0]) || 0;
        timestamps[rec] = offset;
      }
    }

    this.recordTimestamps = timestamps;
    return timestamps;
  }

  private readFieldText(
    signalCount: number,
    start: number,
    end: number,
    signalIndex: number,
  ): string {
    const offset = 256 + start * signalCount + (end - start) * signalIndex;
    return this.textDecoder.decode(
      this.byteArray.subarray(offset, offset + (end - start)),
    );
  }

  private digitalToPhysical(digital: number, signal: EDFSignal): number {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (digitalMax === digitalMin) return 0;
    return (
      physicalMin +
      ((digital - digitalMin) * (physicalMax - physicalMin)) /
        (digitalMax - digitalMin)
    );
  }
}
