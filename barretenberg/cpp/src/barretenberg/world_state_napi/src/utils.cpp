#include "barretenberg/world_state_napi/src/utils.hpp"
#include "napi.h"

using namespace bb::world_state;

template <typename T> T get_arg(const Napi::CallbackInfo& info, size_t index, arg_typecheck cb)
{
    Napi::Env env = info.Env();
    if (info.Length() <= index) {
        throw Napi::TypeError::New(env, "Wrong number of arguments");
    }

    if (!cb(info[index])) {
        throw Napi::TypeError::New(env, "Invalid argument type");
    }

    return info[index].As<T>();
}

template <typename T>
T get_optional_arg(const Napi::CallbackInfo& info, size_t index, T default_value, arg_typecheck cb)
{
    if (info.Length() <= index) {
        return default_value;
    }

    return get_arg<T>(info, index, cb);
}
