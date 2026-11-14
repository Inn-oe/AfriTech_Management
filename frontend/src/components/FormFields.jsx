import { humanize } from '../format.js';

/*
 * Renders a grid of form controls from a field config:
 *   { name, label, type, required, options: [{value,label}] | [string], col, placeholder, help, hidden(values) }
 * Supported types: text, email, tel, number, date, datetime-local, select, textarea, checkbox.
 */
export default function FormFields({ fields, values, onChange }) {
  const set = (name, value) => onChange({ ...values, [name]: value });

  return (
    <div className="row g-3">
      {fields.map((f) => {
        if (f.hidden?.(values)) return null;
        const id = `f-${f.name}`;
        const value = values[f.name] ?? '';
        const common = { id, name: f.name, required: f.required, disabled: f.disabled, placeholder: f.placeholder };
        let control;

        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={`col-md-${f.col || 12}`}>
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" id={id} checked={!!values[f.name]}
                  onChange={(e) => set(f.name, e.target.checked)} />
                <label className="form-check-label" htmlFor={id}>{f.label}</label>
              </div>
            </div>
          );
        }

        if (f.type === 'select') {
          const options = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: humanize(o) }));
          control = (
            <select className="form-select" {...common} value={value} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">{f.emptyLabel ?? `Select ${f.label.toLowerCase()}…`}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        } else if (f.type === 'textarea') {
          control = (
            <textarea className="form-control" rows={f.rows || 3} {...common} value={value}
              onChange={(e) => set(f.name, e.target.value)} />
          );
        } else {
          control = (
            <input className="form-control" type={f.type || 'text'} min={f.min}
              step={f.step ?? (f.type === 'number' ? 'any' : undefined)} {...common} value={value}
              onChange={(e) => set(f.name, e.target.value)} />
          );
        }

        return (
          <div key={f.name} className={`col-md-${f.col || 6}`}>
            <label className="form-label" htmlFor={id}>
              {f.label}{f.required && <span className="text-danger"> *</span>}
            </label>
            {control}
            {f.help && <div className="form-text">{f.help}</div>}
          </div>
        );
      })}
    </div>
  );
}
