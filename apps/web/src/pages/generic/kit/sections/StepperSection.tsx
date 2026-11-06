// apps/web/src/pages/generic/kit/sections/StepperSection.tsx
// Stepper section using .v9-stepper and .v9-step (docs/plans/07-ENGINE-KIT.md §2.3)

export interface StepperStep {
  label: string;
  state: 'done' | 'current' | 'pending' | 'rejected';
  note?: string;
}

export function StepperSection({ title, steps }: { title?: string; steps: StepperStep[] }) {
  return (
    <div className="v9-section stepper-section">
      {title ? <h3>{title}</h3> : null}
      <div className="v9-stepper" role="list" aria-label={title ?? 'Steps'}>
        {steps.map((step, idx) => (
          <div key={`${step.label}-${idx}`} className={`v9-step ${step.state}`} role="listitem">
            <b>{step.label}</b>
            {step.note ? <small>{step.note}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
