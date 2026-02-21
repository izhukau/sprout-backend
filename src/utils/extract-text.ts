import { PDFParse } from "pdf-parse";

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  switch (mimeType) {
    case "application/pdf": {
      const pdf = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await pdf.getText();
      return result.text;
    }
    case "text/plain":
    case "text/markdown":
    case "text/x-markdown": {
      return buffer.toString("utf-8");
    }
    default:
      throw new Error(`Unsupported file type for text extraction: ${mimeType}`);
  }
}
