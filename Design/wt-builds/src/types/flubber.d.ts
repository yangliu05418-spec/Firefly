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
   * The real package (UMD build) exposes these as properties on
   * `module.exports`, so webpack's interop `default` is that object —
   * not the interpolate function itself.
   */
  const flubber: {
    interpolate: typeof interpolate;
    toCircle: typeof toCircle;
  };
  export default flubber;
}
