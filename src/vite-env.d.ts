/// <reference types="vite/client" />

declare module "exceljs/dist/exceljs.min.js" {
  import ExcelJS from "exceljs";
  export default ExcelJS;
}

declare module "*.png" {
  const src: string;
  export default src;
}
