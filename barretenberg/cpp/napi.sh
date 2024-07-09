#!/usr/bin/env bash

set -e

PRESET=clang16

if [[ $1 == "full" ]]; then
  pushd src/barretenberg/world_state_napi
  yarn
  popd

  cmake --preset $PRESET -DCMAKE_BUILD_TYPE=RelWithAssert
fi

cmake --build --preset $PRESET --target world_state_napi

mkdir -p ../world-state/build
cp build/lib/world_state_napi.node ../world-state/build

echo ""
node ../world-state
