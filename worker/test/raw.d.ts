// Vite's ?raw imports, used to read text fixtures.
declare module "*?raw" {
  const text: string;
  export default text;
}
