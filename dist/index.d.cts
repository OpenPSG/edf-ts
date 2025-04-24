type EDFVersion = "0";
interface EDFHeader {
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
}
interface EDFSignal {
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
interface EDFAnnotation {
    onset: number;
    duration?: number;
    annotation: string;
}

declare class EDFReader {
    private view;
    private textDecoder;
    private byteArray;
    private header?;
    private recordTimestamps?;
    constructor(byteArray: Uint8Array);
    readHeader(): EDFHeader;
    readSignal(signalIndex: number, recordNumber?: number): number[];
    readAnnotations(recordNumber?: number): EDFAnnotation[];
    getRecordTimeStamps(): number[];
    private readFieldText;
    private digitalToPhysical;
}

declare class EDFWriter {
    private header;
    private signalData;
    private annotations?;
    private textEncoder;
    constructor(header: EDFHeader, signalData: number[][], annotations?: EDFAnnotation[] | undefined);
    write(): ArrayBuffer;
    private buildHeader;
    private physicalToDigital;
    private encodeAnnotationSignal;
    private generateAnnotationBlock;
}

export { type EDFAnnotation, type EDFHeader, EDFReader, type EDFSignal, type EDFVersion, EDFWriter };
