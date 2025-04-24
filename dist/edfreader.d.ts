import { EDFHeader, EDFAnnotation } from "./edftypes";
export declare class EDFReader {
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
