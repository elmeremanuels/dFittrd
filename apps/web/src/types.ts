/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface UserBodyData {
  height: number; // cm
  weight: number; // kg
  bust: number; // cm
  waist: number; // cm
  hip: number; // cm
  skinTone: string;
  hairColor: string;
  faceImage?: string;
  bodyMeshId?: string;
}

export interface Garment {
  id: string;
  brand: string;
  name: string;
  category: 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';
  subcategory: string;
  priceEur: number;
  primaryColorHex: string;
  fabric: {
    primary: string;
    weightGsm: number;
    stretchPct: number;
    drape: number;
  };
  patternBlock: string;
  sizeChart: Array<{
    size: string;
    bust: number;
    waist: number;
    hip: number;
  }>;
}

export interface FitResult {
  score: number; // 0-1
  recommendedSize: string;
  notes: string;
}

export interface TasteProfile {
  bohemian: number;
  minimal: number;
  classic: number;
  avantGarde: number;
  sporty: number;
}
