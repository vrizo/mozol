// Vite's ?raw imports, used to read text fixtures without Node types.
declare module "*?raw" {
  const text: string;
  export default text;
}
