#include "barretenberg/world_state_napi/src/addon.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_leaf.hpp"
#include "barretenberg/messaging/header.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/world_state_napi/src/async_op.hpp"
#include "barretenberg/world_state_napi/src/message.hpp"
#include "barretenberg/world_state_napi/src/utils.hpp"
#include "msgpack/v3/pack_decl.hpp"
#include "msgpack/v3/sbuffer_decl.hpp"
#include "napi.h"
#include <algorithm>
#include <any>
#include <array>
#include <cstdint>
#include <iostream>
#include <memory>
#include <sstream>

using namespace bb::world_state;

WorldStateAddon::WorldStateAddon(const Napi::CallbackInfo& info)
    : ObjectWrap(info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, "Wrong number of arguments");
    }

    if (!info[0].IsString()) {
        throw Napi::TypeError::New(env, "Directory needs to be a string");
    }

    std::string data_dir = info[0].As<Napi::String>();
    _ws = std::make_unique<WorldState>(16, data_dir, 1024);

    _dispatcher.registerTarget(
        WorldStateMsgTypes::GET_TREE_INFO_REQUEST,
        [this](msgpack::object& obj, msgpack::sbuffer& buffer) { return get_tree_info(obj, buffer); });

    _dispatcher.registerTarget(
        WorldStateMsgTypes::APPEND_LEAVES_REQUEST,
        [this](msgpack::object& obj, msgpack::sbuffer& buffer) { return append_leaves(obj, buffer); });
}

Napi::Value WorldStateAddon::process(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    // keep this in a shared pointer so that AsyncOperation can resolve/reject the promise once the execution is
    // complete on an separate thread
    auto deferred = std::make_shared<Napi::Promise::Deferred>(env);

    if (info.Length() < 1) {
        deferred->Reject(Napi::TypeError::New(env, "Wrong number of arguments").Value());
    } else if (!info[0].IsBuffer()) {
        deferred->Reject(Napi::TypeError::New(env, "Argument must be a buffer").Value());
    } else {
        auto buffer = info[0].As<Napi::Buffer<char>>();
        size_t length = buffer.Length();
        // we mustn't access the Napi::Env outside of this top-level function
        // so copy the data to a variable we own
        // and make it a shared pointer so that it doesn't get destroyed as soon as we exit this code block
        auto data = std::make_shared<std::vector<char>>(length);
        std::copy_n(buffer.Data(), length, data->data());

        auto* op = new AsyncOperation(env, deferred, [=, this](msgpack::sbuffer& buf) {
            msgpack::object_handle obj_handle = msgpack::unpack(data->data(), length);
            msgpack::object obj = obj_handle.get();
            _dispatcher.onNewData(obj, buf);
        });

        // Napi is now responsible for destroying this object
        op->Queue();
    }

    return deferred->Promise();
}

bool WorldStateAddon::get_tree_info(msgpack::object& obj, msgpack::sbuffer& buffer)
{
    bb::messaging::TypedMessage<TreeIdOnlyRequest> request;
    obj.convert(request);
    TreeInfo info = _ws->get_tree_info(request.value.id);

    MsgHeader header(next_msg_id(), request.header.requestId);
    messaging::TypedMessage<TreeInfo> resp_msg(WorldStateMsgTypes::GET_TREE_INFO_RESPONSE, header, info);

    msgpack::pack(buffer, resp_msg);

    return true;
}

bool WorldStateAddon::append_leaves(msgpack::object& obj, msgpack::sbuffer&)
{
    bb::messaging::TypedMessage<TreeIdOnlyRequest> request;
    obj.convert(request);

    switch (request.value.id) {
    case MerkleTreeId::NOTE_HASH_TREE:
    case MerkleTreeId::L1_TO_L2_MESSAGE_TREE:
    case MerkleTreeId::ARCHIVE: {
        bb::messaging::TypedMessage<AppendLeavesRequest<bb::fr>> r1;
        obj.convert(r1);
        _ws->append_leaves<bb::fr>(r1.value.id, r1.value.leaves);
        break;
    }
    case MerkleTreeId::PUBLIC_DATA_TREE: {
        bb::messaging::TypedMessage<AppendLeavesRequest<crypto::merkle_tree::PublicDataLeafValue>> r2;
        obj.convert(r2);
        _ws->append_leaves<crypto::merkle_tree::PublicDataLeafValue>(r2.value.id, r2.value.leaves);
        break;
    }
    case MerkleTreeId::NULLIFIER_TREE: {
        bb::messaging::TypedMessage<AppendLeavesRequest<crypto::merkle_tree::NullifierLeafValue>> r3;
        obj.convert(r3);
        _ws->append_leaves<crypto::merkle_tree::NullifierLeafValue>(r3.value.id, r3.value.leaves);
        break;
    }
    }

    return true;
}

uint32_t WorldStateAddon::next_msg_id()
{
    // TODO (alexg) sync access to this var
    // this mightt not be a problem if the msg_id is only ever incremeneted on the main thread?
    return _msg_id++;
}

Napi::Function WorldStateAddon::get_class(Napi::Env env)
{
    return DefineClass(env,
                       "WorldState",
                       {
                           WorldStateAddon::InstanceMethod("process", &WorldStateAddon::process),
                       });
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    Napi::String name = Napi::String::New(env, "WorldState");
    exports.Set(name, WorldStateAddon::get_class(env));
    return exports;
}

NODE_API_MODULE(addon, Init)
