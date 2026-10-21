# flybrainlabs miner

Native and browser computation for [flybrainlabs](https://flybrain.work/).

## Scope

Deterministic integer LIF simulation, the WASM engine, browser workers, persistent model/result storage, three-stage mining, cancellation/recovery and live computation observations. Rendering is driven by actual execution state.

## Source map

- `crates/sim-core/`
- `web/research-app.mjs`
- `web/research-worker.mjs`
- `web/mining-workflow.mjs`
- `web/pending-output.mjs`

Each maintained file has one owning repository. `component.json` maps maintained
files into the shared build layout. Dependencies are pinned by commit in the
[infrastructure release manifest](https://github.com/flybrainlabs/infra/blob/main/release-manifest.json).

## Build and test

Use Rust 1.90 or newer (the source uses edition 2024), Node 22 or newer and Python
3.11 or newer. Optional scientific Python dependencies are in
`tools/requirements-research.txt` in the assembled workspace. SBF builds require
the compatible Solana/Agave build tools.

First assemble the exact source revisions:

```sh
git clone https://github.com/flybrainlabs/infra.git flybrainlabs/infra
python3 flybrainlabs/infra/tools/workspace.py checkout --repos flybrainlabs
python3 flybrainlabs/infra/tools/workspace.py assemble --repos flybrainlabs --output flybrainlabs-workspace
cd flybrainlabs-workspace
npm ci
```

Run the applicable checks from the assembled workspace:

```sh
cargo test -p flypow-sim-core
node tests/mining_workflow.mjs
node tests/goal_output_recovery.mjs
```

The assembled layout keeps cross-component import paths intact. Cloning
this repository alone does not supply its external components. The assembler
creates a disposable build layout; all maintained edits belong to the owning
repositories. Use `workspace.py sync` for intentional changes made in that layout,
then review the component diffs and validate them before publication.

Full-model and browser integration checks require existing, verified local
resources and explicit arguments. They do not download a model or reset a
browser profile by default. Isolated chain checks require their own local bank;
production funds and addresses are never substituted.

## Development policy

- All maintained documentation, commit messages, issues, PRs and release notes
  are written in English. Product interfaces may remain bilingual.
- Completed, verified updates are committed and pushed automatically to
  `flybrainlabs/miner` using normal fast forwards.
- Keys, wallets, customer inputs, node databases, private artifacts, browser
  profiles and model caches stay outside Git and website exports.
- Production payment and reward configuration remains disabled until its actual
  asset identities, authorities, funds and operating gates are satisfied.

See [AGENTS.md](AGENTS.md), the
[development guide](https://github.com/flybrainlabs/docs/blob/main/docs/DEVELOPMENT.md),
[architecture](https://github.com/flybrainlabs/docs/blob/main/docs/ARCHITECTURE.md)
and [status](https://github.com/flybrainlabs/docs/blob/main/docs/STATUS.md).

## License and provenance

Project code retains the declared `MIT OR Apache-2.0` license. Data descriptors
and third-party assets retain their own source attribution and licenses; this
code license does not relicense MaleCNS data or third-party libraries. The
maintained sources preserve numerical/identity fixtures and the meaning of
existing scientific and financial records. See [NOTICE](NOTICE).

## Wallet mining V3

The finite Solana Devnet wallet-mining extension is described in the
[execution and acceptance record](https://github.com/flybrainlabs/docs/blob/main/docs/WALLET_MINING_V3_EXECUTION.md)
and [canonical Result layout](https://github.com/flybrainlabs/docs/blob/main/docs/WALLET_MINING_V3_RESULT_LAYOUT.md).
Use the assembled workspace for cross-component imports and pinned release
verification. Public receipts are in the contracts repository under
`deploy/wallet-mining-v3/`; private signers, signed journals and full response
archives remain outside source repositories. The two-unit acceptance budget is
complete. Future paid work requires a new prospectively frozen finite plan.
Actual extension-wallet and physical-device confirmation remain separate gates.

## Contract task factory V4

The opt-in V4 lifecycle freezes a predefined catalog on chain, accepts full replay
attestations and advances tasks without a privileged relayer or minimum successful-
task interval. Existing V3 records and grants are retained. Public activation is
pending an approved calibrated catalog and finite funding. See
[the lifecycle specification](https://github.com/flybrainlabs/docs/blob/feat/contract-task-factory-v4-20261015/docs/CONTRACT_TASK_FACTORY_V4.md).

## Scientific mining V5

The exact event executor retains canonical complete-model archives and falls back
to dense execution when propagation becomes dense. `node tests/session_abi.mjs`
checks both execution paths in actual WASM. The opt-in scientific panel requires
a registered V5 deployment, a personal RPC and a separately approved scoped
mining-wallet policy. Existing model caches and V4 entitlements are retained.
See the [V5 specification](https://github.com/flybrainlabs/docs/blob/feat/scientific-mining-20261020/docs/SCIENTIFIC_MINING_V5.md).

## Continuous V4 mining candidate

One-Start preparation, original execution contexts, durable outbox and bounded recovery. The feature branch is `feat/continuous-mining-20261021`.

Run from the assembled workspace with the existing pinned dependencies:

```sh
node tests/continuous_session_v4.mjs
node tests/submission_outbox_v4.mjs
node tests/factory_storage_v4.mjs
node tests/goal_runner_v2.mjs
```

See `docs/CONTINUOUS_MINING_V4_20261021.md` and the infrastructure
`docs/CONTINUOUS_MINING_V4_20261021_ACCEPTANCE.json` for evidence boundaries.
Source publication does not establish live acceptance or activate the service.
