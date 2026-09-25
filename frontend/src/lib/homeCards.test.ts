import { describe, expect, it } from 'vitest';

import { HOME_CARD_IDS, homeCardDefaultVisible, resolveHomeCards } from './homeCards';

describe('resolveHomeCards', () => {
  it('returns the available cards in default order when nothing is persisted', () => {
    expect(resolveHomeCards(null)).toEqual([
      { id: 'current_wallpaper', visible: true },
      { id: 'bing_daily', visible: true },
      { id: 'daily_quote', visible: true },
      { id: 'spotlight', visible: true },
      { id: 'recent_history', visible: true },
      { id: 'random_favorite', visible: false },
    ]);
    expect(resolveHomeCards(undefined)).toEqual(resolveHomeCards([]));
  });

  it('hides cards without an explicit persisted value per their default visibility', () => {
    expect(homeCardDefaultVisible('random_favorite')).toBe(false);
    expect(homeCardDefaultVisible('spotlight')).toBe(true);
    // 显式开启过的用户保持开启。
    expect(
      resolveHomeCards([{ id: 'random_favorite', visible: true }]).find((card) => card.id === 'random_favorite'),
    ).toEqual({ id: 'random_favorite', visible: true });
  });

  it('keeps the persisted order and visibility', () => {
    expect(
      resolveHomeCards([
        { id: 'daily_quote', visible: true },
        { id: 'current_wallpaper', visible: false },
        { id: 'bing_daily', visible: false },
      ]),
    ).toEqual([
      { id: 'daily_quote', visible: true },
      { id: 'current_wallpaper', visible: false },
      { id: 'bing_daily', visible: false },
      { id: 'spotlight', visible: true },
      { id: 'recent_history', visible: true },
      { id: 'random_favorite', visible: false },
    ]);
  });

  it('appends available cards missing from the persisted list', () => {
    const result = resolveHomeCards(
      [{ id: 'plugin-a:note', visible: true }],
      [...HOME_CARD_IDS, 'plugin-a:note'],
    );
    expect(result[0]).toEqual({ id: 'plugin-a:note', visible: true });
    expect(result.slice(1)).toEqual(HOME_CARD_IDS.map((id) => ({ id, visible: homeCardDefaultVisible(id) })));
  });

  it('keeps entries for currently unavailable cards so plugin settings survive a toggle', () => {
    const result = resolveHomeCards(
      [{ id: 'bing_daily', visible: false }, { id: 'plugin-a:note', visible: false }],
      HOME_CARD_IDS,
    );
    expect(result).toEqual([
      { id: 'bing_daily', visible: false },
      { id: 'current_wallpaper', visible: true },
      { id: 'daily_quote', visible: true },
      { id: 'spotlight', visible: true },
      { id: 'recent_history', visible: true },
      { id: 'random_favorite', visible: false },
      { id: 'plugin-a:note', visible: false },
    ]);
  });

  it('treats a missing visible flag as visible and drops duplicates', () => {
    expect(resolveHomeCards([{ id: 'daily_quote' }, { id: 'daily_quote', visible: false }])).toEqual([
      { id: 'daily_quote', visible: true },
      { id: 'current_wallpaper', visible: true },
      { id: 'bing_daily', visible: true },
      { id: 'spotlight', visible: true },
      { id: 'recent_history', visible: true },
      { id: 'random_favorite', visible: false },
    ]);
  });
});
