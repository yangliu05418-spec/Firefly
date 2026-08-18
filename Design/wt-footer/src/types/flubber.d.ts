declare module "flubber" {
  export interface FlubberOptions {
    maxSegmentLength?: number;
    string?: boolean;
  }

  export function interpolate(
    fromShape: string,
    toShape: string,
    options?: FlubberOptions,
  ): (t: number) => string;

  export function toCircle(
    fromShape: string,
    x: number,
    y: number,
    r: number,
    options?: FlubberOptions,
  ): (t: number) => string;

  /**
   * The babel add-module-exports build exposes the whole module as the
   * default export (interop: `(await import("flubber")).default`), so type
   * the default as the module object rather than the interpolate function.
   */
  const flubber: {
    interpolate: typeof interpolate;
    toCircle: typeof toCircle;
    separate: typeof interpolate;
    combine: typeof interpolate;
    interpolateAll: typeof interpolate;
    splitPathString: (path: string) => string[];
    toPathString: (rings: string[][]) => string;
  };

  export default flubber;
}
