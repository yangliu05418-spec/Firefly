export type FlexEqControlParamValue =
  | string
  | number
  | boolean
  | null
  | FlexEqControlParamValue[]
  | { [key: string]: FlexEqControlParamValue };

export interface FlexEqBrowserPresetView {
  id: string;
  name: string;
  tags: readonly string[];
  favorite?: boolean;
  source: 'factory' | 'user';
}
