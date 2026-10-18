import type { Step } from './model'

interface Props {
  steps: Step[]
  // Row values top to bottom, and their labels.
  rows: number[]
  labels?: string[]
  onChange: (steps: Step[]) => void
}

// One value per column: clicking a cell sets that step to the row's value,
// clicking the lit cell again makes it a rest.
function StepGrid({ steps, rows, labels, onChange }: Props): React.JSX.Element {
  const set = (i: number, v: number): void => {
    const next = [...steps]
    next[i] = next[i] === v ? null : v
    onChange(next)
  }
  return (
    <div className="step-grid nodrag">
      {rows.map((v, r) => (
        <div className="grid-row" key={v}>
          <span className="row-label">{labels?.[r] ?? v}</span>
          {steps.map((s, i) => (
            <button
              key={i}
              className={`cell ${s === v ? 'on' : ''} ${i % 4 === 0 ? 'beat' : ''}`}
              onClick={() => set(i, v)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default StepGrid
