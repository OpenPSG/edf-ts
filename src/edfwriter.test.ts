// SPDX-License-Identifier: MPL-2.0
//
// Copyright (C) 2025 The OpenPSG Authors.

import fs from "fs";
import path from "path";
import { EDFWriter } from "./edfwriter";
import { EDFHeader, EDFSignal, EDFAnnotation } from "./edftypes";

function createTestHeader(signalCount = 1, records = 1): EDFHeader {
  const signals: EDFSignal[] = Array(signalCount)
    .fill(null)
    .map((_, i) => ({
      label: `Signal${i + 1}`,
      transducerType: "Transducer",
      physicalDimension: "uV",
      physicalMin: -100,
      physicalMax: 100,
      digitalMin: -32768,
      digitalMax: 32767,
      prefiltering: "None",
      samplesPerRecord: 10,
      reserved: "",
    }));

  return {
    version: "0",
    patientId: "Test Patient",
    recordingId: "Test Recording",
    startTime: new Date("2023-01-01T00:00:00"),
    headerBytes: 256 + 256 * signalCount,
    reserved: "EDF+C",
    dataRecords: records,
    recordDuration: 1,
    signalCount,
    signals,
  };
}

describe("EDFWriter", () => {
  it("writes a simple EDF file without annotations", () => {
    const header = createTestHeader(1, 2);
    const signalData = [[...Array(20).keys()].map((i) => i - 10)];

    const writer = new EDFWriter(header, signalData);
    const buffer = writer.write();

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(header.headerBytes);
  });

  it("pads signal data when too short", () => {
    const header = createTestHeader(1, 2);
    const signalData = [[1, 2, 3]]; // too short, will be padded

    const writer = new EDFWriter(header, signalData);
    const buffer = writer.write();

    expect(buffer.byteLength).toBeGreaterThan(header.headerBytes);
  });

  it("throws if signal data is too long", () => {
    const header = createTestHeader(1, 1);
    const signalData = [[...Array(20).fill(0)]]; // too long

    expect(() => new EDFWriter(header, signalData).write()).toThrow();
  });

  it("writes with annotations if present", () => {
    const header = createTestHeader(2, 1);
    header.signals[1].label = "EDF Annotations";

    const signalData = [
      Array(10).fill(0), // actual signal
      [], // annotation signal is empty (generated internally)
    ];

    const annotations: EDFAnnotation[] = [
      { onset: 0, duration: 0.5, annotation: "Start" },
      { onset: 0.5, annotation: "Event A" },
    ];

    const writer = new EDFWriter(header, signalData, annotations);
    const buffer = writer.write();

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(header.headerBytes);
  });

  it("writes a test signal to an EDF file", async () => {
    const recordDuration = 30; // seconds
    const records = 10; // number of records
    const sampleRate = 256; // Hz
    const totalSamples = sampleRate * recordDuration * records; // total samples

    const frequency = 10; // Hz
    const amplitude = 75; // microvolts

    const sineWave = Array.from({ length: totalSamples }, (_, i) => {
      const t = i / sampleRate;
      return amplitude * Math.sin(2 * Math.PI * frequency * t);
    });

    const header: EDFHeader = {
      version: "0",
      patientId: "Test Patient",
      recordingId: "Test Recording",
      startTime: new Date("2023-01-01T00:00:00"),
      headerBytes: 512,
      reserved: "",
      dataRecords: records,
      recordDuration: recordDuration,
      signalCount: 1,
      signals: [
        {
          label: "Sine Wave",
          transducerType: "Test Transducer",
          physicalDimension: "uV",
          physicalMin: -amplitude,
          physicalMax: amplitude,
          digitalMin: -32768,
          digitalMax: 32767,
          prefiltering: "None",
          samplesPerRecord: sampleRate * recordDuration,
          reserved: "",
        },
      ],
    };

    const writer = new EDFWriter(header, [sineWave]);
    const buffer = writer.write();

    const outPath = path.resolve(__dirname, "test_sine_wave.edf");
    fs.writeFileSync(outPath, Buffer.from(buffer));

    expect(fs.existsSync(outPath)).toBe(true);
  });
});
