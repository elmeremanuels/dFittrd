import { Garment } from './types';

export const MOCK_GARMENTS: Garment[] = [
  {
    id: 'aalter-studio-1',
    brand: 'Aalter Studio',
    name: 'Linen Wrap Dress',
    category: 'dress',
    subcategory: 'wrap-midi',
    priceEur: 149,
    primaryColorHex: '#C97A4F',
    fabric: {
      primary: 'linen',
      weightGsm: 240,
      stretchPct: 2,
      drape: 0.78
    },
    patternBlock: 'wrap',
    sizeChart: [
      { size: 'XS', bust: 84, waist: 64, hip: 92 },
      { size: 'S', bust: 88, waist: 68, hip: 96 },
      { size: 'M', bust: 92, waist: 72, hip: 100 },
      { size: 'L', bust: 96, waist: 76, hip: 104 }
    ]
  },
  {
    id: 'monochrome-02',
    brand: 'Monochrome',
    name: 'Silk Slip Top',
    category: 'top',
    subcategory: 'slip',
    priceEur: 89,
    primaryColorHex: '#EAEAEA',
    fabric: {
      primary: 'silk',
      weightGsm: 120,
      stretchPct: 0,
      drape: 0.95
    },
    patternBlock: 'bias',
    sizeChart: [
      { size: 'XS', bust: 80, waist: 60, hip: 88 },
      { size: 'S', bust: 84, waist: 64, hip: 92 },
      { size: 'M', bust: 88, waist: 68, hip: 96 }
    ]
  },
  {
    id: 'raw-denim-01',
    brand: 'Indigo',
    name: 'High-Rise Straight Jeans',
    category: 'bottom',
    subcategory: 'straight',
    priceEur: 120,
    primaryColorHex: '#1E2B4D',
    fabric: {
      primary: 'denim',
      weightGsm: 400,
      stretchPct: 1,
      drape: 0.2
    },
    patternBlock: 'straight',
    sizeChart: [
      { size: '26', bust: 0, waist: 66, hip: 91 },
      { size: '27', bust: 0, waist: 68.5, hip: 93.5 },
      { size: '28', bust: 0, waist: 71, hip: 96 }
    ]
  }
];
