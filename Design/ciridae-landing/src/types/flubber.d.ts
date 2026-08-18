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

  export default interpolate;

  export function toCircle(
    fromShape: string,
    x: number,
    y: number,
    r: number,
    options?: FlubberOptions,
  ): (t: number) => string;

  // The package ships CommonJS with named exports; under esModuleInterop
  // the "default" is the module.exports object carrying those members.
  const flubber: {
    interpolate: typeof interpolate;
    toCircle: typeof toCircle;
  };
  export default flubber;
}
