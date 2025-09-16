declare module 'papaparse' {
  export interface ParseResult<T> {
    data: T[];
    errors: any[];
    meta: any;
  }
  export interface ParseConfig {
    header?: boolean;
    skipEmptyLines?: boolean | 'greedy';
    complete?: (results: ParseResult<any>) => void;
    error?: (error: any) => void;
  }
  export function parse(file: File | string, config?: ParseConfig): void;
  const Papa: { parse: typeof parse; ParseResult: any };
  export default Papa;
}


