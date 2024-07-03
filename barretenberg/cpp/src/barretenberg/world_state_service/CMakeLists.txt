if (NOT(FUZZING))
  add_executable(world_state_service main.cpp)
  target_link_libraries(world_state_service lmdb crypto_merkle_tree crypto_pedersen_hash common)

  endif()
