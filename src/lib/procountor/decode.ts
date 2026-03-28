/** Decode Procountor CSV exports (typically ISO-8859-1 / Latin-1). */
export function decodeProcountorFileText(buffer: ArrayBuffer): string {
  return new TextDecoder("iso-8859-1").decode(buffer);
}
