// SPDX-License-Identifier: MPL-2.0
//
// Copyright (C) 2025 The OpenPSG Authors.

import { readFileSync } from "fs";
import { join } from "path";
import { EDFHeader, EDFAnnotation } from "./edftypes";
import { EDFReader } from "./edfreader";

let header: EDFHeader;
let samples: number[];
let annotations: EDFAnnotation[] = [];

beforeAll(() => {
  const byteArray = readFileSync(
    join(__dirname, "./testdata/test_generator_2.edf"),
  );
  const reader = new EDFReader(byteArray);
  header = reader.readHeader();
  const signalIndex = header.signals.findIndex((signal) =>
    signal.label.includes("sine 8.5 Hz"),
  );
  samples = reader.readSignal(signalIndex, 0);
  annotations = reader.readAnnotations();
});

describe("EDFReader", () => {
  test("reads the header correctly", () => {
    expect(header.version).toBe("0");
    expect(header.patientId).toBe("X X X X");
    expect(header.recordingId).toBe("Startdate 10-DEC-2009 X X test_generator");
    expect(header.startTime.toDateString()).toBe(
      new Date(2009, 11, 10, 12, 44, 2).toDateString(),
    );
    expect(header.headerBytes).toBe(3328);
    expect(header.reserved).toBe("EDF+C");
    expect(header.dataRecords).toBe(600);
    expect(header.recordDuration).toBe(1);
    expect(header.signalCount).toBe(12);

    const expectedSignals = [
      "squarewave",
      "ramp",
      "pulse",
      "ECG",
      "noise",
      "sine 1 Hz",
      "sine 8 Hz",
      "sine 8.5 Hz",
      "sine 15 Hz",
      "sine 17 Hz",
      "sine 50 Hz",
      "EDF Annotations",
    ];

    expectedSignals.forEach((label, index) => {
      const signal = header.signals[index];
      expect(signal.label).toBe(label);
      expect(signal.transducerType).toBe("");
      expect(signal.prefiltering).toBe("");
      expect(signal.digitalMin).toBe(-32768);
      expect(signal.digitalMax).toBe(32767);
      expect(signal.reserved).toBe("");

      if (label === "EDF Annotations") {
        expect(signal.physicalMin).toBe(-1);
        expect(signal.physicalMax).toBe(1);
        expect(signal.physicalDimension).toBe("");
        expect(signal.samplesPerRecord).toBe(51);
      } else {
        expect(signal.physicalMin).toBe(-1000);
        expect(signal.physicalMax).toBe(1000);
        expect(signal.physicalDimension).toBe("uV");
        expect(signal.samplesPerRecord).toBe(200);
      }
    });
  });

  test("reads one record worth of samples", () => {
    expect(samples.length).toBe(200);
  });

  test("verifies the first 5 samples", () => {
    expect(samples[0]).toBeCloseTo(26.38, 2);
    expect(samples[1]).toBeCloseTo(50.92, 2);
    expect(samples[2]).toBeCloseTo(71.82, 2);
    expect(samples[3]).toBeCloseTo(87.63, 2);
    expect(samples[4]).toBeCloseTo(97.25, 2);
  });

  test("verifies the last 5 samples", () => {
    expect(samples[195]).toBeCloseTo(87.63, 2);
    expect(samples[196]).toBeCloseTo(71.82, 2);
    expect(samples[197]).toBeCloseTo(50.92, 2);
    expect(samples[198]).toBeCloseTo(26.38, 2);
    expect(samples[199]).toBeCloseTo(0.0152, 2);
  });

  test("reads annotations correctly", () => {
    expect(annotations.length).toBe(2);

    expect(annotations[0].onset).toBe(0);
    expect(annotations[0].annotation).toBe("RECORD START");

    expect(annotations[1].onset).toBe(600);
    expect(annotations[1].annotation).toBe("REC STOP");
  });

  test("loads discontinuous annotations", () => {
    const byteArray = readFileSync(
      join(__dirname, "./testdata/discontinuous.edf"),
    );

    const reader = new EDFReader(byteArray);
    const header = reader.readHeader();

    expect(header.reserved).toBe("EDF+D");

    const annotations = reader.readAnnotations();

    expect(annotations.length).toBe(12);
    expect(annotations[0].onset).toBe(0);
    expect(annotations[0].duration).toBe(0);
    expect(annotations[0].annotation).toBe("Recording starts");

    expect(annotations[11].onset).toBe(24784);
    expect(annotations[11].duration).toBe(17);
    expect(annotations[11].annotation).toBe("Central Apnea");
  });

  test("reads discontinuous timestamps correctly", () => {
    const byteArray = readFileSync(
      join(__dirname, "./testdata/discontinuous.edf"),
    );

    const reader = new EDFReader(byteArray);
    const header = reader.readHeader();

    expect(header.reserved).toBe("EDF+D");

    const timestamp = reader.getRecordTimestamp(header.dataRecords - 1);

    expect(timestamp).toBe(9);
  });

  test("can parse TALs", () => {
    const talString = "+24784\x1517\x14Central Apnea\x14Another Event";
    const parsedEvents = EDFReader.parseTal(talString);

    expect(parsedEvents.length).toBe(2);

    expect(parsedEvents[0].onset).toBe(24784);
    expect(parsedEvents[0].duration).toBe(17);
    expect(parsedEvents[0].annotation).toBe("Central Apnea");

    expect(parsedEvents[1].onset).toBe(24784);
    expect(parsedEvents[1].duration).toBe(17);
    expect(parsedEvents[1].annotation).toBe("Another Event");
  });
});
