import { describe, expect, it } from 'vitest';
import { MESSAGE_KEYS } from './keys';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

describe('typed language catalog', () => {
  it('keeps both catalogs complete and Chinese as a fully translated default', () => {
    expect(Object.keys(zhCN).sort()).toEqual([...MESSAGE_KEYS].sort());
    expect(Object.keys(enUS).sort()).toEqual([...MESSAGE_KEYS].sort());
    expect(zhCN['projects.title']).not.toBe(enUS['projects.title']);
    expect(Object.values(zhCN).every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
  });
});
