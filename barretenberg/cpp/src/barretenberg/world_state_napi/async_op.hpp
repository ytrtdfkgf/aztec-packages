#pragma once

#include "barretenberg/serialize/msgpack.hpp"
#include <memory>
#include <napi.h>

namespace bb::world_state {

using namespace Napi;

using tree_op_callback = std::function<void(msgpack::sbuffer&)>;

class AsyncOperation : public AsyncWorker {
  public:
    AsyncOperation(Napi::Env env, std::shared_ptr<Promise::Deferred> deferred, tree_op_callback callback)
        : AsyncWorker(env)
        , _callback(std::move(callback))
        , _deferred(std::move(deferred))
    {}

    AsyncOperation(const AsyncOperation&) = delete;
    AsyncOperation& operator=(const AsyncOperation&) = delete;
    AsyncOperation(AsyncOperation&&) = delete;
    AsyncOperation& operator=(AsyncOperation&&) = delete;

    ~AsyncOperation() override = default;

    void Execute() override
    {
        try {
            _callback(_result);
        } catch (const std::exception& e) {
            SetError(e.what());
        }
    }

    void OnOK() override { _deferred->Resolve(Napi::Buffer<char>::Copy(Env(), _result.data(), _result.size())); }
    void OnError(const Napi::Error& e) override { _deferred->Reject(e.Value()); }

  private:
    tree_op_callback _callback;
    std::shared_ptr<Promise::Deferred> _deferred;
    msgpack::sbuffer _result;
};

} // namespace bb::world_state
