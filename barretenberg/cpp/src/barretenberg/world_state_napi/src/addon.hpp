#pragma once

#include "barretenberg/messaging/dispatcher.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include <memory>
#include <napi.h>

namespace bb::world_state {

class WorldStateAddon : public Napi::ObjectWrap<WorldStateAddon> {
  public:
    WorldStateAddon(const Napi::CallbackInfo&);
    Napi::Value process(const Napi::CallbackInfo&);

    static Napi::Function get_class(Napi::Env);

  private:
    std::unique_ptr<bb::world_state::WorldState> _ws;
    messaging::MessageDispatcher _dispatcher;
};

} // namespace bb::world_state
