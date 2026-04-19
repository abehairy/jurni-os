/**
 * Category palette for the Life Landscape.
 *
 * Each category maps to:
 *   - grad: linear-gradient for large tiles
 *   - flat: solid fill for small tiles
 *   - accent: text color for the category label
 *   - title: text color for the topic name
 *   - meta: text color for the change/tone line
 *
 * Palette is deliberately narrow — warm earth tones only. The visual
 * language is "journal by candlelight", not "dashboard". Colors carry
 * meaning: red-browns = activity/pressure, greens = growth, blues =
 * contemplation, grays = quiet/dormant.
 */

export const CATEGORY_PALETTE = {
  work: {
    grad: 'linear-gradient(135deg, #8A3822 0%, #6B2818 100%)',
    flat: '#5C2418',
    accent: '#F2A070',
    title: '#FDE8D8',
    meta: '#E89B6A',
    label: 'Work',
  },
  money: {
    grad: 'linear-gradient(135deg, #7A5618 0%, #5C3F10 100%)',
    flat: '#4A3410',
    accent: '#E0B870',
    title: '#F5E0B0',
    meta: '#E0B870',
    label: 'Money',
  },
  craft: {
    grad: 'linear-gradient(135deg, #3A5A3A 0%, #2A4228 100%)',
    flat: '#2A3E28',
    accent: '#A8D4A0',
    title: '#E0F0D0',
    meta: '#A8D4A0',
    label: 'Craft',
  },
  love: {
    grad: 'linear-gradient(135deg, #3E2A4A 0%, #2C1F36 100%)',
    flat: '#2E2038',
    accent: '#C8A8D8',
    title: '#E8D8F0',
    meta: '#C8A8D8',
    label: 'Love',
  },
  family: {
    grad: 'linear-gradient(135deg, #5A3E28 0%, #3E2A1C 100%)',
    flat: '#3E2E20',
    accent: '#D4A874',
    title: '#F0D8B0',
    meta: '#D4A874',
    label: 'Family',
  },
  child: {
    grad: 'linear-gradient(135deg, #6B4A2A 0%, #4A3018 100%)',
    flat: '#4A3620',
    accent: '#E8B880',
    title: '#F5D8A8',
    meta: '#E8B880',
    label: 'Child',
  },
  peers: {
    grad: 'linear-gradient(135deg, #4A4028 0%, #342C18 100%)',
    flat: '#342E20',
    accent: '#B8A870',
    title: '#D8CC98',
    meta: '#B8A870',
    label: 'Peers',
  },
  faith: {
    grad: 'linear-gradient(135deg, #2A3E5A 0%, #1C2A3E 100%)',
    flat: '#1E2C40',
    accent: '#8AA8D0',
    title: '#C8D8E8',
    meta: '#8AA8D0',
    label: 'Faith',
  },
  body: {
    grad: 'linear-gradient(135deg, #4A5228 0%, #343A1C 100%)',
    flat: '#343A20',
    accent: '#B8C474',
    title: '#D8E098',
    meta: '#B8C474',
    label: 'Body',
  },
  mind: {
    grad: 'linear-gradient(135deg, #5A4228 0%, #3E2D1C 100%)',
    flat: '#3A2D20',
    accent: '#D4A574',
    title: '#F0D8B0',
    meta: '#D4A574',
    label: 'Mind',
  },
  public: {
    grad: 'linear-gradient(135deg, #4A3040 0%, #34202E 100%)',
    flat: '#34242E',
    accent: '#C090B0',
    title: '#E0B8D0',
    meta: '#C090B0',
    label: 'Public',
  },
  hearth: {
    grad: 'linear-gradient(135deg, #4A3828 0%, '+'#34271C 100%)',
    flat: '#3A2D1F',
    accent: '#B89A6E',
    title: '#D4B88A',
    meta: '#B89A6E',
    label: 'Hearth',
  },
  grief: {
    grad: 'linear-gradient(135deg, #3A2F38 0%, #2A2128 100%)',
    flat: '#2A2128',
    accent: '#8B7A85',
    title: '#B8A8B0',
    meta: '#8B7A85',
    label: 'Grief',
  },
  other: {
    grad: 'linear-gradient(135deg, #3A2F24 0%, #2A2118 100%)',
    flat: '#2E2418',
    accent: '#8B7A5E',
    title: '#A89A82',
    meta: '#8B7A5E',
    label: 'Other',
  },
};

export function paletteFor(category) {
  return CATEGORY_PALETTE[category] || CATEGORY_PALETTE.other;
}

export function formatChangePct(p) {
  if (p === 0 || p == null || isNaN(p)) return { symbol: '·', text: 'steady' };
  const pct = Math.round(Math.abs(p) * 1000) / 10;
  if (p > 0) return { symbol: '▲', text: `${pct}%`, up: true };
  return { symbol: '▼', text: `${pct}%`, up: false };
}
