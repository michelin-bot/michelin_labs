// Scorers module placeholder
import { WalletScore, WalletActivity } from '../types';

export class ScoreCalculator {
  calculateScore(address: string, activities: WalletActivity[]): WalletScore {
    throw new Error('Not implemented');
  }
}
