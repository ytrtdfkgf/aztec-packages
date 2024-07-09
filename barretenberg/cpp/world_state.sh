rm -f ./build/bin/world_state_tests

cmake --build --preset default --target world_state_tests
./build/bin/world_state_tests --gtest_filter=WorldStateTest.${1:-*} --gtest_brief=1
