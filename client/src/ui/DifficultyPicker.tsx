import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '@nower/shared';

/**
 * Four-level difficulty selector. The selected level is marked by a glyph, a "SELECTED" label
 * and a heavier border, so it never depends on colour alone. Read-only for non-hosts.
 */
export function DifficultyPicker({ value, onChange, disabled, note }: { value: Difficulty; onChange?: (d: Difficulty) => void; disabled?: boolean; note?: string }) {
  return (
    <div className="field">
      <label id="difficulty-label">DIFFICULTY{note ? ` — ${note}` : ''}</label>
      <div className="diff-cards" role="radiogroup" aria-labelledby="difficulty-label">
        {DIFFICULTIES.map((d) => {
          const on = d === value;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              className={`diff-card ${on ? 'on' : ''}`}
              disabled={disabled && !on}
              onClick={() => !disabled && onChange?.(d)}
            >
              <span className="diff-title">
                <span className="diff-mark" aria-hidden>
                  {on ? '◆' : '◇'}
                </span>
                {DIFFICULTY[d].label}
              </span>
              {on && <span className="diff-selected">SELECTED</span>}
              <span className="diff-desc">{DIFFICULTY[d].description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
