#!/usr/bin/env bash

set -e

cd "$(dirname "$0")/.."

# relatiev path from the directory containing package.json
WORLD_STATE_LIB_PATH=../../barretenberg/cpp/build/lib/world_state_napi.node

build_cpp() {
  (cd ../../barretenberg/cpp; cmake --build --preset default --target world_state_napi)
}

link_cpp() {
  if [ -f $WORLD_STATE_LIB_PATH ]; then
    echo "Copying world_state_napi.node to build directory"
    rm -rf build
    mkdir build
    cp $WORLD_STATE_LIB_PATH build/world_state_napi.node
  else 
    echo "world_state_napi.node not found at $WORLD_STATE_LIB_PATH"
    echo "Skipping copy to build directory"
    echo "NativeWorldStateService will not work without this file"
  fi
}

build_ts() {
  tsc -b ../
}

case $1 in
  cpp)
    build_cpp
    link_cpp
    ;;
  ts)
    build_ts
    ;;
  *)
    build_cpp
    link_cpp
    build_ts
    ;;
esac
