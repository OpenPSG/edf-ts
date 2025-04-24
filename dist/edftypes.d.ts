export type EDFVersion = "0";
export interface EDFHeader {
    version: EDFVersion;
    patientId: string;
    recordingId: string;
    startTime: Date;
    headerBytes: number;
    reserved: string;
    dataRecords: number;
    recordDuration: number;
    signalCount: number;
    signals: EDFSignal[];
    discontinuous: boolean;
}
export interface EDFSignal {
    label: string;
    transducerType: string;
    physicalDimension: string;
    physicalMin: number;
    physicalMax: number;
    digitalMin: number;
    digitalMax: number;
    prefiltering: string;
    samplesPerRecord: number;
    reserved: string;
}
export interface EDFAnnotation {
    onset: number;
    duration?: number;
    annotation: string;
}
