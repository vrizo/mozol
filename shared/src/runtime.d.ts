// Web Crypto and TextEncoder as Node, workerd and browsers provide them. Only shared's own typecheck reads this
// file; the worker and the web app bring their own lib types.
declare var crypto: {
  readonly subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
