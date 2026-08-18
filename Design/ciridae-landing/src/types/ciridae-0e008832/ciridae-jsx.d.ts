import "react";

/**
 * Target-site custom attributes rendered verbatim in section markup.
 *
 * Every home-page section carries a `change-nav-color` attribute that
 * LenisProvider reads to switch the nav's text color as the section crosses
 * the viewport midpoint. React 19 passes unknown lowercase attributes through
 * to the DOM; this augmentation makes them type-checkable in JSX.
 */
declare module "react" {
  // T is unused here but must match the original type-parameter list for the
  // module augmentation to merge with @types/react's HTMLAttributes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    "change-nav-color"?: string;
  }
}
