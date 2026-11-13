# Synthetic shop fixture

Three tiny placeholder repositories under `repos/` (`orders-api`, `storefront`, `billing-worker`) used to exercise the planner Skill and CLI. They are not runnable and contain no real code. The owner is the placeholder `example-org`. The files deliberately mix formats (OpenAPI YAML, JSON Schema, Python, JavaScript, Go) to show that the planner makes no stack assumption.

## Sample requests for Skill runs

1. "Add an integer `discountCents` to order totals and show it on the order summary" (non-breaking).
2. "Rename `customerName` to `buyerName` in orders" (breaking; the Skill must ask the staged / at-once question before writing the final plan).

## Sample runs

- No catalog: use `config.no-catalog.json`. The Skill asks for the repo paths; point it at the directories under `fixtures/synthetic-shop/repos/`.

  ```sh
  sac-planner catalog --config fixtures/synthetic-shop/config.no-catalog.json
  ```

- With catalog: use `config.with-catalog.json`, which points to `catalog.json`. The Skill shortlists repos from the catalog and uses each `localPath`.

  ```sh
  sac-planner catalog --config fixtures/synthetic-shop/config.with-catalog.json
  ```
