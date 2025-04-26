// src/edfreader.ts
import _ from "lodash";
var EDFReader = class _EDFReader {
  constructor(byteArray) {
    this.textDecoder = new TextDecoder("ascii");
    this.view = new DataView(byteArray.buffer, byteArray.byteOffset);
    this.byteArray = byteArray;
  }
  readHeader() {
    if (this.header) return this.header;
    const headerText = this.textDecoder.decode(this.byteArray.subarray(0, 256));
    const version = headerText.substring(0, 8).trim();
    const patientId = headerText.substring(8, 88).trim();
    const recordingId = headerText.substring(88, 168).trim();
    const startDateStr = headerText.substring(168, 176).trim();
    const startTimeStr = headerText.substring(176, 184).trim();
    const headerBytes = parseInt(headerText.substring(184, 192).trim());
    const reserved = headerText.substring(192, 236).trim();
    const dataRecords = parseInt(headerText.substring(236, 244).trim());
    const recordDuration = parseFloat(headerText.substring(244, 252).trim());
    const signalCount = parseInt(headerText.substring(252, 256).trim());
    const [day, month, year] = startDateStr.split(".").map(Number);
    const fullYear = year >= 85 ? 1900 + year : 2e3 + year;
    const [hour, minute, second] = startTimeStr.split(".").map(Number);
    const startTime = new Date(fullYear, month - 1, day, hour, minute, second);
    const signals = [];
    for (let i = 0; i < signalCount; i++) {
      const signal = {};
      signal.label = this.readFieldText(signalCount, 0, 16, i).trim();
      signal.transducerType = this.readFieldText(signalCount, 16, 96, i).trim();
      signal.physicalDimension = this.readFieldText(
        signalCount,
        96,
        104,
        i
      ).trim();
      signal.physicalMin = parseFloat(
        this.readFieldText(signalCount, 104, 112, i)
      );
      signal.physicalMax = parseFloat(
        this.readFieldText(signalCount, 112, 120, i)
      );
      signal.digitalMin = parseInt(
        this.readFieldText(signalCount, 120, 128, i)
      );
      signal.digitalMax = parseInt(
        this.readFieldText(signalCount, 128, 136, i)
      );
      signal.prefiltering = this.readFieldText(signalCount, 136, 216, i).trim();
      signal.samplesPerRecord = parseInt(
        this.readFieldText(signalCount, 216, 224, i)
      );
      signal.reserved = this.readFieldText(signalCount, 224, 256, i).trim();
      signals.push(signal);
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
      signals
    };
    return _.cloneDeep(this.header);
  }
  readSignal(signalIndex, recordNumber) {
    const header = this.header ?? this.readHeader();
    const signal = header.signals[signalIndex];
    const samplesPerRecord = signal.samplesPerRecord;
    const samples = [];
    const offset = header.headerBytes;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0
    );
    const startRecord = recordNumber ?? 0;
    const endRecord = recordNumber !== void 0 ? recordNumber + 1 : header.dataRecords;
    const signalByteOffset = header.signals.slice(0, signalIndex).reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
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
  readAnnotations(recordNumber) {
    const header = this.header ?? this.readHeader();
    const annSignalIndex = header.signals.findIndex(
      (sig) => sig.label.includes("EDF Annotations")
    );
    if (annSignalIndex === -1) return [];
    const annotations = [];
    const offset = header.headerBytes;
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0
    );
    const startRecord = recordNumber ?? 0;
    const endRecord = recordNumber !== void 0 ? recordNumber + 1 : header.dataRecords;
    const signalByteOffset = header.signals.slice(0, annSignalIndex).reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
    const annSignal = header.signals[annSignalIndex];
    const bytes = annSignal.samplesPerRecord * 2;
    for (let rec = startRecord; rec < endRecord; rec++) {
      const recOffset = offset + rec * recordSize;
      const start = recOffset + signalByteOffset;
      const end = start + bytes;
      const slice = this.byteArray.subarray(start, end);
      const text = this.textDecoder.decode(slice);
      const TALs = text.split("\0").filter((s) => s.trim().length > 0);
      for (const tal of TALs) {
        const talAnnotations = _EDFReader.parseTal(tal);
        annotations.push(
          ...talAnnotations.filter((a) => a.annotation.length > 0)
        );
      }
    }
    return annotations;
  }
  // Returns the timestamp associated with the start of the record.
  getRecordTimestamp(recordNumber) {
    const header = this.readHeader();
    const recordSize = header.signals.reduce(
      (sum, s) => sum + s.samplesPerRecord * 2,
      0
    );
    const annSignalIndex = header.signals.findIndex(
      (sig) => sig.label.includes("EDF Annotations")
    );
    if (annSignalIndex === -1) {
      console.warn("No annotation signal found. Returning record start time.");
      return recordNumber * header.recordDuration;
    }
    const signalByteOffset = header.signals.slice(0, annSignalIndex).reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
    const bytes = header.signals[annSignalIndex].samplesPerRecord * 2;
    const recOffset = header.headerBytes + recordNumber * recordSize;
    const start = recOffset + signalByteOffset;
    const end = start + bytes;
    const slice = this.byteArray.subarray(start, end);
    const text = this.textDecoder.decode(slice).replace(/\0/g, "");
    const TALs = text.split("\0").filter((s) => s.trim().length > 0);
    const annotations = [];
    for (const tal of TALs) {
      const talAnnotations = _EDFReader.parseTal(tal);
      annotations.push(...talAnnotations);
    }
    if (annotations.length === 0) {
      return recordNumber * header.recordDuration;
    }
    annotations.sort((a, b) => a.onset - b.onset);
    const earliestAnnotation = annotations[0];
    if (earliestAnnotation.onset !== 0) {
      return earliestAnnotation.onset;
    } else if (earliestAnnotation.onset === 0 && recordNumber !== 0) {
      const nonZeroAnnotations = annotations.filter((a) => a.onset !== 0);
      if (nonZeroAnnotations.length > 0) {
        return nonZeroAnnotations[0].onset;
      }
    }
    return recordNumber * header.recordDuration;
  }
  static parseTal(tal) {
    const SEPARATOR = String.fromCharCode(20);
    const DURATION_MARKER = String.fromCharCode(21);
    const annotations = [];
    const parts = tal.split(SEPARATOR);
    if (parts.length === 0) return [];
    const onsetDurationPart = parts[0];
    let onsetStr = "";
    let durationStr = void 0;
    const durationMarkerIndex = onsetDurationPart.indexOf(DURATION_MARKER);
    if (durationMarkerIndex >= 0) {
      onsetStr = onsetDurationPart.slice(0, durationMarkerIndex);
      durationStr = onsetDurationPart.slice(durationMarkerIndex + 1);
    } else {
      onsetStr = onsetDurationPart;
    }
    const onset = parseFloat(onsetStr);
    const duration = durationStr ? parseFloat(durationStr) : void 0;
    for (const annotation of parts.slice(1)) {
      annotations.push({
        onset,
        duration,
        annotation
      });
    }
    return annotations;
  }
  readFieldText(signalCount, start, end, signalIndex) {
    const offset = 256 + start * signalCount + (end - start) * signalIndex;
    return this.textDecoder.decode(
      this.byteArray.subarray(offset, offset + (end - start))
    );
  }
  digitalToPhysical(digital, signal) {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (digitalMax === digitalMin) return 0;
    return physicalMin + (digital - digitalMin) * (physicalMax - physicalMin) / (digitalMax - digitalMin);
  }
};

// src/edfwriter.ts
import { format } from "date-fns";
var EDFWriter = class {
  constructor(header, signalData, annotations) {
    this.header = header;
    this.signalData = signalData;
    this.annotations = annotations;
    this.textEncoder = new TextEncoder();
    this.configureAnnotationSignal();
  }
  write() {
    const { header, signalData } = this;
    const signalCount = header.signalCount;
    const records = header.dataRecords;
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
          `Signal ${i} has too many samples (${currentSamples} > ${expectedSamples})`
        );
      }
    }
    const headerString = this.buildHeader();
    const headerBytes = this.textEncoder.encode(headerString);
    const dataBytes = [];
    const annotationSignalIndex = header.signals.findIndex(
      (sig) => sig.label.includes("EDF Annotations")
    );
    const hasAnnotations = annotationSignalIndex !== -1;
    for (let recordNumber = 0; recordNumber < records; recordNumber++) {
      for (let s = 0; s < signalCount; s++) {
        const signal = header.signals[s];
        const start = recordNumber * signal.samplesPerRecord;
        const end = start + signal.samplesPerRecord;
        if (hasAnnotations && s === annotationSignalIndex) {
          const annText = this.generateAnnotationBlock(recordNumber);
          const encodedAnn = this.encodeAnnotationSignal(
            annText,
            signal.samplesPerRecord * 2
          );
          dataBytes.push(...encodedAnn);
        } else {
          for (const sample of signalData[s].slice(start, end)) {
            const raw = this.physicalToDigital(sample, signal);
            dataBytes.push(raw & 255, raw >> 8 & 255);
          }
        }
      }
    }
    const fullBuffer = new Uint8Array(headerBytes.length + dataBytes.length);
    fullBuffer.set(headerBytes);
    fullBuffer.set(dataBytes, headerBytes.length);
    return fullBuffer.buffer;
  }
  // Constructs an EDF+ patient ID string based on the provided parameters.
  static patientId({
    hospitalCode,
    sex,
    birthdate,
    name
  }) {
    const formatDate = (date) => `${String(date.getDate()).padStart(2, "0")}-${date.toLocaleString("en-US", {
      month: "short"
    }).toUpperCase()}-${date.getFullYear()}`;
    const safe = (val) => val ? val.replace(/\s+/g, "_") : "X";
    return [
      safe(hospitalCode),
      sex ?? "X",
      birthdate ? formatDate(birthdate) : "X",
      safe(name)
    ].join(" ");
  }
  // Construct an EDF+ recording ID string based on the provided parameters.
  static recordingId({
    startDate,
    studyCode,
    technicianCode,
    equipmentCode
  }) {
    const formatDate = (date) => `${String(date.getDate()).padStart(2, "0")}-${date.toLocaleString("en-US", {
      month: "short"
    }).toUpperCase()}-${date.getFullYear()}`;
    const safe = (val) => val ? val.replace(/\s+/g, "_") : "X";
    return [
      "Startdate",
      startDate ? formatDate(startDate) : "X",
      safe(studyCode),
      safe(technicianCode),
      safe(equipmentCode)
    ].join(" ");
  }
  configureAnnotationSignal() {
    if (!this.annotations || this.annotations.length === 0) return;
    let annotationIndex = this.header.signals.findIndex(
      (sig) => sig.label.includes("EDF Annotations")
    );
    if (annotationIndex === -1) {
      const annotationSignal = {
        label: "EDF Annotations",
        transducerType: "",
        physicalDimension: "",
        physicalMin: -32768,
        physicalMax: 32767,
        digitalMin: -32768,
        digitalMax: 32767,
        prefiltering: "",
        samplesPerRecord: 0
      };
      this.header.signals.push(annotationSignal);
      this.header.signalCount += 1;
      this.header.headerBytes = 256 + 256 * this.header.signalCount;
      annotationIndex = this.header.signals.length - 1;
    }
    const samplesPerRecord = this.calculateMinimumAnnotationSamplesPerRecord(
      this.annotations
    );
    this.header.signals[annotationIndex].samplesPerRecord = samplesPerRecord;
    const totalSamples = samplesPerRecord * this.header.dataRecords;
    while (this.signalData.length <= annotationIndex) {
      this.signalData.push([]);
    }
    const signal = this.signalData[annotationIndex];
    if (signal.length === 0) {
      this.signalData[annotationIndex] = Array(totalSamples).fill(0);
    } else if (signal.length < totalSamples) {
      this.signalData[annotationIndex] = signal.concat(
        Array(totalSamples - signal.length).fill(0)
      );
    } else if (signal.length > totalSamples) {
      throw new Error(
        "Annotation signalData too long for configured samplesPerRecord"
      );
    }
  }
  calculateMinimumAnnotationSamplesPerRecord(annotations) {
    if (!annotations.length) return 1;
    let maxBytesPerRecord = 0;
    const recordCount = this.header.dataRecords;
    for (let record = 0; record < recordCount; record++) {
      const text = this.generateAnnotationBlock(record);
      const bytes = new TextEncoder().encode(text);
      maxBytesPerRecord = Math.max(maxBytesPerRecord, bytes.length);
    }
    return Math.ceil(maxBytesPerRecord / 2);
  }
  buildHeader() {
    const { header } = this;
    const field = (val, length) => val.padEnd(length).substring(0, length);
    const startTime = header.startTime;
    const dateStr = format(startTime, "dd.MM.yy");
    const timeStr = format(startTime, "HH.mm.ss");
    const headerBytes = 256 + 256 * header.signalCount;
    let text = "";
    text += field(header.version ?? "0", 8);
    text += field(header.patientId, 80);
    text += field(header.recordingId, 80);
    text += field(dateStr, 8);
    text += field(timeStr, 8);
    text += field(String(headerBytes), 8);
    const hasAnnotations = this.annotations && this.annotations.length > 0;
    const reserved = hasAnnotations ? "EDF+C" : "";
    text += field(reserved, 44);
    text += field(String(header.dataRecords), 8);
    text += field(header.recordDuration.toFixed(6), 8);
    text += field(String(header.signalCount), 4);
    const signals = header.signals;
    const collect = (cb, len) => signals.map(cb).map((v) => field(v, len)).join("");
    text += collect((s) => s.label, 16);
    text += collect((s) => s.transducerType, 80);
    text += collect((s) => s.physicalDimension, 8);
    text += collect((s) => s.physicalMin.toString(), 8);
    text += collect((s) => s.physicalMax.toString(), 8);
    text += collect((s) => s.digitalMin.toString(), 8);
    text += collect((s) => s.digitalMax.toString(), 8);
    text += collect((s) => s.prefiltering, 80);
    text += collect((s) => s.samplesPerRecord.toString(), 8);
    text += collect((s) => s.reserved || "", 32);
    return text;
  }
  physicalToDigital(value, signal) {
    const { digitalMin, digitalMax, physicalMin, physicalMax } = signal;
    if (physicalMax === physicalMin) return 0;
    const digital = Math.round(
      (value - physicalMin) * (digitalMax - digitalMin) / (physicalMax - physicalMin) + digitalMin
    );
    return Math.max(digitalMin, Math.min(digitalMax, digital));
  }
  encodeAnnotationSignal(text, byteLength) {
    const encoded = new TextEncoder().encode(text);
    const buf = new Uint8Array(byteLength);
    buf.set(encoded.slice(0, byteLength));
    return Array.from(buf);
  }
  generateAnnotationBlock(recordNumber) {
    if (!this.annotations) return "";
    const startTime = recordNumber * this.header.recordDuration;
    const endTime = startTime + this.header.recordDuration;
    const anns = this.annotations.filter(
      (a) => a.onset >= startTime && a.onset < endTime
    );
    let text = "";
    text += `+${startTime.toFixed(3)}\0`;
    for (const ann of anns) {
      text += `+${ann.onset.toFixed(3)}`;
      if (ann.duration !== void 0) {
        text += `${ann.duration.toFixed(3)}`;
      }
      text += `${ann.annotation}\0`;
    }
    return text;
  }
};
export {
  EDFReader,
  EDFWriter
};
