#pragma once

#include "barretenberg/messaging/header.hpp"
#include "barretenberg/serialize/cbind.hpp"
#include "msgpack/v3/object_fwd_decl.hpp"
#include <cstdint>
#include <functional>
#include <utility>
#include <vector>

namespace bb::messaging {

class MessageDispatcher {
  private:
    std::unordered_map<uint32_t, std::function<bool(msgpack::object&)>> messageHandlers;

  public:
    MessageDispatcher();
    bool onNewData(msgpack::object& obj);
    void registerTarget(uint32_t msgType, std::function<bool(msgpack::object&)>& handler);
};

} // namespace bb::messaging
