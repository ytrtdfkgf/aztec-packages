
#include "napi.h"
#include <functional>
namespace bb::world_state {

using arg_typecheck = std::function<bool(const Napi::Value&)>;

template <typename T> T get_arg(const Napi::CallbackInfo& info, size_t index, arg_typecheck cb);
template <typename T>
T get_optional_arg(const Napi::CallbackInfo& info, size_t index, T default_value, arg_typecheck cb);

} // namespace bb::world_state
