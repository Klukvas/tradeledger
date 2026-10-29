import {
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

/** Native button attributes; busy disables repeat interaction without replacing its label. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({
  variant = "primary",
  busy = false,
  disabled,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`button button-${variant} ${className}`}
    >
      {children}
      {busy && (
        <span className="button-busy" aria-hidden="true">
          …
        </span>
      )}
    </button>
  );
}

/** A label and optional help/error for a direct input, select, textarea or MoneyInput child. */
export type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactElement;
};

type ControlProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "aria-describedby" | "aria-invalid"
>;

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: FieldProps): ReactElement {
  const generatedId = useId();
  if (
    !isValidElement<ControlProps>(children) ||
    !(
      children.type === "input" ||
      children.type === "select" ||
      children.type === "textarea" ||
      children.type === MoneyInput
    )
  ) {
    throw new TypeError(
      "Field requires a direct input, select, textarea or MoneyInput child",
    );
  }
  const control = children;
  const controlId = htmlFor ?? control.props.id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [control.props["aria-describedby"], hint && hintId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label className="field-label" htmlFor={controlId}>
        {label}
      </label>
      {cloneElement(control, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : control.props["aria-invalid"],
      })}
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Raw decimal string with standard input events. Caller validates/parses on save; commas and negative signs are preserved. */
export type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value"
> & { value: string };

export function MoneyInput({
  className = "",
  inputMode = "decimal",
  type = "text",
  ...props
}: MoneyInputProps): ReactElement {
  return (
    <input
      {...props}
      type={type}
      inputMode={inputMode}
      className={`money-input ${className}`}
    />
  );
}

/** Empty list guidance and an optional next-action button. */
export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      <span className="empty-marker" aria-hidden="true">
        —
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Compact page heading, context and a primary page action. */
export type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PageHeader({
  title,
  description,
  action,
}: PageHeaderProps): ReactElement {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="text-muted">{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  );
}

/** A labelled metric. The caller formats currency and chooses its semantic tone. */
export type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "positive" | "negative";
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: StatCardProps): ReactElement {
  return (
    <div className={`stat-card stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value money">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/** A visible, announced action error; kept outside fields for persistence/save failures. */
export function InlineError({ message }: { message: string }): ReactElement {
  return (
    <div className="error-message" role="alert">
      {message}
    </div>
  );
}

/** Text status with color as a secondary cue. */
export type BadgeProps = {
  children: ReactNode;
  tone?: "default" | "positive" | "negative" | "warning";
};

export function Badge({
  children,
  tone = "default",
}: BadgeProps): ReactElement {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}
