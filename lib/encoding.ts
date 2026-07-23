// Robust text-file decoding for uploaded novels. Chinese .txt files are very
// often NOT UTF-8 — they are commonly GBK / GB2312 / GB18030, or UTF-16 with a
// BOM. Decoding those bytes as UTF-8 produces mojibake (乱码), and feeding that
// garbage to the model makes it hallucinate content unrelated to the source.
//
// Detection order:
//   1. Byte-order mark (UTF-8 / UTF-16LE / UTF-16BE) — authoritative.
//   2. Strict UTF-8 decode (fatal): if the bytes are valid UTF-8 it wins.
//   3. Fall back to GB18030 (a superset of GBK/GB2312) which covers the vast
//      majority of Simplified-Chinese legacy files. Pick whichever of GB18030
//      vs. lossy-UTF-8 yields fewer replacement characters, for safety.
//
// TextDecoder is available in both browsers and Node 18+, so this stays
// dependency-free. Only the File-reading helper assumes a browser Blob.

export interface DecodedText {
  text: string;
  encoding: string;
  /** ratio of U+FFFD replacement chars — a proxy for how garbled the result is */
  garbledRatio: number;
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++;
  return n;
}

/** Best-effort decode of raw file bytes into text, with the detected encoding. */
export function decodeTextBuffer(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);

  // 1) BOM sniffing.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = new TextDecoder("utf-8").decode(bytes.subarray(3));
    return { text, encoding: "UTF-8", garbledRatio: 0 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new TextDecoder("utf-16le").decode(bytes);
    return { text, encoding: "UTF-16LE", garbledRatio: 0 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new TextDecoder("utf-16be").decode(bytes);
    return { text, encoding: "UTF-16BE", garbledRatio: 0 };
  }

  // 2) Strict UTF-8: valid GBK byte streams almost never pass a fatal UTF-8
  //    decode, so a success here is a strong signal the file really is UTF-8.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "UTF-8", garbledRatio: 0 };
  } catch {
    // not valid UTF-8 — fall through to legacy Chinese encodings
  }

  // 3) GB18030 fallback, compared against a lossy UTF-8 read as a tie-breaker.
  let gb: string;
  try {
    gb = new TextDecoder("gb18030").decode(bytes);
  } catch {
    // Some engines only expose the "gbk" label; try it before giving up.
    try {
      gb = new TextDecoder("gbk").decode(bytes);
    } catch {
      gb = "";
    }
  }
  const u8 = new TextDecoder("utf-8").decode(bytes); // lossy, may contain U+FFFD

  const gbBad = gb ? countReplacement(gb) : Number.POSITIVE_INFINITY;
  const u8Bad = countReplacement(u8);
  const pick =
    gb && gbBad <= u8Bad
      ? { text: gb, encoding: "GB18030", bad: gbBad }
      : { text: u8, encoding: "UTF-8", bad: u8Bad };

  const len = pick.text.length || 1;
  return { text: pick.text, encoding: pick.encoding, garbledRatio: pick.bad / len };
}

/** Read a browser File/Blob and decode it with encoding detection. */
export async function readTextFile(file: Blob): Promise<DecodedText> {
  const buffer = await file.arrayBuffer();
  return decodeTextBuffer(buffer);
}
