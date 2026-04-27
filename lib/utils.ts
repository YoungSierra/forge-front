import type { WizardStep, StepStatus } from './types'

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export const STEP_LABELS: Record<WizardStep, string> = {
  1: 'GDD',
  2: 'Sprites',
  3: 'Levels',
  4: 'Code',
  5: 'Audio',
  6: 'Export',
}

export function getDefaultStepStatuses(): Record<WizardStep, StepStatus> {
  return {
    1: 'active',
    2: 'locked',
    3: 'locked',
    4: 'locked',
    5: 'locked',
    6: 'locked',
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function getCurrentStep(current_wizard_step?: Record<WizardStep, StepStatus>): WizardStep {
  if (!current_wizard_step) return 1
  const steps: WizardStep[] = [1, 2, 3, 4, 5, 6]
  for (const step of steps) {
    const status = current_wizard_step[step]
    if (status !== 'approved') return step
  }
  return 6
}
