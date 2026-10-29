# Shared UI

Import named components and props from `../ui` (adjust the relative path for the feature).
Components have no domain or storage dependencies. `MoneyInput` preserves raw strings, including
commas and signs; validate and parse values at save time in the domain layer. Give every normal
input its standard `name`, `required`, autocomplete and other appropriate native attributes.

`Field` accepts one direct `input`, `select`, `textarea` or `MoneyInput` child. It assigns an ID and
connects label, hint and error automatically. Wrapped or custom controls are unsupported and throw
a developer error; compose those separately with native labels and ARIA associations.
`Button` defaults to `type="button"`; form saves must explicitly use `type="submit"`. Use `busy`
during a pending save and preserve the form draft on failure. `Dialog` uses the native modal focus
trap, Escape and backdrop dismissal and restores trigger focus. Children remain mounted on close;
reset a draft deliberately when starting a new action. A save error must not close the dialog.

Use `.page` around page contents, `PageHeader` first, `.stats-grid` for `StatCard`s and `.panel`
for sections. `.panel-header` aligns a section heading with its action. `.toolbar` and
`.toolbar-group` group filters/actions. `.stack` is a vertical layout with a 16px gap.

Tables use `.table-wrap > .data-table`; give the wrapper `tabIndex={0}`, `role="region"` and a
useful `aria-label` when it can scroll. Use native `<th scope="col">` headers and `.money` on
right-aligned currency cells. Tables overflow within the wrapper, never the page. For a separate
mobile rendering, apply `.desktop-table` to the desktop wrapper and `.record-cards` to a list of
`.record-card`s with `.record-details` description lists. Both variants switch at 760px.

Forms use `.form-grid` (two columns, one on mobile), `.form-full` to span both and `.form-actions`
for footer buttons. `.inline-actions`/`.row-actions` group buttons; `.checkbox-label` makes a
checkbox label a comfortable touch target. `.text-muted`, `.text-small`, `.text-positive`,
`.text-negative`, `.money`, `.numeric` and `.text-right` are utilities. `InlineError`,
`.success-message`, `.notice` and `Badge` communicate outcomes with text as well as color.

Shell classes: `.app-shell`, `.sidebar`, `.brand`, `.brand-mark`, `.brand-subtitle`,
`.sidebar-nav`, `.nav-item` (active via `.active` or `aria-current="page"`), `.nav-icon`,
`.main-content`, `.skip-link`, `.mobile-nav`. The sidebar navigation becomes a
two-column grid on mobile, keeping the five primary sections visible without horizontal scrolling: overview, inventory, accounts, debts and history. The backup screen is a separate `/#settings` route and has no sidebar item. On desktop the sidebar can collapse to icons; `localStorage` stores only that preference. The account area shows the current email and logout action. See [App.tsx](../App.tsx) and [styles.css](../styles.css). Use `.mobile-nav` only for a separately rendered navigation.

The palette is navy `#0B0F17` / `#111827`, lime `#A3E635`, muted slate and restrained semantic
red/yellow. Typography uses system sans-serif; numbers are tabular. No remote fonts/assets.
Shared controls are at least 44px tall, keyboard focus is visible and motion is reduced when
requested. Device safe-area behavior still needs verification on a notched device.
