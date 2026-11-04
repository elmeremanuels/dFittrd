import { Garment, UserBodyData, FitResult } from '../types';

export function useFitEngine() {
  const calculateFit = (garment: Garment, user: UserBodyData): FitResult => {
    // Basic implementation of the logic from §4.1 of the handoff
    const criticalPoints = ['bust', 'waist', 'hip'] as const;
    let totalScore = 0;
    
    // Categorical ease target (simplified)
    const easeRequired = garment.category === 'dress' ? 4 : 2;
    
    // Find best size
    let bestSize = garment.sizeChart[0].size;
    let bestScore = -1;

    for (const sizeInfo of garment.sizeChart) {
      let sizePoints = 0;
      let valid = true;

      for (const point of criticalPoints) {
        const garmentVal = sizeInfo[point];
        const userVal = user[point];
        if (garmentVal === 0 || userVal === 0) continue; // Skip if 0 (e.g. bust for trousers)

        const gap = garmentVal - (userVal + easeRequired);
        
        if (gap < -2) {
          valid = false;
          break;
        } else if (gap >= -2 && gap < 0) {
          sizePoints += 0.8; // Snug but okay
        } else if (gap >= 0 && gap <= easeRequired + 2) {
          sizePoints += 1.0; // Perfect
        } else {
          sizePoints += 0.5; // Too loose
        }
      }

      const averageScore = valid ? sizePoints / 3 : 0;
      if (averageScore > bestScore) {
        bestScore = averageScore;
        bestSize = sizeInfo.size;
      }
    }

    const notes = bestScore > 0.8 ? `Size ${bestSize} fits you well.` : `Size ${bestSize} might be a bit loose/tight in some areas.`;

    return {
      score: bestScore,
      recommendedSize: bestSize,
      notes
    };
  };

  return { calculateFit };
}
