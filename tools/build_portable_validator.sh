#!/usr/bin/env bash
# Optional build for x86-64 hosts that cannot execute the official AVX2 binary.
set -euo pipefail
patch_file=$(cd "$(dirname "$0")" && pwd)/agave-localnet-sync-io.patch
source_dir=${1:?Usage: tools/build_portable_validator.sh NEW_OR_EXISTING_AGAVE_SOURCE_DIR}
revision=825efd18292aff6ffcf9daa0f7612f21b3531a72
if [[ ! -e "$source_dir" ]]; then
  git clone --depth 1 --branch v4.3.0 https://github.com/anza-xyz/agave.git "$source_dir"
fi
[[ $(git -C "$source_dir" rev-parse HEAD) == "$revision" ]] || { echo 'Agave revision mismatch' >&2; exit 1; }
if [[ -n $(git -C "$source_dir" status --porcelain) ]]; then
  # An interrupted build may be resumed only if its sole source changes are
  # exactly this reviewed, locked-revision test patch.
  [[ ${FLYPOW_LOCALNET_SYNC_IO:-0} == 1 ]] && [[ -z $(git -C "$source_dir" ls-files --others --exclude-standard) ]] && git -C "$source_dir" diff | cmp -s - "$patch_file" || { echo 'Use an unmodified checkout or the exact localnet I/O patch' >&2; exit 1; }
elif [[ ${FLYPOW_LOCALNET_SYNC_IO:-0} == 1 ]]; then
  # Testing-only fallback for hosts where the kernel refuses io_uring. This
  # changes filesystem buffering, not the SBF runtime or consensus rules.
  git -C "$source_dir" apply --check "$patch_file"
  git -C "$source_dir" apply "$patch_file"
fi
cd "$source_dir"
export RUSTUP_TOOLCHAIN=stable
export RUSTFLAGS='-C target-cpu=x86-64'
# This C dependency defaults to -march=haswell, independently of RUSTFLAGS.
export RUST_REED_SOLOMON_ERASURE_ARCH=x86-64
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
# In a previously compiled checkout, remove ONLY the affected dependency's
# build cache so Cargo cannot reuse a Haswell object. No ledger is touched.
cargo clean --release -p reed-solomon-erasure
cargo build --locked --release -p agave-validator --bin solana-test-validator
printf 'Set FLYPOW_VALIDATOR_PATH=%s/target/release/solana-test-validator\n' "$PWD"
