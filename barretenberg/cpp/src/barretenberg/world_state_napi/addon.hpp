#pragma once

#include "barretenberg/messaging/dispatcher.hpp"
#include "barretenberg/world_state/history.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/world_state_napi/message.hpp"
#include <cstdint>
#include <memory>
#include <napi.h>

namespace bb::world_state {

class WorldStateAddon : public Napi::ObjectWrap<WorldStateAddon> {
  public:
    WorldStateAddon(const Napi::CallbackInfo&);
    Napi::Value call(const Napi::CallbackInfo&);

    static Napi::Function get_class(Napi::Env);

  private:
    std::unique_ptr<bb::world_state::WorldState> _ws;
    bb::messaging::MessageDispatcher _dispatcher;

    bool get_tree_info(msgpack::object& obj, msgpack::sbuffer& buffer) const;
    bool get_state_reference(msgpack::object& obj, msgpack::sbuffer& buffer) const;
    bool get_sibling_path(msgpack::object& obj, msgpack::sbuffer& buffer) const;
    bool find_leaf_index(msgpack::object& obj, msgpack::sbuffer& buffer) const;
    bool get_leaf_value(msgpack::object& obj, msgpack::sbuffer& buffer) const;
    bool get_leaf_preimage(msgpack::object& obj, msgpack::sbuffer& buffer) const;

    bool append_leaves(msgpack::object& obj, msgpack::sbuffer& buffer);
    bool update_public_data(msgpack::object& obj, msgpack::sbuffer& buffer);
    bool batch_insert_indexed_leaves(msgpack::object& obj, msgpack::sbuffer& buffer);
    bool sync_block(msgpack::object& obj, msgpack::sbuffer& buffer);

    static WorldStateRevision revision_from_input(int input);
};

} // namespace bb::world_state
