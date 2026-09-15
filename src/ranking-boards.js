// How REDLINE appears in ssalmuk_ranking. Must match supabase/ranking-boards.sql (checked by tests/ranking.test.js).
export const RANKING_GAME = 'redline';
export const RANKING_BOARD = 'golden-bay';
// Survival time in milliseconds; longer wins. Capped at two hours as a sanity bound.
export const BOARDS = [{ id: RANKING_BOARD, name: '골든 베이', higherIsBetter: true, min: 0, max: 7_200_000 }];
