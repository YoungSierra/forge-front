'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StepStatus, WizardStep } from '@/lib/types'
import { invalidateFromStep } from '@/lib/api'

interface StepInfo {
  step: WizardStep
  label: string
  status: StepStatus
}

interface Props {
  steps: StepInfo[]
  current_step: WizardStep
  project_id: string
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'approved') {
    return (
      <span className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-bold">
        ✓
      </span>
    )
  }
  if (status === 'active' || status === 'review') {
    return (
      <span className="w-8 h-8 rounded-full bg-violet-600 border-2 border-violet-400 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-violet-500/40">
        ●
      </span>
    )
  }
  if (status === 'generating') {
    return (
      <span className="w-8 h-8 rounded-full bg-violet-600 border-2 border-violet-400 flex items-center justify-center text-white text-sm font-bold animate-pulse">
        ⚡
      </span>
    )
  }
  if (status === 'invalidated') {
    return (
      <span className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500 flex items-center justify-center text-amber-400 text-sm">
        ⚠
      </span>
    )
  }
  return (
    <span className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-sm">
      🔒
    </span>
  )
}

export default function WizardProgress({ steps, current_step, project_id }: Props) {
  const router = useRouter()
  const [confirmStep, setConfirmStep] = useState<WizardStep | null>(null)
  const [tooltip, setTooltip] = useState<WizardStep | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleStepClick(step: StepInfo) {
    if (step.status === 'locked') {
      setTooltip(step.step)
      setTimeout(() => setTooltip(null), 2000)
      return
    }
    if (step.status === 'approved' && step.step < current_step) {
      setConfirmStep(step.step)
      return
    }
  }

  async function confirmGoBack() {
    if (!confirmStep) return
    setLoading(true)
    try {
      await invalidateFromStep(project_id, confirmStep + 1)
      // Forzar recarga completa de la página
      window.location.reload()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setConfirmStep(null)
    }
  }
  return (
    <>
      <div className="w-full bg-[#0d0f16] border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {steps.map((s, i) => (
            <div key={s.step} className="flex items-center flex-1">
              <div className="relative flex flex-col items-center">
                <button
                  onClick={() => handleStepClick(s)}
                  className="flex flex-col items-center gap-1.5 group"
                  disabled={s.status === 'locked'}
                >
                  <StepIcon status={s.status} />
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${s.step === current_step
                        ? 'text-violet-300'
                        : s.status === 'approved'
                          ? 'text-green-400'
                          : s.status === 'invalidated'
                            ? 'text-amber-400'
                            : 'text-slate-600'
                      }`}
                  >
                    {s.label}
                  </span>
                </button>
                {tooltip === s.step && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                    Complete previous steps first
                  </div>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`flex-1 h-px mx-2 ${steps[i].status === 'approved' ? 'bg-green-500/40' : 'bg-slate-800'
                    }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {confirmStep !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#13151f] border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-white font-bold text-lg mb-2">
              Go back to Step {confirmStep}?
            </h3>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              Steps {confirmStep + 1} through {current_step} will be marked as invalid and
              you will need to regenerate them. Previous content is preserved as history.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmStep(null)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmGoBack}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Yes, go back'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
