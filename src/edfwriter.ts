// SPDX-License-Identifier: MPL-2.0
//
// Copyright (C) 2025 The OpenPSG Authors.

import { EDFHeader, EDFSignal, EDFAnnotation } from "./edftypes";

export class EDFWriter {
  private textEncoder = new TextEncoder();

  constructor(
    private header: EDFHeader,
    private signalData: number[][],
    private annotations?: EDFAnnotation[],
  ) {}

  write(): ArrayBuffer {
    const { header, signalData } = this;
    const signalCount = header.signalCount;
    const records = header.dataRecords;

    // Validate signal data
    if (signalData.length !== signalCount) {
      throw new Error("Signal data length does not match signal count");
    }

    for (let i = 0; i < signalCount; i++) {
      const signal = header.signals[i];
      const expectedSamples = signal.samplesPerRecord * records;
      const currentSamples = signalData[i].length;

      if (currentSamples < expectedSamples) {
        const padAmount = expectedSamples - currentSamples;
        signalData[i] = signalData[i].concat(Array(padAmount).fill(0));
      } else if (currentSamples > expectedSamples) {
        throw new Error(
          `Signal ${i} has too many samples (${currentSamples} > ${expectedSamples})`,
        );
      }
    }

    // Build header string
    const headerString = this.buildHeader();
    const headerBytes = this.textEncoder.encode(headerString);
    const dataBytes: number[] = [];

    // Prepare annotations if present
    const annotationSignalIndex = header.signals.findIndex((sig) =>
      sig.label.includes("EDF Annotations"),
    );
    const hasAnnotations = annotationSignalIndex !== -1;

    for (let rec = 0; rec < records; rec++) {
      // Write each signal's samples for this record
      for (let s = 0; s < signalCount; s++) {
        const signal = header.signals[s];
        const start = rec * signal.samplesPerRecord;
        const end = start + signal.samplesPerRecord;

        if (hasAnnotations && s === annotationSignalIndex) {
          const annText = this.generateAnnotationBlock(rec);
          const encodedAnn = this.encodeAnnotationSignal(
            annText,
            signal.samplesPerRecord * 2,
          );
          dataBytes.push(...encodedAnn);
        } else {
          for (const sample of signalData[s].slice(start, end)) {
            const raw = this.physicalToDigital(sample, signal);
            dataBytes.push(raw & 0xff, (raw >> 8) & 0xff); // Little endian
          }
        }
      }
    }

    const fullBuffer = new Uint8Array(headerBytes.length + dataBytes.length);
    fullBuffer.set(headerBytes);
    fullBuffer.set(dataBytes, headerBytes.length);

    return fullBuffer.buffer;
  }

  private buildHeader(): string {
    const { header } = this;
    const field = (val: string, length: number): string =>
      val.padEnd(length).substring(0, length);

    const startTime = header.startTime;
    const dateStr = startTime.toISOString().slice(2, 10).replace(/-/g, ".");
    const timeStr = startTime.toTimeString().slice(0, 8).replace(/:/g, ".");

    let text = "";
    text += field(header.version, 8);
    text += field(header.patientId, 80);
    text += field(header.recordingId, 80);
    text += field(dateStr, 8);
    text += field(timeStr, 8);
    text += field(String(header.headerBytes), 8);
    text += field(header.reserved, 44);
    text += field(String(header.dataRecords), 8);
    text += field(header.recordDuration.toFixed(6), 8);
    text += field(String(header.signalCount), 4);

    const signals = header.signals;
    const collect = (cb: (s: EDFSignal) => string, len: number) =>
      signals
        .map(cb)
        .map((v) => field(v, len))
        .join("");

    text += collect((s) => s.label, 16);
    text += collect((s) => s.transducerType, 80);
    text += collect((s) => s.physicalDimension, 8);
    text += collect((s) => s.physicalMin.toString(), 8);
    text += collect((s) => s.physicalMax.toString(), 8);
    text += collect((s) => s.digitalMin.toString(), 8);
    text += collect((s) => s.digitalMax.toString(), 8);
    text += collect((s) => s.prefiltering, 80);
    text += collect((s) => s.samplesPerRecord.toString(), 8);
    text += collect((s) => s.reserved, 32);

    return text;
  }

  private physicalToDigital(value: number, signal: EDFSignal): number {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (physicalMax === physicalMin) return 0;
    const digital = Math.round(
      ((value - physicalMin) * (digitalMax - digitalMin)) /
        (physicalMax - physicalMin) +
        digitalMin,
    );
    return Math.max(digitalMin, Math.min(digitalMax, digital));
  }

  private encodeAnnotationSignal(text: string, byteLength: number): number[] {
    const encoded = new TextEncoder().encode(text);
    const buf = new Uint8Array(byteLength);
    buf.set(encoded.slice(0, byteLength));
    return Array.from(buf);
  }

  private generateAnnotationBlock(record: number): string {
    if (!this.annotations) return "";
    const startTime = record * this.header.recordDuration;
    const endTime = startTime + this.header.recordDuration;

    const anns = this.annotations.filter(
      (a) => a.onset >= startTime && a.onset < endTime,
    );

    let text = "";
    for (const ann of anns) {
      text += `+${ann.onset.toFixed(3)}\u0015${ann.duration?.toFixed(3) ?? ""}\u0014${ann.annotation}\u0014`;
    }
    text += "\u0000"; // null terminator
    return text;
  }
}
