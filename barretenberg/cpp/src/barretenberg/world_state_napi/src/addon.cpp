#include "barretenberg/world_state_napi/src/addon.hpp"
#include "barretenberg/messaging/header.hpp"
#include "barretenberg/world_state/world_state.hpp"
#include "barretenberg/world_state_napi/src/message.hpp"
#include "barretenberg/world_state_napi/src/tree_op.hpp"
#include "barretenberg/world_state_napi/src/utils.hpp"
#include "msgpack/v3/pack_decl.hpp"
#include "msgpack/v3/sbuffer_decl.hpp"
#include "napi.h"
#include <any>
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
}

Napi::Value WorldStateAddon::process(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto buffer = info[0].As<Napi::Buffer<char>>();
    char* data = buffer.Data();
    size_t len = buffer.Length();
    msgpack::object_handle obj_handle = msgpack::unpack(data, len);
    msgpack::object obj = obj_handle.get();

    bb::messaging::HeaderOnlyMessage header;
    obj.convert(header);

    std::cout << "Received message of type " << header.msgType << std::endl;

    Napi::Promise::Deferred deferred(env);
    if (header.msgType == GET_TREE_INFO_REQUEST) {
        TypedMessage<GetTreeInfoRequest> req;
        obj.convert(req);

        auto* op = new TreeOp(env, deferred, [&](msgpack::sbuffer& buf) {
            TreeInfo info = _ws->get_tree_info(LatestBlock{}, req.value.id);
            // GetTreeInfoResponse r{ req.value.id, format(info.root), info.size, info.depth };
            messaging::TypedMessage<TreeInfo> resp_msg(WorldStateMsgTypes::GET_TREE_INFO_RESPONSE, req.header, info);

            msgpack::pack(buf, resp_msg);
        });
        op->Queue();
    }

    // HeaderOnlyMessage m;
    // m.header.messageId = 123;
    // msgpack::sbuffer out;
    // msgpack::pack(out, m);

    // deferred.Resolve(Napi::Buffer<char>::Copy(env, out.data(), out.size()));

    return deferred.Promise();
}

Napi::Function WorldStateAddon::get_class(Napi::Env env)
{
    return DefineClass(env,
                       "WorldState",
                       {
                           WorldStateAddon::InstanceMethod("process", &WorldStateAddon::process),
                           //  WorldStateAddon::InstanceMethod("insert_leaf", &WorldStateAddon::insert_leaf),
                           //  WorldStateAddon::InstanceMethod("commit", &WorldStateAddon::commit),
                       });
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    Napi::String name = Napi::String::New(env, "WorldState");
    exports.Set(name, WorldStateAddon::get_class(env));
    return exports;
}

NODE_API_MODULE(addon, Init)
