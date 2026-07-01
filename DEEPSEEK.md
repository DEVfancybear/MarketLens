Read DEEPSEEK.md, docs/CURRENT_PROGRESS.md, docs/NEXT_TASKS.md, docs/HANDOFF.md and continue development.

# Architecture Rule

Never fix drawing bugs by adding conditional hacks.

If fixing one bug causes another interaction regression,
stop and refactor the interaction architecture.

Never patch around pointer events.

Chart interaction and drawing interaction must remain independent.

TradingView behavior is the reference implementation.

Regression policy:

Before completing any task verify:

- Chart wheel zoom
- Chart pan
- Crosshair
- Drawing creation
- Drawing selection
- Drawing movement
- Endpoint dragging
- Context menu
- Delete
- Duplicate

A task is NOT complete until all regressions pass.
