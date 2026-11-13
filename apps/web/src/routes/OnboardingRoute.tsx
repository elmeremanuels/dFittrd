import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Onboarding, ONBOARDING_STEPS, type OnboardingStep } from '@/components/Onboarding';
import { useApp } from '@/store';
import { Splash } from './AppShell';

export function OnboardingRoute(): ReactNode {
  const hydrated = useApp((s) => s.hydrated);
  const [params] = useSearchParams();
  const step = params.get('step');
  const initial: OnboardingStep = step && (ONBOARDING_STEPS as readonly string[]).includes(step) ? (step as OnboardingStep) : 'welcome';
  if (!hydrated) return <Splash />;
  return (
    <div className="h-full overflow-y-auto">
      <Onboarding initialStep={initial} />
    </div>
  );
}
