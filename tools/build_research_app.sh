#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo 'Rust cargo is required' >&2; exit 1; }
rustup target add wasm32-unknown-unknown
cargo build --locked -p flypow-sim-core --release --target wasm32-unknown-unknown
mkdir -p web/wasm
cp target/wasm32-unknown-unknown/release/flypow_sim_core.wasm web/wasm/flypow_sim_core.wasm
printf 'WASM core ready at web/wasm/flypow_sim_core.wasm\n'
