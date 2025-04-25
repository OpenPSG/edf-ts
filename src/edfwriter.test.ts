// SPDX-License-Identifier: MPL-2.0
//
// Copyright (C) 2025 The OpenPSG Authors.

import fs from "fs";
import path from "path";
import { EDFWriter } from "./edfwriter";
import { EDFReader } from "./edfreader";
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
    patientId: EDFWriter.patientId({
      hospitalCode: "MCH 0234567",
    }),
    recordingId: EDFWriter.recordingId({
      startDate: new Date("2023-01-01"),
      studyCode: "Test Study",
      technicianCode: "Tech 123",
      equipmentCode: "Equipment 456",
    }),
    startTime: new Date("2023-01-01T00:00:00"),
    headerBytes: 256 + 256 * signalCount,
    reserved: "",
    dataRecords: records,
    recordDuration: 1,
    signalCount,
    signals,
  };
}

// Signal data will be subject to quantization and rounding errors.
function expectToBeImprecise(
  actual: number[],
  expected: number[],
  epsilon = 1e-2,
) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(epsilon);
  }
}

describe("EDFWriter", () => {
  it("writes a simple EDF file without annotations", () => {
    const header = createTestHeader(1, 2);
    const signalData = [[...Array(20).keys()].map((i) => i - 10)];

    const writer = new EDFWriter(header, signalData);
    const buffer = writer.write();

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(header.headerBytes);

    const reader = new EDFReader(new Uint8Array(buffer));

    const readHeader = reader.readHeader();
    expect(readHeader).toEqual(header);

    const readSignal = reader.readSignal(0);
    expect(readSignal.length).toBe(20);
    expectToBeImprecise(readSignal, signalData[0]);
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
    const header = createTestHeader(1, 1);
    const signalData = [[...Array(10).keys()].map((i) => i - 10)];

    const annotations: EDFAnnotation[] = [
      { onset: 0, duration: 0.5, annotation: "Start" },
      { onset: 0.5, annotation: "Event A" },
    ];

    const writer = new EDFWriter(header, signalData, annotations);
    const buffer = writer.write();

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(header.headerBytes);

    const reader = new EDFReader(new Uint8Array(buffer));

    const readHeader = reader.readHeader();
    expect(readHeader).toEqual({
      ...header,
      reserved: "EDF+C",
    });

    const readSignal = reader.readSignal(0);
    expect(readSignal.length).toBe(10);
    expectToBeImprecise(readSignal, signalData[0]);

    const readAnnnotations = reader.readAnnotations();
    expect(readAnnnotations.length).toBe(2);

    expect(readAnnnotations[0].onset).toBe(0);
    expect(readAnnnotations[0].duration).toBe(0.5);
    expect(readAnnnotations[0].annotation).toBe("Start");

    expect(readAnnnotations[1].onset).toBe(0.5);
    expect(readAnnnotations[1].duration).toBeUndefined();
    expect(readAnnnotations[1].annotation).toBe("Event A");
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
      patientId: EDFWriter.patientId({
        hospitalCode: "MCH 0234567",
      }),
      recordingId: EDFWriter.recordingId({
        startDate: new Date("2023-01-01"),
        studyCode: "Test Study",
        technicianCode: "Tech 123",
        equipmentCode: "Equipment 456",
      }),
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

describe("PatientID", () => {
  it("should build a full patient ID string", () => {
    const result = EDFWriter.patientId({
      hospitalCode: "MCH 0234567",
      sex: "F",
      birthdate: new Date("1951-08-02"),
      name: "Haagse Harry",
    });

    expect(result).toBe("MCH_0234567 F 02-AUG-1951 Haagse_Harry");
  });

  it("should fill in X for missing values", () => {
    const result = EDFWriter.patientId({});
    expect(result).toBe("X X X X");
  });
});

describe("RecordingID", () => {
  it("should build a full recording ID string", () => {
    const result = EDFWriter.recordingId({
      startDate: new Date("2002-03-02"),
      studyCode: "PSG 1234/2002",
      technicianCode: "NN",
      equipmentCode: "Telemetry 03",
    });

    expect(result).toBe("Startdate 02-MAR-2002 PSG_1234/2002 NN Telemetry_03");
  });

  it("should fill in X for missing values", () => {
    const result = EDFWriter.recordingId({});
    expect(result).toBe("Startdate X X X X");
  });
});
