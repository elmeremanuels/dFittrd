// Types for scripts/deploy-plan.mjs (imported by src/deployPlan.test.ts).
export declare const DEPLOY_TXT: string;
export interface DeployOptions {
  release?: boolean;
  message?: string;
  version?: string;
}
export declare function parseDeployOptions(text: string | null | undefined): { options: DeployOptions; issues: string[] };
export declare function pushTouched(payload: unknown, path: string): boolean;
export interface DeployPlan {
  deploy: boolean;
  release: boolean;
  message: string;
  version: string;
  issues: string[];
  reason: string;
}
export declare function planShopifyDeploy(ctx: {
  eventName: string;
  ref: string;
  payload?: unknown;
  deployTxt?: string | null;
  inputs?: { release?: string; message?: string };
  sha: string;
  runNumber: string | number;
  runAttempt?: string | number;
}): DeployPlan;
